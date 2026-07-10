// Loads migration/.env.local (if present) into process.env, resolved relative
// to this file rather than the process cwd -- so `bun run import.ts` works the
// same whether invoked from migration/ or the repo root. Bun auto-loads
// .env.local from cwd already; this is a defensive no-surprises fallback for
// vars it didn't pick up (existing process.env values always win).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ENV_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", ".env.local");

export function loadLocalEnv(): void {
    let contents: string;
    try {
        contents = readFileSync(ENV_PATH, "utf8");
    } catch {
        return;
    }
    for (const line of contents.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = value;
    }
}
