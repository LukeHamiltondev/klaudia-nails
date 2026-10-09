import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { renderPage } from "./render.js";

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
};

export function createApp({ config, loadSalon, log = console }) {
  const publicDir = path.join(config.root, "public");

  function sendPage(res, head) {
    const template = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
    const html = renderPage(template, loadSalon(), { publicUrl: config.publicUrl });
    res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": "no-cache" });
    res.end(head ? undefined : html);
  }

  function sendStatic(res, urlPath, head) {
    let rel;
    try { rel = decodeURIComponent(urlPath); } catch { rel = ""; }
    const file = path.join(publicDir, path.normalize(rel));
    if (!rel || !file.startsWith(publicDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "public, max-age=3600" });
    if (head) return res.end();
    fs.createReadStream(file).pipe(res);
  }

  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, "http://x");
      const head = req.method === "HEAD";
      if (req.method !== "GET" && !head) {
        res.writeHead(405, { Allow: "GET, HEAD" });
        return res.end();
      }
      if (url.pathname === "/" || url.pathname === "/index.html") return sendPage(res, head);
      if (url.pathname === "/api/salon") {
        const s = loadSalon();
        const body = { name: s.name, instagram: s.instagramHandle, services: s.services, needsDetails: JSON.stringify(s).includes("PLACEHOLDER") };
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(head ? undefined : JSON.stringify(body));
      }
      return sendStatic(res, url.pathname, head);
    } catch (err) {
      log.error(err);
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Something went wrong.");
    }
  });

  return { server };
}
