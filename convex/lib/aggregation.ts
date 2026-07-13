// Pure aggregation module: given a normalized span, compute the additive
// deltas to apply to each materialized rollup table (dayAgg/hourAgg/
// programAgg/categoryAgg). This is the SINGLE source of truth for
// span-to-aggregate math -- both the live HTTP ingest mutation
// (convex/spans.ts) and the historical migration import mutation
// (convex/migration.ts) call deriveSpanDeltas and apply the result the same
// way (upsert-by-key, add-to-existing-or-insert-zero-plus-delta).
//
// No ctx/db access here on purpose: this module is testable in isolation and
// has zero Convex-runtime dependencies beyond Intl/Date, which is why it also
// owns the America/Chicago timezone conversion (see localTimeParts below).

export const TIMEZONE = "America/Chicago";

export interface SpanForAggregation {
    startedAt: number; // unix ms
    durationMs: number;
    category: string;
    isIdle: boolean;
    actor: string; // "human" | "agent:<name>"
    // Canonical resolved device identity (post deviceAliases resolution,
    // post actorOverride rewrite upstream) -- always concrete, never
    // "unset", at the point a span is ingested or replayed. Every rollup
    // bucket's identity now includes this field.
    deviceName: string;
    programName: string;
    // Terminal-pane sub-identity (e.g. "nvim", "cargo"), set only for
    // terminal-class windows the tracker resolved a pane command for. When
    // set, deriveSpanDeltas additionally emits a programDetail delta.
    subProgram?: string;
    keysPressedCount: number;
    mouseMovementInMM: number;
    leftClickCount: number;
    rightClickCount: number;
    middleClickCount: number;
}

export interface DayAggDelta {
    dayKey: string;
    deviceName: string;
    totalDurationMs: number;
    humanDurationMs: number;
    agentDurationMs: number;
    keysPressedCount: number;
    leftClickCount: number;
    rightClickCount: number;
    middleClickCount: number;
    mouseMovementInMM: number;
    spanCount: number;
}

export interface HourAggDelta {
    dayKey: string;
    hour: number;
    deviceName: string;
    totalDurationMs: number;
    humanDurationMs: number;
    agentDurationMs: number;
    keysPressedCount: number;
    spanCount: number;
}

export interface ProgramAggDelta {
    dayKey: string;
    deviceName: string;
    program: string;
    durationMs: number;
    keysPressedCount: number;
    spanCount: number;
}

export interface CategoryAggDelta {
    dayKey: string;
    deviceName: string;
    category: string;
    durationMs: number;
    humanDurationMs: number;
    agentDurationMs: number;
    spanCount: number;
}

// Only emitted (see SpanAggregateDeltas.programDetail) when the source span
// carries a subProgram. durationMs/keysPressedCount/spanCount follow the
// exact same idle-contributes-zero semantics as every other bucket below.
export interface ProgramDetailAggDelta {
    dayKey: string;
    deviceName: string;
    program: string;
    subProgram: string;
    durationMs: number;
    keysPressedCount: number;
    spanCount: number;
}

export interface SpanAggregateDeltas {
    day: DayAggDelta;
    hour: HourAggDelta;
    program: ProgramAggDelta;
    category: CategoryAggDelta;
    programDetail?: ProgramDetailAggDelta;
}

export function typedWordsEstimate(keysPressedCount: number): number {
    return Math.floor(Math.max(0, keysPressedCount) / 5);
}

export function typedWpm(keysPressedCount: number, activeMinutes: number): number | null {
    if (keysPressedCount <= 0 || activeMinutes <= 0) return null;
    return typedWordsEstimate(keysPressedCount) / activeMinutes;
}

// --- America/Chicago local-time conversion ------------------------------
//
// Convex's default runtime resembles a V8-isolate/Cloudflare-Workers-style
// sandbox; ICU/Intl timezone-database support is not guaranteed by any
// documented API allowlist. We probe once at module load (cheap, one
// Intl.DateTimeFormat construction + format call) and permanently fall back
// to a hand-computed fixed-offset CST/CDT conversion if Intl with an IANA
// `timeZone` option throws or misbehaves. This was verified live against the
// local self-hosted stack during implementation (see deploy notes / IRC
// history) -- Intl.DateTimeFormat({timeZone:'America/Chicago'}) DOES work
// inside a Convex query/mutation, so the fallback below is a documented
// safety net, not the active path, but is kept and exercised by tests so the
// module degrades gracefully if a future Convex runtime change removes
// timezone-DB support.

function probeIntlTimezoneSupport(): boolean {
    try {
        const fmt = new Intl.DateTimeFormat("en-US", {
            timeZone: TIMEZONE,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            hourCycle: "h23",
        });
        const parts = fmt.formatToParts(new Date(0));
        return (
            parts.some((p) => p.type === "year") &&
            parts.some((p) => p.type === "hour")
        );
    } catch {
        return false;
    }
}

const INTL_TIMEZONE_SUPPORTED = probeIntlTimezoneSupport();

const intlFormatter = INTL_TIMEZONE_SUPPORTED
    ? new Intl.DateTimeFormat("en-US", {
          timeZone: TIMEZONE,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          hourCycle: "h23",
      })
    : null;

interface LocalTimeParts {
    dayKey: string;
    hour: number;
}

function localTimePartsIntl(ms: number): LocalTimeParts {
    const parts = intlFormatter!.formatToParts(new Date(ms));
    const map: Record<string, string> = {};
    for (const part of parts) {
        map[part.type] = part.value;
    }
    // hourCycle h23 should never emit "24", but normalize defensively --
    // some ICU builds emit "24" for midnight under h24 fallback behavior.
    let hour = parseInt(map.hour ?? "0", 10);
    if (hour === 24) hour = 0;
    return { dayKey: `${map.year}-${map.month}-${map.day}`, hour };
}

// US Central Time DST rule (Energy Policy Act of 2005, effective 2007-):
// DST starts the 2nd Sunday of March at 02:00 CST (08:00 UTC) and ends the
// 1st Sunday of November at 02:00 CDT (07:00 UTC). Valid for all years this
// system will realistically ever process (2007 onward); documented here as
// the "fixed-offset DST table" fallback required when Intl timezone support
// is unavailable.
function nthSundayOfMonthUTC(
    year: number,
    monthIndex0: number,
    n: number,
): number {
    const first = new Date(Date.UTC(year, monthIndex0, 1));
    const firstDow = first.getUTCDay(); // 0 = Sunday
    const firstSunday = firstDow === 0 ? 1 : 8 - firstDow;
    return firstSunday + (n - 1) * 7;
}

function isCentralDaylightTime(utcMs: number): boolean {
    const year = new Date(utcMs).getUTCFullYear();
    const marchSecondSunday = nthSundayOfMonthUTC(year, 2, 2); // March, 0-indexed month 2
    const dstStartUtcMs = Date.UTC(year, 2, marchSecondSunday, 8, 0, 0);
    const novemberFirstSunday = nthSundayOfMonthUTC(year, 10, 1); // November, 0-indexed month 10
    const dstEndUtcMs = Date.UTC(year, 10, novemberFirstSunday, 7, 0, 0);
    return utcMs >= dstStartUtcMs && utcMs < dstEndUtcMs;
}

function localTimePartsFallback(ms: number): LocalTimeParts {
    const offsetHours = isCentralDaylightTime(ms) ? -5 : -6;
    const local = new Date(ms + offsetHours * 3_600_000);
    const dayKey = `${local.getUTCFullYear()}-${String(
        local.getUTCMonth() + 1,
    ).padStart(2, "0")}-${String(local.getUTCDate()).padStart(2, "0")}`;
    return { dayKey, hour: local.getUTCHours() };
}

export function localTimeParts(ms: number): LocalTimeParts {
    return INTL_TIMEZONE_SUPPORTED
        ? localTimePartsIntl(ms)
        : localTimePartsFallback(ms);
}

// --- deltas ---------------------------------------------------------------
//
// Idle spans are recorded in `spans` (full audit trail) but contribute ZERO
// to every rollup bucket, matching the pre-existing dashboard semantics in
// frontend/src/server/api/routers/helpers/logHelpers.ts (`if (log.isIdle)
// continue`) -- DailySummary.totalHours et al. have always meant "active
// time only". A span's entire duration is bucketed into the day/hour where
// it STARTED (no sub-span splitting across a midnight/hour boundary); spans
// are capped at tens of seconds by the tracker's own checkpoint logic, so
// the resulting misattribution at a boundary is at most a few seconds.

export function deriveSpanDeltas(
    span: SpanForAggregation,
): SpanAggregateDeltas {
    const { dayKey, hour } = localTimeParts(span.startedAt);
    const isAgent = span.actor.startsWith("agent:");
    const active = !span.isIdle;

    const durationMs = active ? span.durationMs : 0;
    const humanDurationMs = active && !isAgent ? span.durationMs : 0;
    const agentDurationMs = active && isAgent ? span.durationMs : 0;
    const keysPressedCount = active ? span.keysPressedCount : 0;
    const spanCount = active ? 1 : 0;

    const programDetail: ProgramDetailAggDelta | undefined = span.subProgram
        ? {
              dayKey,
              deviceName: span.deviceName,
              program: span.programName,
              subProgram: span.subProgram,
              durationMs,
              keysPressedCount,
              spanCount,
          }
        : undefined;

    return {
        day: {
            dayKey,
            deviceName: span.deviceName,
            totalDurationMs: durationMs,
            humanDurationMs,
            agentDurationMs,
            keysPressedCount,
            leftClickCount: active ? span.leftClickCount : 0,
            rightClickCount: active ? span.rightClickCount : 0,
            middleClickCount: active ? span.middleClickCount : 0,
            mouseMovementInMM: active ? span.mouseMovementInMM : 0,
            spanCount,
        },
        hour: {
            dayKey,
            hour,
            deviceName: span.deviceName,
            totalDurationMs: durationMs,
            humanDurationMs,
            agentDurationMs,
            keysPressedCount,
            spanCount,
        },
        program: {
            dayKey,
            deviceName: span.deviceName,
            program: span.programName,
            durationMs,
            keysPressedCount,
            spanCount,
        },
        category: {
            dayKey,
            deviceName: span.deviceName,
            category: span.category,
            durationMs,
            humanDurationMs,
            agentDurationMs,
            spanCount,
        },
        programDetail,
    };
}
