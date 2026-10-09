import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { root, salon, fixedClock, tmpDir } from "./helpers.js";

async function start(overrides = {}) {
  const config = { root, port: 0, publicUrl: "https://example.ie", adminPassword: "secret", dataDir: tmpDir() };
  const app = createApp({ config, loadSalon: () => ({ ...salon, ...overrides }), clock: fixedClock, log: { error() {} } });
  await new Promise((r) => app.server.listen(0, r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return { ...app, base, close: () => new Promise((r) => { app.server.closeAllConnections?.(); app.server.close(r); }) };
}

const post = (url, body, headers = {}) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

test("the page shows every price, the hours and the booking form", async () => {
  const s = await start();
  try {
    const html = await (await fetch(`${s.base}/`)).text();
    for (const x of salon.services) {
      assert.ok(html.includes(x.name), x.name);
      assert.ok(html.includes(x.price), x.price);
    }
    assert.doesNotMatch(html, /\{\{\w+\}\}/, "no template slot left unfilled");
    assert.doesNotMatch(html, /PLACEHOLDER/, "placeholders never reach the page");
    assert.match(html, /Address to confirm/);
    assert.match(html, /10am to 6pm/);
    assert.match(html, /id="booking"/);
    assert.match(html, /href="\/admin"/);
  } finally { await s.close(); }
});

test("real details replace the 'to confirm' notes", async () => {
  const s = await start({ address: "1 Main Street", phoneDisplay: "087 123 4567" });
  try {
    const html = await (await fetch(`${s.base}/`)).text();
    assert.match(html, /1 Main Street/);
    assert.match(html, /href="tel:0871234567"/);
    assert.doesNotMatch(html, /Address to confirm|Phone number to confirm/);
  } finally { await s.close(); }
});

test("text from salon.json is escaped", async () => {
  const s = await start({ tagline: "<script>alert(1)</script>" });
  try {
    const html = await (await fetch(`${s.base}/`)).text();
    assert.ok(!html.includes("<script>alert(1)</script>"));
    assert.ok(html.includes("&lt;script&gt;"));
  } finally { await s.close(); }
});

test("booking online: availability, booking, double booking refused", async () => {
  const s = await start();
  try {
    const info = await (await fetch(`${s.base}/api/salon`)).json();
    assert.equal(info.today, "2026-10-07");
    assert.equal(info.needsDetails, true);
    const av = await (await fetch(`${s.base}/api/availability?date=2026-10-08&service=biab`)).json();
    assert.ok(av.times.includes("10:00"));
    const body = { service: "biab", date: "2026-10-08", time: "10:00", name: "Aoife", phone: "087 123 4567" };
    const r = await post(`${s.base}/api/bookings`, body);
    assert.equal(r.status, 201);
    assert.equal((await r.json()).price, "€35");
    const again = await post(`${s.base}/api/bookings`, { ...body, phone: "0861111111" });
    assert.equal(again.status, 400);
    assert.match((await again.json()).error, /no longer free/);
    assert.equal((await post(`${s.base}/api/bookings`, { ...body, time: "15:00", website: "spam" })).status, 400);
  } finally { await s.close(); }
});

test("the diary needs the password", async () => {
  const s = await start();
  try {
    assert.equal((await fetch(`${s.base}/admin`)).status, 200);
    assert.equal((await fetch(`${s.base}/api/admin/bookings`)).status, 401);
    assert.equal((await fetch(`${s.base}/api/admin/bookings`, { headers: { Authorization: "Bearer nope" } })).status, 401);
    const auth = { Authorization: "Bearer secret" };
    await post(`${s.base}/api/bookings`, { service: "shellac", date: "2026-10-08", time: "11:00", name: "Aoife", phone: "0871234567" });
    const { bookings } = await (await fetch(`${s.base}/api/admin/bookings`, { headers: auth })).json();
    assert.equal(bookings.length, 1);
    assert.equal((await post(`${s.base}/api/admin/bookings/${bookings[0].id}/cancel`, {}, auth)).status, 200);
    const block = await post(`${s.base}/api/admin/blocks`, { date: "2026-10-08", start: "13:00", end: "14:00" }, auth);
    assert.equal(block.status, 201);
    const av = await (await fetch(`${s.base}/api/availability?date=2026-10-08&service=nail-fix`)).json();
    assert.ok(av.times.includes("11:00") && !av.times.includes("13:00"));
  } finally { await s.close(); }
});

test("an empty ADMIN_PASSWORD locks the diary rather than opening it", async () => {
  const config = { root, port: 0, publicUrl: "", adminPassword: "", dataDir: tmpDir() };
  const { server } = createApp({ config, loadSalon: () => salon, clock: fixedClock });
  await new Promise((r) => server.listen(0, r));
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/bookings`, { headers: { Authorization: "Bearer " } });
    assert.equal(r.status, 401);
  } finally { server.close(); }
});

test("photos are served and files outside public/ are not", async () => {
  const s = await start();
  try {
    for (const g of salon.gallery) {
      const r = await fetch(`${s.base}/${g.src}`);
      assert.equal(r.status, 200, g.src);
      assert.equal(r.headers.get("content-type"), "image/jpeg");
    }
    assert.equal((await fetch(`${s.base}/../config/salon.json`)).status, 404);
    assert.equal((await fetch(`${s.base}/%2e%2e/config/salon.json`)).status, 404);
    assert.equal((await fetch(`${s.base}/%E0%A4%A`)).status, 404);
    assert.equal((await fetch(`${s.base}/nope.png`)).status, 404);
  } finally { await s.close(); }
});
