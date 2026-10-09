import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { BookingService, BookingError } from "./bookings.js";
import { Store } from "./store.js";
import { renderPage } from "./render.js";
import { describeDate, describeTime, isValidDate, isValidTime, toMinutes } from "./time.js";

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
};

export function createApp({ config, loadSalon, log = console, clock }) {
  const store = new Store(config.dataDir);
  const bookings = new BookingService({ store, getSalon: loadSalon, clock });
  const publicDir = path.join(config.root, "public");
  const rate = new Map();

  const json = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  };

  async function readBody(req, limit = 20_000) {
    let size = 0;
    const chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > limit) throw new BookingError("Request too large.");
      chunks.push(c);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    return raw ? JSON.parse(raw) : {};
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
      const b = bookings.book({
        serviceId: body.service, date: body.date, time: body.time, name: body.name, phone: body.phone, notes: body.notes, source: "website",
      });
      return json(res, 201, { reference: b.id, service: b.serviceName, date: b.date, day: describeDate(b.date), time: describeTime(b.start), price: b.price });
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
