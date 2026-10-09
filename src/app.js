import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { BookingService, BookingError } from "./bookings.js";
import { Store } from "./store.js";
import { renderPage } from "./render.js";
import { makeStripe, verifyWebhook } from "./stripe.js";
import { describeDate, describeTime, isValidDate, isValidTime, toMinutes } from "./time.js";

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
};

export function createApp({ config, loadSalon, log = console, clock = () => new Date(), stripe: stripeOverride }) {
  const store = new Store(config.dataDir);
  const bookings = new BookingService({ store, getSalon: loadSalon, clock });
  const publicDir = path.join(config.root, "public");
  const rate = new Map();
  const stripe = stripeOverride ?? makeStripe(config.stripe?.secretKey);
  // The deposit only applies once Stripe is set up; until then bookings confirm straight away.
  const depositFor = () => {
    const d = loadSalon().deposit;
    return stripe && d?.amount > 0 ? { amount: d.amount, currency: d.currency || "eur" } : null;
  };
  const HOLD_MINUTES = 35; // Stripe's checkout page stays open 31 minutes, so a payment always lands inside the hold.

  const json = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  };

  async function readRaw(req, limit = 20_000) {
    let size = 0;
    const chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > limit) throw new BookingError("Request too large.");
      chunks.push(c);
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  async function readBody(req, limit) {
    const raw = await readRaw(req, limit);
    return raw ? JSON.parse(raw) : {};
  }

  const summary = (b) => ({
    reference: b.id, status: b.status, service: b.serviceName, date: b.date, day: describeDate(b.date), time: describeTime(b.start), price: b.price,
    deposit: b.deposit ? { amount: b.deposit.amount, paid: b.deposit.paid } : null,
  });

  // Called from the redirect back and from the webhook; whichever arrives first confirms.
  function confirmFromSession(session) {
    const id = session?.metadata?.booking_id || session?.client_reference_id;
    if (!id || session.payment_status !== "paid") return id ? store.getBooking(id) : null;
    return store.confirmDeposit(id, { sessionId: session.id, paymentIntent: session.payment_intent, amountPaid: session.amount_total });
  }

  function limited(req, key, max, windowMs) {
    const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
    const k = `${key}:${ip}`, now = Date.now();
    const hits = (rate.get(k) || []).filter((t) => now - t < windowMs);
    hits.push(now);
    rate.set(k, hits);
    return hits.length > max;
  }

  function isAdmin(req) {
    const given = (req.headers.authorization || "").replace(/^Bearer /, "");
    if (!config.adminPassword || !given) return false;
    const a = crypto.createHash("sha256").update(given).digest(), b = crypto.createHash("sha256").update(config.adminPassword).digest();
    return crypto.timingSafeEqual(a, b);
  }

  function publicSalon() {
    const s = loadSalon();
    return {
      name: s.name, instagram: s.instagramHandle, hours: s.hours, maxDaysAhead: s.maxDaysAhead, today: bookings.today(),
      services: s.services.map(({ id, name, price, minutes, addOn }) => ({ id, name, price, minutes, addOn: Boolean(addOn) })),
      needsDetails: JSON.stringify(s).includes("PLACEHOLDER"),
      deposit: depositFor(),
    };
  }

  function sendPage(res, head) {
    const template = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
    const html = renderPage(template, loadSalon(), { publicUrl: config.publicUrl });
    res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": "no-cache" });
    res.end(head ? undefined : html);
  }

  async function handle(req, res) {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;

    // ---- Public booking API ----
    if (p === "/api/salon" && req.method === "GET") return json(res, 200, publicSalon());

    if (p === "/api/availability" && req.method === "GET") {
      return json(res, 200, bookings.availability({ date: url.searchParams.get("date"), serviceId: url.searchParams.get("service") }));
    }

    if (p === "/api/bookings" && req.method === "POST") {
      if (limited(req, "book", 10, 60 * 60 * 1000)) return json(res, 429, { error: "Too many bookings from this connection. Message me on Instagram instead." });
      const body = await readBody(req);
      if (body.website) return json(res, 400, { error: "Booking rejected." }); // honeypot field bots fill in
      const deposit = depositFor();
      const b = bookings.book({
        serviceId: body.service, date: body.date, time: body.time, name: body.name, phone: body.phone, notes: body.notes, source: "website",
        deposit, holdMinutes: HOLD_MINUTES,
      });
      if (!deposit) return json(res, 201, summary(b));
      try {
        const session = await stripe.createCheckoutSession({
          bookingId: b.id,
          amountCents: Math.round(deposit.amount * 100),
          currency: deposit.currency,
          description: `Deposit: ${b.serviceName}, ${describeDate(b.date)} at ${describeTime(b.start)}`,
          successUrl: `${config.publicUrl}/?paid={CHECKOUT_SESSION_ID}#book`,
          cancelUrl: `${config.publicUrl}/?unpaid=${b.id}#book`,
          expiresAt: clock().getTime() + 31 * 60_000,
          phone: b.phone,
        });
        b.deposit.sessionId = session.id;
        store.save();
        return json(res, 201, { ...summary(b), checkoutUrl: session.url });
      } catch (err) {
        store.releaseHold(b.id);
        log.error?.(err);
        return json(res, 502, { error: "Couldn't open the payment page. Try again in a minute, or message me on Instagram." });
      }
    }

    // Back from Stripe: check the payment with Stripe itself rather than trusting the URL.
    if (p === "/api/bookings/paid" && req.method === "GET") {
      if (!stripe) return json(res, 404, { error: "Not found." });
      const id = url.searchParams.get("session") || "";
      if (!/^cs_[A-Za-z0-9_]+$/.test(id)) return json(res, 400, { error: "Unknown payment." });
      const b = confirmFromSession(await stripe.retrieveSession(id));
      if (!b) return json(res, 404, { error: "Unknown payment." });
      return json(res, 200, summary(b));
    }

    // Back from Stripe without paying: free the slot straight away.
    const unpaid = p.match(/^\/api\/bookings\/([a-f0-9]{8})\/release$/);
    if (unpaid && req.method === "POST") {
      if (limited(req, "release", 30, 60 * 60 * 1000)) return json(res, 429, { error: "Too many requests." });
      store.releaseHold(unpaid[1]);
      return json(res, 200, {});
    }

    if (p === "/stripe/webhook" && req.method === "POST") {
      const raw = await readRaw(req, 1_000_000);
      if (!verifyWebhook(raw, req.headers["stripe-signature"], config.stripe?.webhookSecret, Math.floor(clock().getTime() / 1000))) {
        return json(res, 400, { error: "Bad signature." });
      }
      const event = JSON.parse(raw);
      const session = event.data?.object;
      if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") confirmFromSession(session);
      if (event.type === "checkout.session.expired") store.releaseHold(session?.metadata?.booking_id);
      return json(res, 200, { received: true });
    }

    // ---- Klaudia's diary API ----
    if (p.startsWith("/api/admin/")) {
      if (limited(req, "admin", 300, 15 * 60 * 1000)) return json(res, 429, { error: "Too many attempts. Wait a few minutes." });
      if (!isAdmin(req)) return json(res, 401, { error: "Wrong password." });

      if (p === "/api/admin/bookings" && req.method === "GET") {
        return json(res, 200, { bookings: store.listBookings({ from: url.searchParams.get("from") || bookings.today(), to: url.searchParams.get("to") || undefined }) });
      }
      const cancel = p.match(/^\/api\/admin\/bookings\/([a-f0-9]+)\/cancel$/);
      if (cancel && req.method === "POST") {
        const b = store.cancelBooking(cancel[1], "owner");
        if (!b) return json(res, 404, { error: "No confirmed booking with that reference." });
        return json(res, 200, { booking: b });
      }
      if (p === "/api/admin/blocks" && req.method === "GET") return json(res, 200, { blocks: store.listBlocks({ from: bookings.today() }) });
      if (p === "/api/admin/blocks" && req.method === "POST") {
        const body = await readBody(req);
        if (!isValidDate(body.date) || !isValidTime(body.start) || !isValidTime(body.end) || toMinutes(body.end) <= toMinutes(body.start)) {
          return json(res, 400, { error: "Give a date, a start time and a later end time." });
        }
        return json(res, 201, { block: store.addBlock({ date: body.date, start: body.start, end: body.end, reason: String(body.reason || "").slice(0, 100) }) });
      }
      const block = p.match(/^\/api\/admin\/blocks\/([a-f0-9]+)$/);
      if (block && req.method === "DELETE") return json(res, store.removeBlock(block[1]) ? 200 : 404, {});
      return json(res, 404, { error: "Not found." });
    }

    // ---- Site ----
    if (req.method === "GET" || req.method === "HEAD") {
      const head = req.method === "HEAD";
      if (p === "/" || p === "/index.html") return sendPage(res, head);
      let rel;
      try { rel = decodeURIComponent(p); } catch { rel = ""; }
      if (rel === "/admin") rel = "/admin.html";
      const file = path.normalize(path.join(publicDir, rel));
      if (rel && file.startsWith(publicDir + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "public, max-age=3600" });
        return head ? res.end() : fs.createReadStream(file).pipe(res);
      }
    }
    json(res, 404, { error: "Not found." });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (err instanceof BookingError) return json(res, 400, { error: err.message });
      if (err instanceof SyntaxError) return json(res, 400, { error: "Malformed request." });
      log.error?.(err);
      json(res, 500, { error: "Something went wrong. Message me on Instagram instead." });
    });
  });

  return { server, store, bookings };
}
