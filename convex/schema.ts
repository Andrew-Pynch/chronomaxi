import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// chronomaxi Convex schema.
//
// `spans` is the append-only system of record for tracked activity (one row
// per contiguous same-window/program run, emitted directly by the Rust
// tracker's checkpoint logic or produced by the historical compaction
// importer). dayAgg/hourAgg/programAgg/categoryAgg are small materialized
// rollups computed incrementally from spans via convex/lib/aggregation.ts --
// they are the ONLY tables the dashboard query reads, so it never scans the
// (potentially tens-of-thousands-of-rows) spans table.
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
        // "human" | "agent:<name>"
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
    }).index("by_dayKey", ["dayKey"]),

    hourAgg: defineTable({
        dayKey: v.string(),
        // 0-23, local (America/Chicago) hour.
        hour: v.number(),
        totalDurationMs: v.number(),
        humanDurationMs: v.number(),
        agentDurationMs: v.number(),
        keysPressedCount: v.number(),
        spanCount: v.number(),
        updatedAt: v.number(),
    }).index("by_dayKey_hour", ["dayKey", "hour"]),

    programAgg: defineTable({
        dayKey: v.string(),
        // programName (display identity), matching the existing dashboard's
        // ProgramStat.program convention (frontend/src/lib/activity-types.ts).
        program: v.string(),
        durationMs: v.number(),
        keysPressedCount: v.number(),
        spanCount: v.number(),
        updatedAt: v.number(),
    }).index("by_dayKey_program", ["dayKey", "program"]),

    categoryAgg: defineTable({
        dayKey: v.string(),
        category: v.string(),
        durationMs: v.number(),
        humanDurationMs: v.number(),
        agentDurationMs: v.number(),
        spanCount: v.number(),
        updatedAt: v.number(),
    }).index("by_dayKey_category", ["dayKey", "category"]),

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
        .index("by_targetHost_startedAt", ["targetHost", "startedAt"]),

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
});
