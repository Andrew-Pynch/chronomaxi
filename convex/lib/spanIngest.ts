import type { MutationCtx } from "../_generated/server";
import { deriveSpanDeltas, type SpanAggregateDeltas } from "./aggregation";

// The exact shape written into the `spans` table by BOTH entry points (live
// HTTP ingest and historical migration import). Optional wire fields must
// already be normalized to 0/undefined by the caller before this is built --
// this module never guesses a default. actor/agentName here are the FINAL
// values to persist -- any actorOverride rewrite (convex/spans.ts) must have
// already happened before this is built, so the stored span and every
// aggregate delta agree.
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
    subProgram?: string;
    tmuxSession?: string;
    bucket?: string;
    browserTitle?: string;
    keysPressedCount: number;
    mouseMovementInMM: number;
    leftClickCount: number;
    rightClickCount: number;
    middleClickCount: number;
    tokensSpent?: number;
    importBatch: string;
}

// Upsert-by-key application of one span's already-computed deltas into the
// five materialized rollup tables (dayAgg/hourAgg/programAgg/categoryAgg/
// programDetailAgg), keyed by the composite indexes defined in schema.ts.
// This is the ONLY place that touches those tables -- both live ingest
// (insertSpanAndAggregate below) and the rebuild-from-spans replay
// (convex/rebuild.ts) call it with deltas from the exact same
// deriveSpanDeltas function, so a rebuilt deployment and a live one can
// never disagree about the math, only about which spans they've seen.
export async function applyAggregateDeltas(
    ctx: MutationCtx,
    deltas: SpanAggregateDeltas,
): Promise<void> {
    const now = Date.now();

    const existingDay = await ctx.db
        .query("dayAgg")
        .withIndex("by_dayKey_device", (q) =>
            q.eq("dayKey", deltas.day.dayKey).eq("deviceName", deltas.day.deviceName),
        )
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
        .withIndex("by_day_hour_device", (q) =>
            q
                .eq("dayKey", deltas.hour.dayKey)
                .eq("hour", deltas.hour.hour)
                .eq("deviceName", deltas.hour.deviceName),
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
        .withIndex("by_day_device_program", (q) =>
            q
                .eq("dayKey", deltas.program.dayKey)
                .eq("deviceName", deltas.program.deviceName)
                .eq("program", deltas.program.program),
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
        .withIndex("by_day_device_category", (q) =>
            q
                .eq("dayKey", deltas.category.dayKey)
                .eq("deviceName", deltas.category.deviceName)
                .eq("category", deltas.category.category),
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

    if (deltas.programDetail !== undefined) {
        const detail = deltas.programDetail;
        const existingDetail = await ctx.db
            .query("programDetailAgg")
            .withIndex("by_day_device_program_sub", (q) =>
                q
                    .eq("dayKey", detail.dayKey)
                    .eq("deviceName", detail.deviceName)
                    .eq("program", detail.program)
                    .eq("subProgram", detail.subProgram),
            )
            .unique();
        if (existingDetail === null) {
            await ctx.db.insert("programDetailAgg", { ...detail, updatedAt: now });
        } else {
            await ctx.db.patch(existingDetail._id, {
                durationMs: existingDetail.durationMs + detail.durationMs,
                keysPressedCount: existingDetail.keysPressedCount + detail.keysPressedCount,
                spanCount: existingDetail.spanCount + detail.spanCount,
                updatedAt: now,
            });
        }
    }
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

    return true;
}
