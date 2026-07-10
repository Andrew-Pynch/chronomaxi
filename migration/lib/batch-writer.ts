// Adaptive-batch Convex writer: sends compacted spans to internal.migration
// .importSpanBatch in chunks of `currentBatchSize` (default 400 per Main's
// contract), halving on any error that looks like a Convex per-transaction
// limit violation (16,000 docs / 16MiB written, 32,000 docs / 16MiB read,
// 4,096 index-range reads -- see agent://MigrationDesign's
// convex_operational_limits_used) and retrying the SAME chunk at the smaller
// size. Non-limit errors get a short bounded retry (transient network/OCC
// conflicts) before propagating, since "safe to kill/restart anytime" makes
// crashing an acceptable failure mode once retries are exhausted.

import type { ConvexHttpClient } from "convex/browser";
import { fn } from "./convex-client";
import type { CompactedSpan } from "./compaction";
import { sleep } from "./sleep";

export interface SpanImportInput {
    sourceKey: string;
    rawDeviceName: string;
    deviceName: string;
    actor: "human" | `agent:${string}`;
    agentName?: string;
    startedAt: number;
    endedAt: number;
    durationMs: number;
    category: string;
    isIdle: boolean;
    windowId: string;
    programProcessName: string;
    programName: string;
    browserTitle?: string;
    keysPressedCount: number;
    mouseMovementInMM: number;
    leftClickCount: number;
    rightClickCount: number;
    middleClickCount: number;
    tokensSpent?: number;
}

export function toSpanImportInput(span: CompactedSpan): SpanImportInput {
    return {
        sourceKey: span.sourceKey,
        rawDeviceName: span.rawDeviceName,
        deviceName: span.deviceName,
        actor: "human",
        startedAt: span.startedAt,
        endedAt: span.endedAt,
        durationMs: span.durationMs,
        category: span.category,
        isIdle: span.isIdle,
        windowId: span.windowId,
        programProcessName: span.programProcessName,
        programName: span.programName,
        browserTitle: span.browserTitle ?? undefined,
        keysPressedCount: span.keysPressedCount,
        mouseMovementInMM: span.mouseMovementInMM,
        leftClickCount: span.leftClickCount,
        rightClickCount: span.rightClickCount,
        middleClickCount: span.middleClickCount,
    };
}

interface ImportSpanBatchResult {
    inserted: number;
    skipped: number;
}

function isImportSpanBatchResult(value: unknown): value is ImportSpanBatchResult {
    if (typeof value !== "object" || value === null) return false;
    const v = value as Record<string, unknown>;
    return typeof v.inserted === "number" && typeof v.skipped === "number";
}

const LIMIT_ERROR_RE = /too many|too much|exceeded|limit|transaction is too large/i;
const MAX_RETRIES = 4;
const MIN_BATCH_SIZE = 1;

export class AdaptiveBatchWriter {
    private readonly client: ConvexHttpClient;
    private readonly importBatch: string;
    currentBatchSize: number;
    totalInserted = 0;
    totalSkipped = 0;

    constructor(client: ConvexHttpClient, importBatch: string, initialBatchSize: number) {
        this.client = client;
        this.importBatch = importBatch;
        this.currentBatchSize = initialBatchSize;
    }

    /** Writes every span in `spans`, sub-chunked at `currentBatchSize` (which
     * may shrink mid-call on a limit error -- the next sub-chunk picks up the
     * new, smaller size automatically). */
    async write(spans: SpanImportInput[]): Promise<void> {
        let offset = 0;
        while (offset < spans.length) {
            const size = Math.min(this.currentBatchSize, spans.length - offset);
            const chunk = spans.slice(offset, offset + size);
            const wrote = await this.tryWriteChunk(chunk);
            if (wrote) offset += size;
            // else: currentBatchSize was just halved; retry this same offset,
            // now producing a smaller chunk on the next loop iteration.
        }
    }

    /** Returns true on success, false if it halved currentBatchSize and the
     * caller should retry at the (now smaller) size. Throws after exhausting
     * retries on a non-limit error. */
    private async tryWriteChunk(chunk: SpanImportInput[]): Promise<boolean> {
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                const result: unknown = await this.client.mutation(fn.importSpanBatch, {
                    spans: chunk,
                    importBatch: this.importBatch,
                });
                if (!isImportSpanBatchResult(result)) {
                    throw new Error(`importSpanBatch returned an unexpected shape: ${JSON.stringify(result)}`);
                }
                this.totalInserted += result.inserted;
                this.totalSkipped += result.skipped;
                return true;
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                if (LIMIT_ERROR_RE.test(message) && chunk.length > MIN_BATCH_SIZE) {
                    this.currentBatchSize = Math.max(MIN_BATCH_SIZE, Math.floor(chunk.length / 2));
                    console.warn(
                        `[import] convex limit error on batch of ${chunk.length}, halving batch size to ${this.currentBatchSize}: ${message}`
                    );
                    return false;
                }
                if (attempt === MAX_RETRIES) throw err;
                const backoffMs = 250 * 2 ** attempt;
                console.warn(
                    `[import] mutation failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${backoffMs}ms: ${message}`
                );
                await sleep(backoffMs);
            }
        }
        return false;
    }
}
