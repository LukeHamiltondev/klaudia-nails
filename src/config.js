import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Minimal .env loader so the app runs without extra packages.
const envFile = path.join(root, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const env = process.env;

export const config = {
  root,
  port: Number(env.PORT || 3000),
  // On Railway, PUBLIC_URL and DATA_DIR fall back to the service's domain and attached volume.
  publicUrl: (env.PUBLIC_URL || (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${env.PORT || 3000}`)).replace(/\/$/, ""),
  adminPassword: env.ADMIN_PASSWORD || "",
  dataDir: path.resolve(root, env.DATA_DIR || env.RAILWAY_VOLUME_MOUNT_PATH || "data"),
  // Stripe deposit: off until STRIPE_SECRET_KEY is set.
  stripe: { secretKey: env.STRIPE_SECRET_KEY || "", webhookSecret: env.STRIPE_WEBHOOK_SECRET || "" },
  salonFile: path.resolve(root, env.SALON_CONFIG || "config/salon.json"),
};

export function loadSalon() {
  return JSON.parse(fs.readFileSync(config.salonFile, "utf8"));
}
