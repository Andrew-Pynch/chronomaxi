// Dual-persisted resume cursor: Convex's migrationCheckpoints table is
// authoritative (it reflects state regardless of which machine the importer
// last ran on), with a local JSON mirror as a fallback so an interrupted run
// can still resume, or at least be inspected, if Convex is briefly
// unreachable at startup. Every save writes local FIRST (cheap, always
// succeeds) then Convex (retried a few times; a persistent Convex outage
// surfaces as a thrown error rather than silently losing the checkpoint).

import type { ConvexHttpClient } from "convex/browser";
import { fn } from "./convex-client";
import { readLocalCheckpoint, writeLocalCheckpoint, type LocalCheckpoint } from "./local-checkpoint";
import { sleep } from "./sleep";

export interface ImportCheckpoint {
    dataset: string;
    lastSourceRowid: number;
    lastSourceLogId: string | null;
    spansWritten: number;
    status: "running" | "complete" | "failed";
    importBatch: string;
}

function isCheckpointDoc(value: unknown): value is {
    lastSourceRowid: number;
    lastSourceLogId?: string | null;
    spansWritten: number;
    status: string;
    importBatch: string;
} {
    if (typeof value !== "object" || value === null) return false;
    const v = value as Record<string, unknown>;
    return (
        typeof v.lastSourceRowid === "number" &&
        typeof v.spansWritten === "number" &&
        typeof v.status === "string" &&
        typeof v.importBatch === "string"
    );
}

export class CheckpointManager {
    private readonly client: ConvexHttpClient;
    private readonly dataset: string;

    constructor(client: ConvexHttpClient, dataset: string) {
        this.client = client;
        this.dataset = dataset;
    }

    async load(): Promise<ImportCheckpoint | null> {
        try {
            const remote: unknown = await this.client.query(fn.getImportCheckpoint, { source: this.dataset });
            if (remote !== null && remote !== undefined) {
                if (!isCheckpointDoc(remote)) {
                    throw new Error(`getImportCheckpoint returned an unexpected shape: ${JSON.stringify(remote)}`);
                }
                return {
                    dataset: this.dataset,
                    lastSourceRowid: remote.lastSourceRowid,
                    lastSourceLogId: remote.lastSourceLogId ?? null,
                    spansWritten: remote.spansWritten,
                    status: remote.status as ImportCheckpoint["status"],
                    importBatch: remote.importBatch,
                };
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.warn(`[checkpoint] convex getImportCheckpoint failed, falling back to local mirror: ${message}`);
        }
        const local = readLocalCheckpoint(this.dataset);
        return local
            ? {
                  dataset: local.dataset,
                  lastSourceRowid: local.lastSourceRowid,
                  lastSourceLogId: local.lastSourceLogId,
                  spansWritten: local.spansWritten,
                  status: local.status,
                  importBatch: local.importBatch,
              }
            : null;
    }

    async save(checkpoint: ImportCheckpoint): Promise<void> {
        const local: LocalCheckpoint = { ...checkpoint, updatedAt: new Date().toISOString() };
        writeLocalCheckpoint(local);

        const maxRetries = 3;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                await this.client.mutation(fn.setImportCheckpoint, {
                    source: checkpoint.dataset,
                    lastSourceRowid: checkpoint.lastSourceRowid,
                    lastSourceLogId: checkpoint.lastSourceLogId ?? undefined,
                    spansWritten: checkpoint.spansWritten,
                    status: checkpoint.status,
                    importBatch: checkpoint.importBatch,
                });
                return;
            } catch (err) {
                if (attempt === maxRetries) throw err;
                const message = err instanceof Error ? err.message : String(err);
                const backoffMs = 250 * 2 ** attempt;
                console.warn(`[checkpoint] setImportCheckpoint failed, retrying in ${backoffMs}ms: ${message}`);
                await sleep(backoffMs);
            }
        }
    }
}
