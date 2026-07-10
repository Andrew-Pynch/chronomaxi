// Local JSON checkpoint fallback, mirrored alongside the durable Convex
// migrationCheckpoints table (see convex-client.ts). Convex is the
// authoritative resume cursor -- it is consulted first on startup, since it
// reflects state from ANY machine the importer has run on -- but every
// successful checkpoint write is also mirrored here so an operator can resume
// (or at least inspect progress) even if the Convex deployment is temporarily
// unreachable at startup. Written after every checkpoint-worthy batch flush,
// so "kill -9 the importer at any point, restart" always resumes from at most
// one batch of rework, never a full restart from rowid 0.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface LocalCheckpoint {
    dataset: string;
    lastSourceRowid: number;
    lastSourceLogId: string | null;
    spansWritten: number;
    status: "running" | "complete" | "failed";
    importBatch: string;
    updatedAt: string;
}

const CHECKPOINT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", ".checkpoints");

function checkpointPath(dataset: string): string {
    return join(CHECKPOINT_DIR, `${dataset}.json`);
}

const VALID_STATUSES: Record<string, true> = { running: true, complete: true, failed: true };

function isLocalCheckpoint(value: unknown): value is LocalCheckpoint {
    if (typeof value !== "object" || value === null) return false;
    const v = value as Record<string, unknown>;
    return (
        typeof v.dataset === "string" &&
        typeof v.lastSourceRowid === "number" &&
        (typeof v.lastSourceLogId === "string" || v.lastSourceLogId === null) &&
        typeof v.spansWritten === "number" &&
        typeof v.status === "string" &&
        VALID_STATUSES[v.status] === true &&
        typeof v.importBatch === "string" &&
        typeof v.updatedAt === "string"
    );
}

export function readLocalCheckpoint(dataset: string): LocalCheckpoint | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(readFileSync(checkpointPath(dataset), "utf8"));
    } catch {
        return null;
    }
    return isLocalCheckpoint(parsed) ? parsed : null;
}

export function writeLocalCheckpoint(checkpoint: LocalCheckpoint): void {
    mkdirSync(CHECKPOINT_DIR, { recursive: true });
    writeFileSync(checkpointPath(checkpoint.dataset), JSON.stringify(checkpoint, null, 4));
}
