import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createApp } from "../src/app.js";
import { verifyWebhook } from "../src/stripe.js";
import { root, salon, fixedClock, tmpDir } from "./helpers.js";

// Stands in for Stripe: records checkout sessions and lets a test mark one paid.
function fakeStripe() {
  const sessions = new Map();
  let n = 0;
  return {
    sessions,
    async createCheckoutSession(opts) {
      const s = { id: `cs_test_${++n}`, url: `https://checkout.stripe.test/${n}`, payment_status: "unpaid", metadata: { booking_id: opts.bookingId }, amount_total: opts.amountCents, opts };
      sessions.set(s.id, s);
      return s;
    },
    async retrieveSession(id) {
      if (!sessions.has(id)) throw new Error("No such session");
      return sessions.get(id);
    },
  };
}

async function start({ stripe = fakeStripe(), webhookSecret = "whsec_test", clock = fixedClock } = {}) {
  const config = { root, port: 0, publicUrl: "https://example.ie", adminPassword: "secret", dataDir: tmpDir(), stripe: { secretKey: "sk_test", webhookSecret } };
  const app = createApp({ config, loadSalon: () => salon, clock, stripe, log: { error() {} } });
  await new Promise((r) => app.server.listen(0, r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return { ...app, stripe, base, close: () => new Promise((r) => { app.server.closeAllConnections?.(); app.server.close(r); }) };
}

const post = (url, body, headers = {}) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const booking = { service: "biab", date: "2026-10-08", time: "10:00", name: "Aoife", phone: "087 123 4567" };
const times = async (base) => (await (await fetch(`${base}/api/availability?date=2026-10-08&service=biab`)).json()).times;
const sign = (body, secret, t = Math.floor(fixedClock().getTime() / 1000)) =>
  `t=${t},v1=${crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;

test("booking with a deposit holds the slot and sends the client to Stripe", async () => {
  const s = await start();
  try {
    assert.deepEqual((await (await fetch(`${s.base}/api/salon`)).json()).deposit, { amount: 10, currency: "eur" });
    const r = await post(`${s.base}/api/bookings`, booking);
    const data = await r.json();
    assert.equal(r.status, 201);
    assert.equal(data.status, "pending");
    assert.match(data.checkoutUrl, /^https:\/\/checkout\.stripe\.test\//);
    const sent = [...s.stripe.sessions.values()][0].opts;
    assert.equal(sent.amountCents, 1000);
    assert.equal(sent.currency, "eur");
    assert.match(sent.successUrl, /^https:\/\/example\.ie\/\?paid=\{CHECKOUT_SESSION_ID\}/);
    assert.ok(!(await times(s.base)).includes("10:00"), "slot is held while paying");
    assert.equal((await post(`${s.base}/api/bookings`, { ...booking, phone: "0861111111" })).status, 400);
  } finally { await s.close(); }
});

test("coming back paid confirms the booking; checking twice is harmless", async () => {
  const s = await start();
  try {
    const { reference } = await (await post(`${s.base}/api/bookings`, booking)).json();
    const session = [...s.stripe.sessions.values()][0];
    const early = await (await fetch(`${s.base}/api/bookings/paid?session=${session.id}`)).json();
    assert.equal(early.status, "pending");
    session.payment_status = "paid";
    for (let i = 0; i < 2; i++) {
      const done = await (await fetch(`${s.base}/api/bookings/paid?session=${session.id}`)).json();
      assert.equal(done.status, "confirmed");
      assert.deepEqual(done.deposit, { amount: 10, paid: true });
      assert.equal(done.reference, reference);
    }
    assert.equal((await fetch(`${s.base}/api/bookings/paid?session=nope`)).status, 400);
  } finally { await s.close(); }
});

test("coming back unpaid frees the slot", async () => {
  const s = await start();
  try {
    const { reference } = await (await post(`${s.base}/api/bookings`, booking)).json();
    assert.equal((await post(`${s.base}/api/bookings/${reference}/release`, {})).status, 200);
    assert.ok((await times(s.base)).includes("10:00"));
  } finally { await s.close(); }
});

test("an unpaid hold lapses on its own after 35 minutes", async () => {
  let now = fixedClock().getTime();
  const s = await start({ clock: () => new Date(now) });
  try {
    await post(`${s.base}/api/bookings`, booking);
    assert.ok(!(await times(s.base)).includes("10:00"));
    now += 36 * 60_000;
    assert.ok((await times(s.base)).includes("10:00"));
  } finally { await s.close(); }
});

test("the webhook confirms paid sessions and rejects bad signatures", async () => {
  const s = await start();
  try {
    const { reference } = await (await post(`${s.base}/api/bookings`, booking)).json();
    const event = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_test_1", payment_status: "paid", metadata: { booking_id: reference }, amount_total: 1000 } } });
    assert.equal((await post(`${s.base}/stripe/webhook`, event, { "Stripe-Signature": sign(event, "whsec_wrong") })).status, 400);
    assert.equal(s.store.getBooking(reference).status, "pending");
    assert.equal((await post(`${s.base}/stripe/webhook`, event, { "Stripe-Signature": sign(event, "whsec_test") })).status, 200);
    assert.equal(s.store.getBooking(reference).status, "confirmed");

    const { reference: other } = await (await post(`${s.base}/api/bookings`, { ...booking, time: "14:00" })).json();
    const expired = JSON.stringify({ type: "checkout.session.expired", data: { object: { metadata: { booking_id: other } } } });
    await post(`${s.base}/stripe/webhook`, expired, { "Stripe-Signature": sign(expired, "whsec_test") });
    assert.equal(s.store.getBooking(other).status, "expired");
  } finally { await s.close(); }
});

test("webhook signatures: old timestamps and missing secrets are refused", () => {
  const body = '{"a":1}', now = 1_800_000_000;
  assert.ok(verifyWebhook(body, sign(body, "whsec_x", now), "whsec_x", now));
  assert.ok(!verifyWebhook(body, sign(body, "whsec_x", now - 600), "whsec_x", now));
  assert.ok(!verifyWebhook(body, sign(body, "whsec_x", now), "", now));
  assert.ok(!verifyWebhook(body + " ", sign(body, "whsec_x", now), "whsec_x", now));
});

test("without Stripe set up, bookings confirm straight away", async () => {
  const config = { root, port: 0, publicUrl: "", adminPassword: "", dataDir: tmpDir() };
  const { server } = createApp({ config, loadSalon: () => salon, clock: fixedClock });
  await new Promise((r) => server.listen(0, r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await (await fetch(`${base}/api/salon`)).json()).deposit, null);
    const data = await (await post(`${base}/api/bookings`, booking)).json();
    assert.equal(data.status, "confirmed");
    assert.equal(data.checkoutUrl, undefined);
  } finally { server.close(); }
});

test("the Stripe client sends a well-formed Checkout request", async () => {
  const { makeStripe } = await import("../src/stripe.js");
  let seen;
  const stripe = makeStripe("sk_test_123", async (url, init) => {
    seen = { url, init };
    return { ok: true, json: async () => ({ id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" }) };
  });
  await stripe.createCheckoutSession({ bookingId: "ab12cd34", amountCents: 1000, currency: "eur", description: "Deposit", successUrl: "https://x/?paid={CHECKOUT_SESSION_ID}", cancelUrl: "https://x/?unpaid=ab12cd34", expiresAt: 1_800_000_000_000, phone: "+353871234567" });
  assert.equal(seen.url, "https://api.stripe.com/v1/checkout/sessions");
  assert.equal(seen.init.headers.Authorization, "Bearer sk_test_123");
  const p = new URLSearchParams(seen.init.body);
  assert.equal(p.get("mode"), "payment");
  assert.equal(p.get("line_items[0][price_data][unit_amount]"), "1000");
  assert.equal(p.get("metadata[booking_id]"), "ab12cd34");
  assert.equal(p.get("success_url"), "https://x/?paid={CHECKOUT_SESSION_ID}");
  assert.equal(p.get("expires_at"), "1800000000");
  assert.equal(makeStripe(""), null);
});
