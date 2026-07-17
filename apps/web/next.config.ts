import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// Load the repo-root .env so web + worker share one env file; values already
// set (e.g. by apps/web/.env.local or the host) win.
const rootEnv = path.join(__dirname, "..", "..", ".env");
if (existsSync(rootEnv)) {
  for (const line of readFileSync(rootEnv, "utf-8").split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (match && match[1] && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2] ?? "";
    }
  }
}

const nextConfig: NextConfig = {};

export default nextConfig;
