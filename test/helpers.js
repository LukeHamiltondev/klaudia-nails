import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const salon = JSON.parse(fs.readFileSync(path.join(root, "config/salon.json"), "utf8"));
// Wednesday 7 October 2026, 11:00 in Dublin.
export const fixedClock = () => new Date("2026-10-07T10:00:00Z");
export const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "kn-"));
