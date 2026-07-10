import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { insertSpanAndAggregate } from "./lib/spanIngest";

// Historical-import counterpart to convex/spans.ts:ingestSpanBatch. Shares
// the exact same dedupe-by-sourceKey + aggregation path via
// insertSpanAndAggregate (convex/lib/spanIngest.ts) -- the only difference
// from live ingest is that the caller (the offline migration importer) has
// already resolved rawDeviceName -> deviceName itself (by reading
// internal.deviceAliases.list once) and supplies importBatch explicitly for
// rollback/audit, instead of hardcoding "live".
const MAX_IMPORT_BATCH_SIZE = 500;

const importSpanValidator = v.object({
    sourceKey: v.string(),
    rawDeviceName: v.string(),
    deviceName: v.string(),
    actor: v.string(),
    agentName: v.optional(v.string()),
    startedAt: v.number(),
    endedAt: v.number(),
    durationMs: v.number(),
    category: v.string(),
    isIdle: v.boolean(),
    windowId: v.string(),
    programProcessName: v.string(),
    programName: v.string(),
    browserTitle: v.optional(v.string()),
    keysPressedCount: v.number(),
    mouseMovementInMM: v.number(),
    leftClickCount: v.number(),
    rightClickCount: v.number(),
    middleClickCount: v.number(),
    tokensSpent: v.optional(v.number()),
});

export const importSpanBatch = internalMutation({
    args: { spans: v.array(importSpanValidator), importBatch: v.string() },
    returns: v.object({ inserted: v.number(), skipped: v.number() }),
    handler: async (ctx, args) => {
        if (args.spans.length > MAX_IMPORT_BATCH_SIZE) {
            throw new Error(
                `import batch of ${args.spans.length} exceeds max size of ${MAX_IMPORT_BATCH_SIZE}`,
            );
        }

        let inserted = 0;
        let skipped = 0;

        for (const span of args.spans) {
            const wasInserted = await insertSpanAndAggregate(ctx, {
                ...span,
                importBatch: args.importBatch,
            });
            if (wasInserted) {
                inserted += 1;
            } else {
                skipped += 1;
            }
        }

        return { inserted, skipped };
    },
});

const checkpointValidator = v.object({
    source: v.string(),
    lastSourceRowid: v.number(),
    lastSourceLogId: v.optional(v.string()),
    spansWritten: v.number(),
    startedAt: v.number(),
    updatedAt: v.number(),
    status: v.union(
        v.literal("running"),
        v.literal("complete"),
        v.literal("failed"),
    ),
    importBatch: v.string(),
});

export const getImportCheckpoint = internalQuery({
    args: { source: v.string() },
    returns: v.union(checkpointValidator, v.null()),
    handler: async (ctx, args) => {
        const row = await ctx.db
            .query("migrationCheckpoints")
            .withIndex("by_source", (q) => q.eq("source", args.source))
            .unique();
        if (row === null) return null;
        return {
            source: row.source,
            lastSourceRowid: row.lastSourceRowid,
            lastSourceLogId: row.lastSourceLogId,
            spansWritten: row.spansWritten,
            startedAt: row.startedAt,
            updatedAt: row.updatedAt,
            status: row.status,
            importBatch: row.importBatch,
        };
    },
});

export const setImportCheckpoint = internalMutation({
    args: {
        source: v.string(),
        lastSourceRowid: v.number(),
        lastSourceLogId: v.optional(v.string()),
        spansWritten: v.number(),
        status: v.union(
            v.literal("running"),
            v.literal("complete"),
            v.literal("failed"),
        ),
        importBatch: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const now = Date.now();
        const existing = await ctx.db
            .query("migrationCheckpoints")
            .withIndex("by_source", (q) => q.eq("source", args.source))
            .unique();

        if (existing === null) {
            await ctx.db.insert("migrationCheckpoints", {
                source: args.source,
                lastSourceRowid: args.lastSourceRowid,
                lastSourceLogId: args.lastSourceLogId,
                spansWritten: args.spansWritten,
                startedAt: now,
                updatedAt: now,
                status: args.status,
                importBatch: args.importBatch,
            });
        } else {
            await ctx.db.patch(existing._id, {
                lastSourceRowid: args.lastSourceRowid,
                lastSourceLogId: args.lastSourceLogId,
                spansWritten: args.spansWritten,
                updatedAt: now,
                status: args.status,
                importBatch: args.importBatch,
            });
        }
        return null;
    },
});
