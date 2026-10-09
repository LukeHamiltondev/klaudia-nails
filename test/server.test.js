import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/app.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const salon = JSON.parse(fs.readFileSync(path.join(root, "config/salon.json"), "utf8"));

async function start(overrides = {}) {
  const config = { root, port: 0, publicUrl: "https://example.ie" };
  const app = createApp({ config, loadSalon: () => ({ ...salon, ...overrides }), log: { error() {} } });
  await new Promise((r) => app.server.listen(0, r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return { base, close: () => new Promise((r) => { app.server.closeAllConnections?.(); app.server.close(r); }) };
}

test("the page shows every price from salon.json", async () => {
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
    assert.match(html, /href="https:\/\/ig\.me\/m\/klaudiakanails"/);
  } finally { await s.close(); }
});

test("real details replace the 'to confirm' notes", async () => {
  const s = await start({ address: "1 Main Street", phoneDisplay: "087 123 4567", bookingUrl: "https://book.example/klaudia", hours: { ...salon.hours, mon: "10am to 6pm" } });
  try {
    const html = await (await fetch(`${s.base}/`)).text();
    assert.match(html, /1 Main Street/);
    assert.match(html, /href="tel:0871234567"/);
    assert.match(html, /href="https:\/\/book\.example\/klaudia"/);
    assert.match(html, /Book online/);
    assert.match(html, /10am to 6pm/);
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
    assert.equal((await fetch(`${s.base}/nope.png`)).status, 404);
    assert.equal((await fetch(`${s.base}/`, { method: "POST" })).status, 405);
  } finally { await s.close(); }
});

test("health check reports missing details", async () => {
  const s = await start();
  try {
    const info = await (await fetch(`${s.base}/api/salon`)).json();
    assert.equal(info.services.length, salon.services.length);
    assert.equal(info.needsDetails, true);
  } finally { await s.close(); }
});
