import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// chronomaxi Convex schema.
//
// `spans` is the append-only system of record for tracked activity (one row
// per contiguous same-window/program run, emitted directly by the Rust
// tracker's checkpoint logic or produced by the historical compaction
// importer). dayAgg/hourAgg/programAgg/categoryAgg/programDetailAgg are
// small materialized rollups computed incrementally from spans via
// convex/lib/aggregation.ts -- they are the ONLY tables the dashboard query
// reads, so it never scans the (potentially tens-of-thousands-of-rows)
// spans table.
export default defineSchema({
    spans: defineTable({
        // Dedupe/idempotency key: the client-generated sourceId from the
        // ingest wire payload (tracker spool) or the migration importer's
        // deterministic per-run id. Never regenerated on retry.
        sourceKey: v.string(),
        // Device name exactly as received on the wire, kept for audit trail.
        rawDeviceName: v.string(),
        // Canonical device name after deviceAliases resolution. All queries
        // and indexes group on this field, never rawDeviceName.
        deviceName: v.string(),
        // "human" | "agent:<name>" -- may already be REWRITTEN by an active
        // actorOverrides row for this device at ingest time (see
        // convex/spans.ts); the tracker's own report is not necessarily
        // what ends up here.
        actor: v.string(),
        // Parsed out of actor for query convenience; unset when actor === "human".
        agentName: v.optional(v.string()),
        startedAt: v.number(),
        endedAt: v.number(),
        durationMs: v.number(),
        category: v.string(),
        isIdle: v.boolean(),
        windowId: v.string(),
        programProcessName: v.string(),
        programName: v.string(),
        // Terminal-pane sub-identity (e.g. "nvim", "cargo", "zsh") the
        // tracker resolved via tmux for terminal-class windows only. Unset
        // for every other program, and for spans from trackers that
        // predate this field.
        subProgram: v.optional(v.string()),
        browserTitle: v.optional(v.string()),
        // Normalized to 0 at ingest/import time -- never left undefined --
        // so aggregation.ts can sum unconditionally.
        keysPressedCount: v.number(),
        mouseMovementInMM: v.number(),
        leftClickCount: v.number(),
        rightClickCount: v.number(),
        middleClickCount: v.number(),
        tokensSpent: v.optional(v.number()),
        // "live" for HTTP-ingested spans, or a migration batch tag
        // (e.g. "backfill-big-bertha-2026-07-10T18:00Z") for rollback/audit.
        importBatch: v.string(),
    })
        .index("by_deviceName_startedAt", ["deviceName", "startedAt"])
        .index("by_sourceKey", ["sourceKey"])
        .index("by_actor_startedAt", ["actor", "startedAt"]),

    dayAgg: defineTable({
        // Local (America/Chicago) calendar date, "YYYY-MM-DD".
        dayKey: v.string(),
        // Canonical device identity for this bucket. Required since the
        // 2026-07-10 backfill rebuilt every bucket row with its device
        // attribution (see scripts/rebuild-aggregates.ts).
        deviceName: v.string(),
        totalDurationMs: v.number(),
        humanDurationMs: v.number(),
        agentDurationMs: v.number(),
        keysPressedCount: v.number(),
        leftClickCount: v.number(),
        rightClickCount: v.number(),
        middleClickCount: v.number(),
        mouseMovementInMM: v.number(),
        spanCount: v.number(),
        updatedAt: v.number(),
    }).index("by_dayKey_device", ["dayKey", "deviceName"]),

    hourAgg: defineTable({
        dayKey: v.string(),
        // 0-23, local (America/Chicago) hour.
        hour: v.number(),
        deviceName: v.string(),
        totalDurationMs: v.number(),
        humanDurationMs: v.number(),
        agentDurationMs: v.number(),
        keysPressedCount: v.number(),
        spanCount: v.number(),
        updatedAt: v.number(),
    }).index("by_day_hour_device", ["dayKey", "hour", "deviceName"]),

    programAgg: defineTable({
        dayKey: v.string(),
        deviceName: v.string(),
        // programName (display identity), matching the existing dashboard's
        // ProgramStat.program convention (frontend/src/lib/activity-types.ts).
        program: v.string(),
        durationMs: v.number(),
        keysPressedCount: v.number(),
        spanCount: v.number(),
        updatedAt: v.number(),
    }).index("by_day_device_program", ["dayKey", "deviceName", "program"]),

    categoryAgg: defineTable({
        dayKey: v.string(),
        deviceName: v.string(),
        category: v.string(),
        durationMs: v.number(),
        humanDurationMs: v.number(),
        agentDurationMs: v.number(),
        spanCount: v.number(),
        updatedAt: v.number(),
    }).index("by_day_device_category", ["dayKey", "deviceName", "category"]),

    // Sub-program breakdown within a program, e.g. programName="alacritty",
    // subProgram="nvim" -- only ever written when the source span carries a
    // subProgram (convex/lib/aggregation.ts deriveSpanDeltas), so this table
    // stays small (terminal-pane activity only) rather than mirroring every
    // programAgg row.
    programDetailAgg: defineTable({
        dayKey: v.string(),
        deviceName: v.string(),
        program: v.string(),
        subProgram: v.string(),
        durationMs: v.number(),
        keysPressedCount: v.number(),
        spanCount: v.number(),
        updatedAt: v.number(),
    }).index("by_day_device_program_sub", [
        "dayKey",
        "deviceName",
        "program",
        "subProgram",
    ]),

    // Singleton countdown-timer row (a pomodoro-style widget backing store).
    // Running iff runningSince is set; pausedRemainingMs is a frozen
    // snapshot of what remained at the moment of the last pause, kept only
    // for display while paused (see convex/timer.ts for the exact
    // start/pause/reset semantics). Never more than one row exists.
    timerState: defineTable({
        durationMs: v.number(),
        runningSince: v.optional(v.number()),
        pausedRemainingMs: v.optional(v.number()),
        updatedAt: v.number(),
    }),

    // At most one row per deviceName. While active=true, span ingest for
    // that device rewrites the incoming actor/agentName to `actor` before
    // the span is stored and before aggregate deltas are derived (see
    // convex/spans.ts) -- e.g. to attribute an unattended-agent session's
    // activity correctly instead of it being recorded as human.
    actorOverrides: defineTable({
        deviceName: v.string(),
        actor: v.string(),
        active: v.boolean(),
        updatedAt: v.number(),
    }).index("by_deviceName", ["deviceName"]),

    sshSessions: defineTable({
        // Idempotency key of the ssh-start event that created this row.
        sourceId: v.string(),
        // Correlates the ssh-start and ssh-end events for one connection.
        sessionId: v.string(),
        actor: v.string(),
        agentName: v.optional(v.string()),
        originHost: v.string(),
        targetHost: v.string(),
        targetHostAlias: v.optional(v.string()),
        remoteUser: v.optional(v.string()),
        startedAt: v.number(),
        endedAt: v.optional(v.number()),
        durationMs: v.optional(v.number()),
        exitCode: v.optional(v.number()),
        // Reserved for a later per-turn LLM usage ingestion path; never
        // populated by the ssh-start/ssh-end lifecycle hook itself.
        model: v.optional(v.string()),
        provider: v.optional(v.string()),
        inputTokens: v.optional(v.number()),
        outputTokens: v.optional(v.number()),
        estimatedCostUsd: v.optional(v.number()),
        // sourceId of the most recently applied event, for idempotent
        // ssh-end replay detection (looked up via sessionId, not sourceId).
        lastEventSourceId: v.string(),
    })
        .index("by_sourceId", ["sourceId"])
        .index("by_sessionId", ["sessionId"])
        .index("by_targetHost_startedAt", ["targetHost", "startedAt"])
        .index("by_startedAt", ["startedAt"]),

    deviceAliases: defineTable({
        // Raw device name as recorded at capture time, e.g. "andrew-MS-7B86".
        alias: v.string(),
        // Canonical resolved device name, e.g. "big-bertha".
        canonicalDevice: v.string(),
        note: v.optional(v.string()),
    }).index("by_alias", ["alias"]),

    migrationCheckpoints: defineTable({
        // Source archive identifier, e.g. "big-bertha", "big-ron".
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
    }).index("by_source", ["source"]),

    // Resume state for scripts/rebuild-aggregates.ts (convex/rebuild.ts).
    // One row per rebuild run, keyed by runId so a fresh --yes invocation
    // never collides with a still-resumable prior run's cursor.
    rebuildCheckpoints: defineTable({
        runId: v.string(),
        phase: v.union(
            v.literal("wipe"),
            v.literal("replay"),
            v.literal("complete"),
        ),
        // _creationTime cutoff captured once at wipe start: replay only
        // ever processes spans with _creationTime <= watermark, so spans
        // ingested WHILE a rebuild is running are never double-counted.
        watermark: v.number(),
        // Convex pagination cursor for whichever table the wipe phase is
        // currently draining; reset to undefined when advancing to the
        // next table.
        wipeTable: v.optional(
            v.union(
                v.literal("dayAgg"),
                v.literal("hourAgg"),
                v.literal("programAgg"),
                v.literal("categoryAgg"),
                v.literal("programDetailAgg"),
            ),
        ),
        wipeCursor: v.optional(v.string()),
        // Convex pagination cursor into the spans table for the replay phase.
        replayCursor: v.optional(v.string()),
        spansReplayed: v.number(),
        startedAt: v.number(),
        updatedAt: v.number(),
    }).index("by_runId", ["runId"]),
});
