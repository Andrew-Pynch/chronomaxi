import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { deriveSpanDeltas } from "./lib/aggregation";
import { applyAggregateDeltas } from "./lib/spanIngest";

// Rebuild-from-scratch machinery driving scripts/rebuild-aggregates.ts. One
// call to `rebuildAggregates` does exactly ONE page of work (a wipe page or
// a replay page) and returns the resulting phase, so the script's own loop
// controls pacing/logging while all resumable state (which table, which
// cursor, the replay watermark) lives server-side in rebuildCheckpoints,
// keyed by `runId` -- calling again with the same runId after a crash
// simply continues from the last committed page, atomically, since the
// cursor advance and the page's actual writes commit in the same
// transaction.
//
// Never invoked from live ingest or the dashboard; internal-only, meant to
// be run by an operator via the script with trackers stopped (see the
// script's own --yes preconditions banner).

const WIPE_BATCH_SIZE = 1000;
const REPLAY_BATCH_SIZE = 250;

const WIPE_TABLES = [
    "dayAgg",
    "hourAgg",
    "programAgg",
    "categoryAgg",
    "programDetailAgg",
] as const;
type WipeTable = (typeof WIPE_TABLES)[number];

const rebuildStepResultValidator = v.object({
    phase: v.union(v.literal("wipe"), v.literal("replay"), v.literal("complete")),
    done: v.boolean(),
    wipeTable: v.optional(v.string()),
    deletedThisPage: v.number(),
    replayedThisPage: v.number(),
    totalSpansReplayed: v.number(),
});

async function runWipePage(
    ctx: MutationCtx,
    checkpoint: Doc<"rebuildCheckpoints">,
    now: number,
) {
    const table: WipeTable = checkpoint.wipeTable ?? WIPE_TABLES[0];
    const page = await ctx.db
        .query(table)
        .paginate({ cursor: checkpoint.wipeCursor ?? null, numItems: WIPE_BATCH_SIZE });
    for (const doc of page.page) {
        await ctx.db.delete(doc._id);
    }

    if (!page.isDone) {
        await ctx.db.patch(checkpoint._id, {
            wipeTable: table,
            wipeCursor: page.continueCursor,
            updatedAt: now,
        });
        return {
            phase: "wipe" as const,
            done: false,
            wipeTable: table,
            deletedThisPage: page.page.length,
            replayedThisPage: 0,
            totalSpansReplayed: checkpoint.spansReplayed,
        };
    }

    const nextTable = WIPE_TABLES[WIPE_TABLES.indexOf(table) + 1];
    if (nextTable === undefined) {
        await ctx.db.patch(checkpoint._id, {
            phase: "replay",
            wipeTable: undefined,
            wipeCursor: undefined,
            replayCursor: undefined,
            updatedAt: now,
        });
        return {
            phase: "replay" as const,
            done: false,
            wipeTable: undefined,
            deletedThisPage: page.page.length,
            replayedThisPage: 0,
            totalSpansReplayed: checkpoint.spansReplayed,
        };
    }

    await ctx.db.patch(checkpoint._id, {
        wipeTable: nextTable,
        wipeCursor: undefined,
        updatedAt: now,
    });
    return {
        phase: "wipe" as const,
        done: false,
        wipeTable: nextTable,
        deletedThisPage: page.page.length,
        replayedThisPage: 0,
        totalSpansReplayed: checkpoint.spansReplayed,
    };
}

async function runReplayPage(
    ctx: MutationCtx,
    checkpoint: Doc<"rebuildCheckpoints">,
    now: number,
) {
    const page = await ctx.db
        .query("spans")
        .paginate({ cursor: checkpoint.replayCursor ?? null, numItems: REPLAY_BATCH_SIZE });

    let replayedThisPage = 0;
    let watermarkReached = false;
    for (const span of page.page) {
        // Ascending _creationTime order (Convex's default, unindexed scan
        // order) guarantees every later span in this page and every later
        // page is also past the watermark once we see the first one --
        // safe to stop the whole replay here rather than skip-and-continue.
        if (span._creationTime > checkpoint.watermark) {
            watermarkReached = true;
            break;
        }
        const deltas = deriveSpanDeltas({
            startedAt: span.startedAt,
            durationMs: span.durationMs,
            category: span.category,
            isIdle: span.isIdle,
            actor: span.actor,
            deviceName: span.deviceName,
            programName: span.programName,
            subProgram: span.subProgram,
            keysPressedCount: span.keysPressedCount,
            mouseMovementInMM: span.mouseMovementInMM,
            leftClickCount: span.leftClickCount,
            rightClickCount: span.rightClickCount,
            middleClickCount: span.middleClickCount,
        });
        await applyAggregateDeltas(ctx, deltas);
        replayedThisPage += 1;
    }

    const totalSpansReplayed = checkpoint.spansReplayed + replayedThisPage;
    const isDone = watermarkReached || page.isDone;

    await ctx.db.patch(checkpoint._id, {
        phase: isDone ? "complete" : "replay",
        replayCursor: isDone ? undefined : page.continueCursor,
        spansReplayed: totalSpansReplayed,
        updatedAt: now,
    });

    return {
        phase: (isDone ? "complete" : "replay") as "complete" | "replay",
        done: isDone,
        wipeTable: undefined,
        deletedThisPage: 0,
        replayedThisPage,
        totalSpansReplayed,
    };
}

// Advances the named rebuild run by exactly one page. First call for a
// fresh `runId` creates its checkpoint (capturing `watermark` = now, the
// _creationTime cutoff replay will never exceed) and starts the wipe phase.
export const rebuildAggregates = internalMutation({
    args: { runId: v.string() },
    returns: rebuildStepResultValidator,
    handler: async (ctx, args) => {
        const now = Date.now();
        let checkpoint = await ctx.db
            .query("rebuildCheckpoints")
            .withIndex("by_runId", (q) => q.eq("runId", args.runId))
            .unique();

        if (checkpoint === null) {
            const _id = await ctx.db.insert("rebuildCheckpoints", {
                runId: args.runId,
                phase: "wipe",
                watermark: now,
                wipeTable: WIPE_TABLES[0],
                wipeCursor: undefined,
                replayCursor: undefined,
                spansReplayed: 0,
                startedAt: now,
                updatedAt: now,
            });
            checkpoint = await ctx.db.get(_id);
            if (checkpoint === null) {
                throw new Error("rebuildCheckpoints row disappeared immediately after insert");
            }
        }

        if (checkpoint.phase === "wipe") {
            return await runWipePage(ctx, checkpoint, now);
        }
        if (checkpoint.phase === "replay") {
            return await runReplayPage(ctx, checkpoint, now);
        }
        return {
            phase: "complete" as const,
            done: true,
            wipeTable: undefined,
            deletedThisPage: 0,
            replayedThisPage: 0,
            totalSpansReplayed: checkpoint.spansReplayed,
        };
    },
});

const bucketCountsValidator = v.object({
    dayAgg: v.number(),
    hourAgg: v.number(),
    programAgg: v.number(),
    categoryAgg: v.number(),
    programDetailAgg: v.number(),
});

// One-shot end-of-rebuild report. Every table here is small (devices x
// days x programs, at most), so a full collect() per table is fine -- this
// is never called from live ingest or the dashboard's hot path.
export const bucketCounts = internalQuery({
    args: {},
    returns: bucketCountsValidator,
    handler: async (ctx) => {
        const [dayAgg, hourAgg, programAgg, categoryAgg, programDetailAgg] = await Promise.all([
            ctx.db.query("dayAgg").collect(),
            ctx.db.query("hourAgg").collect(),
            ctx.db.query("programAgg").collect(),
            ctx.db.query("categoryAgg").collect(),
            ctx.db.query("programDetailAgg").collect(),
        ]);
        return {
            dayAgg: dayAgg.length,
            hourAgg: hourAgg.length,
            programAgg: programAgg.length,
            categoryAgg: categoryAgg.length,
            programDetailAgg: programDetailAgg.length,
        };
    },
});
