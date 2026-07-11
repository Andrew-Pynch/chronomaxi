import { v } from "convex/values";
import { mutation, query, type QueryCtx, type MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

// Singleton countdown-timer widget backing store (see schema.ts timerState).
// No id args anywhere below -- there is exactly one row, found by scanning
// the (tiny, single-row) table rather than by a lookup key.
const FALLBACK_DURATION_MS = 1_500_000; // 25 minutes

const timerViewValidator = v.object({
    durationMs: v.number(),
    runningSince: v.union(v.number(), v.null()),
    pausedRemainingMs: v.union(v.number(), v.null()),
    running: v.boolean(),
    remainingMs: v.number(),
    updatedAt: v.number(),
});

interface TimerSnapshot {
    durationMs: number;
    runningSince?: number;
    pausedRemainingMs?: number;
    updatedAt: number;
}

// Shared by get/start/pause/reset so the client-visible shape (running,
// remainingMs) is always derived the exact same way from whatever raw row
// state each mutation just wrote, rather than re-implemented per action.
function computeView(row: TimerSnapshot | null, now: number) {
    const durationMs = row?.durationMs ?? FALLBACK_DURATION_MS;
    const running = row?.runningSince !== undefined;
    const remainingMs = running
        ? Math.max(0, durationMs - (now - (row!.runningSince as number)))
        : (row?.pausedRemainingMs ?? durationMs);
    return {
        durationMs,
        runningSince: row?.runningSince ?? null,
        pausedRemainingMs: row?.pausedRemainingMs ?? null,
        running,
        remainingMs,
        updatedAt: row?.updatedAt ?? 0,
    };
}

async function getTimerRow(ctx: QueryCtx | MutationCtx): Promise<Doc<"timerState"> | null> {
    return await ctx.db.query("timerState").first();
}

export const get = query({
    args: {},
    returns: timerViewValidator,
    handler: async (ctx) => {
        const row = await getTimerRow(ctx);
        return computeView(row, Date.now());
    },
});

// Starts (or restarts) the countdown from `durationMs` (falling back to the
// last-known durationMs, then FALLBACK_DURATION_MS if the timer has never
// run before). Always clears any frozen pausedRemainingMs -- an explicit
// start is a fresh countdown, not a resume-from-pause.
export const start = mutation({
    args: { durationMs: v.optional(v.number()) },
    returns: timerViewValidator,
    handler: async (ctx, args) => {
        const now = Date.now();
        const existing = await getTimerRow(ctx);
        const durationMs = args.durationMs ?? existing?.durationMs ?? FALLBACK_DURATION_MS;
        const next: TimerSnapshot = { durationMs, runningSince: now, updatedAt: now };
        if (existing === null) {
            await ctx.db.insert("timerState", next);
        } else {
            await ctx.db.patch(existing._id, {
                durationMs,
                runningSince: now,
                pausedRemainingMs: undefined,
                updatedAt: now,
            });
        }
        return computeView(next, now);
    },
});

// Freezes the current remaining time into pausedRemainingMs and clears
// runningSince. A no-op (just reports current state) if not running or if
// the timer has never been started.
export const pause = mutation({
    args: {},
    returns: timerViewValidator,
    handler: async (ctx) => {
        const now = Date.now();
        const existing = await getTimerRow(ctx);
        if (existing === null || existing.runningSince === undefined) {
            return computeView(existing, now);
        }
        const pausedRemainingMs = Math.max(0, existing.durationMs - (now - existing.runningSince));
        await ctx.db.patch(existing._id, {
            runningSince: undefined,
            pausedRemainingMs,
            updatedAt: now,
        });
        return computeView(
            { durationMs: existing.durationMs, pausedRemainingMs, updatedAt: now },
            now,
        );
    },
});

// Clears both runningSince and pausedRemainingMs -- back to a fully idle
// timer showing its configured durationMs with no progress. Leaves
// durationMs itself untouched (the next start-without-durationMs still
// reuses it).
export const reset = mutation({
    args: {},
    returns: timerViewValidator,
    handler: async (ctx) => {
        const now = Date.now();
        const existing = await getTimerRow(ctx);
        if (existing === null) {
            return computeView(null, now);
        }
        await ctx.db.patch(existing._id, {
            runningSince: undefined,
            pausedRemainingMs: undefined,
            updatedAt: now,
        });
        return computeView({ durationMs: existing.durationMs, updatedAt: now }, now);
    },
});
