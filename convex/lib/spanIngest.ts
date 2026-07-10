import type { MutationCtx } from "../_generated/server";
import { deriveSpanDeltas } from "./aggregation";

// The exact shape written into the `spans` table by BOTH entry points (live
// HTTP ingest and historical migration import). Optional wire fields must
// already be normalized to 0/undefined by the caller before this is built --
// this module never guesses a default.
export interface NormalizedSpanInsert {
    sourceKey: string;
    rawDeviceName: string;
    deviceName: string;
    actor: string;
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
    importBatch: string;
}

// Inserts one span and applies its aggregate deltas, unless sourceKey has
// already been seen (idempotent retry / replayed migration batch), in which
// case it is a no-op. Returns true when a new span was inserted.
export async function insertSpanAndAggregate(
    ctx: MutationCtx,
    span: NormalizedSpanInsert,
): Promise<boolean> {
    const existing = await ctx.db
        .query("spans")
        .withIndex("by_sourceKey", (q) => q.eq("sourceKey", span.sourceKey))
        .unique();
    if (existing !== null) {
        return false;
    }

    await ctx.db.insert("spans", span);

    const deltas = deriveSpanDeltas({
        startedAt: span.startedAt,
        durationMs: span.durationMs,
        category: span.category,
        isIdle: span.isIdle,
        actor: span.actor,
        programName: span.programName,
        keysPressedCount: span.keysPressedCount,
        mouseMovementInMM: span.mouseMovementInMM,
        leftClickCount: span.leftClickCount,
        rightClickCount: span.rightClickCount,
        middleClickCount: span.middleClickCount,
    });

    const now = Date.now();

    const existingDay = await ctx.db
        .query("dayAgg")
        .withIndex("by_dayKey", (q) => q.eq("dayKey", deltas.day.dayKey))
        .unique();
    if (existingDay === null) {
        await ctx.db.insert("dayAgg", { ...deltas.day, updatedAt: now });
    } else {
        await ctx.db.patch(existingDay._id, {
            totalDurationMs: existingDay.totalDurationMs + deltas.day.totalDurationMs,
            humanDurationMs: existingDay.humanDurationMs + deltas.day.humanDurationMs,
            agentDurationMs: existingDay.agentDurationMs + deltas.day.agentDurationMs,
            keysPressedCount: existingDay.keysPressedCount + deltas.day.keysPressedCount,
            leftClickCount: existingDay.leftClickCount + deltas.day.leftClickCount,
            rightClickCount: existingDay.rightClickCount + deltas.day.rightClickCount,
            middleClickCount: existingDay.middleClickCount + deltas.day.middleClickCount,
            mouseMovementInMM: existingDay.mouseMovementInMM + deltas.day.mouseMovementInMM,
            spanCount: existingDay.spanCount + deltas.day.spanCount,
            updatedAt: now,
        });
    }

    const existingHour = await ctx.db
        .query("hourAgg")
        .withIndex("by_dayKey_hour", (q) =>
            q.eq("dayKey", deltas.hour.dayKey).eq("hour", deltas.hour.hour),
        )
        .unique();
    if (existingHour === null) {
        await ctx.db.insert("hourAgg", { ...deltas.hour, updatedAt: now });
    } else {
        await ctx.db.patch(existingHour._id, {
            totalDurationMs: existingHour.totalDurationMs + deltas.hour.totalDurationMs,
            humanDurationMs: existingHour.humanDurationMs + deltas.hour.humanDurationMs,
            agentDurationMs: existingHour.agentDurationMs + deltas.hour.agentDurationMs,
            keysPressedCount: existingHour.keysPressedCount + deltas.hour.keysPressedCount,
            spanCount: existingHour.spanCount + deltas.hour.spanCount,
            updatedAt: now,
        });
    }

    const existingProgram = await ctx.db
        .query("programAgg")
        .withIndex("by_dayKey_program", (q) =>
            q.eq("dayKey", deltas.program.dayKey).eq("program", deltas.program.program),
        )
        .unique();
    if (existingProgram === null) {
        await ctx.db.insert("programAgg", { ...deltas.program, updatedAt: now });
    } else {
        await ctx.db.patch(existingProgram._id, {
            durationMs: existingProgram.durationMs + deltas.program.durationMs,
            keysPressedCount: existingProgram.keysPressedCount + deltas.program.keysPressedCount,
            spanCount: existingProgram.spanCount + deltas.program.spanCount,
            updatedAt: now,
        });
    }

    const existingCategory = await ctx.db
        .query("categoryAgg")
        .withIndex("by_dayKey_category", (q) =>
            q.eq("dayKey", deltas.category.dayKey).eq("category", deltas.category.category),
        )
        .unique();
    if (existingCategory === null) {
        await ctx.db.insert("categoryAgg", { ...deltas.category, updatedAt: now });
    } else {
        await ctx.db.patch(existingCategory._id, {
            durationMs: existingCategory.durationMs + deltas.category.durationMs,
            humanDurationMs: existingCategory.humanDurationMs + deltas.category.humanDurationMs,
            agentDurationMs: existingCategory.agentDurationMs + deltas.category.agentDurationMs,
            spanCount: existingCategory.spanCount + deltas.category.spanCount,
            updatedAt: now,
        });
    }

    return true;
}
