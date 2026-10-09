import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { bookingsCalendar } from "../src/calendar.js";
import { zonedToUtc } from "../src/time.js";
import { root, salon, fixedClock, tmpDir } from "./helpers.js";

async function start(calendarToken = "cal-secret-123") {
  const config = { root, port: 0, publicUrl: "https://klaudia.example", adminPassword: "secret", dataDir: tmpDir(), calendarToken };
  const app = createApp({ config, loadSalon: () => salon, clock: fixedClock, log: { error() {} } });
  await new Promise((r) => app.server.listen(0, r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return { ...app, base, close: () => new Promise((r) => { app.server.closeAllConnections?.(); app.server.close(r); }) };
}

const book = (base, body) => fetch(`${base}/api/bookings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("Dublin wall-clock times convert to UTC across the clock change", () => {
  assert.equal(zonedToUtc("2026-10-08", "10:00", "Europe/Dublin").toISOString(), "2026-10-08T09:00:00.000Z"); // summer time
  assert.equal(zonedToUtc("2026-11-05", "10:00", "Europe/Dublin").toISOString(), "2026-11-05T10:00:00.000Z"); // winter time
  assert.equal(zonedToUtc("2026-10-25", "18:00", "Europe/Dublin").toISOString(), "2026-10-25T18:00:00.000Z"); // day the clocks go back
});

test("the feed lists confirmed bookings and leaves out cancelled ones", async () => {
  const s = await start();
  try {
    await book(s.base, { service: "biab", date: "2026-10-08", time: "10:00", name: "Aoife", phone: "087 123 4567", notes: "Chrome, French; please" });
    const { reference } = await (await book(s.base, { service: "shellac", date: "2026-10-09", time: "11:00", name: "Gone", phone: "0861111111" })).json();
    s.store.cancelBooking(reference, "owner");
    const res = await fetch(`${s.base}/calendar/cal-secret-123.ics`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /^text\/calendar/);
    const ics = await res.text();
    assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
    assert.match(ics, /SUMMARY:BIAB: Aoife\r\n/);
    assert.match(ics, /DTSTART:20261008T090000Z\r\nDTEND:20261008T101500Z\r\n/);
    assert.match(ics, /Notes: Chrome\\, French\; please/);
    assert.doesNotMatch(ics, /Gone/);
    assert.ok(ics.split("\r\n").every((l) => Buffer.byteLength(l) <= 75), "lines are folded");
  } finally { await s.close(); }
});

test("the feed needs the exact secret, and is off without one", async () => {
  const s = await start();
  try {
    assert.equal((await fetch(`${s.base}/calendar/wrong.ics`)).status, 404);
    assert.equal((await fetch(`${s.base}/calendar/cal-secret-12.ics`)).status, 404);
    const link = await (await fetch(`${s.base}/api/admin/calendar`, { headers: { Authorization: "Bearer secret" } })).json();
    assert.equal(link.url, "webcal://klaudia.example/calendar/cal-secret-123.ics");
    assert.equal((await fetch(`${s.base}/api/admin/calendar`)).status, 401);
  } finally { await s.close(); }
  const off = await start("");
  try {
    assert.equal((await fetch(`${off.base}/calendar/.ics`)).status, 404);
    assert.equal((await fetch(`${off.base}/calendar/undefined.ics`)).status, 404);
    assert.equal((await (await fetch(`${off.base}/api/admin/calendar`, { headers: { Authorization: "Bearer secret" } })).json()).url, null);
  } finally { await off.close(); }
});

test("long descriptions fold without splitting characters", () => {
  const ics = bookingsCalendar([{ id: "ab12cd34", status: "confirmed", date: "2026-10-08", start: "10:00", end: "11:00", serviceName: "Gel extension", name: "Siobhán Ní Bhriain", phone: "+353871234567", price: "from €45", notes: "€".repeat(60) }], salon, fixedClock());
  for (const line of ics.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75);
  const unfolded = ics.replace(/\r\n /g, "");
  assert.match(unfolded, new RegExp(`Notes: ${"€".repeat(60)}`));
  assert.match(unfolded, /SUMMARY:Gel extension: Siobhán Ní Bhriain/);
});
