import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { resolveCanonicalDevice } from "./lib/deviceAlias";
import { insertSpanAndAggregate } from "./lib/spanIngest";

// Wire shape of one batch item exactly as sent by the tracker's HTTP ingest
// client (convex/http.ts POST /ingest). Only called from that HTTP action --
// never exposed to a public Convex client.
const ingestSpanValidator = v.object({
    sourceId: v.string(),
    createdAt: v.number(),
    durationMs: v.number(),
    category: v.string(),
    isIdle: v.boolean(),
    deviceName: v.string(),
    actor: v.string(),
    windowId: v.string(),
    programProcessName: v.string(),
    programName: v.string(),
    // Terminal-pane sub-identity (e.g. "nvim", "cargo"); absent from
    // trackers that predate this field, and unset for non-terminal windows.
    subProgram: v.optional(v.string()),
    tmuxSession: v.optional(v.string()),
    bucket: v.optional(v.string()),
    browserTitle: v.optional(v.string()),
    keysPressedCount: v.optional(v.number()),
    mouseMovementInMM: v.optional(v.number()),
    leftClickCount: v.optional(v.number()),
    rightClickCount: v.optional(v.number()),
    middleClickCount: v.optional(v.number()),
    tokensSpent: v.optional(v.number()),
});

function agentNameFromActor(actor: string): string | undefined {
    return actor.startsWith("agent:") ? actor.slice("agent:".length) : undefined;
}

export const ingestSpanBatch = internalMutation({
    args: { batch: v.array(ingestSpanValidator) },
    returns: v.object({ inserted: v.number(), skipped: v.number() }),
    handler: async (ctx, args) => {
        let inserted = 0;
        let skipped = 0;

        for (const item of args.batch) {
            const deviceName = await resolveCanonicalDevice(ctx, item.deviceName);

            // While an actorOverrides row is active for this (canonical)
            // device, every span it produces is attributed to the
            // override's actor instead of whatever the tracker itself
            // reported -- e.g. an unattended agent session running on a
            // device that would otherwise be misclassified as human
            // activity. This rewrite happens BEFORE insertSpanAndAggregate
            // derives deltas, so the persisted span row and every
            // aggregate bucket agree on the override.
            const override = await ctx.db
                .query("actorOverrides")
                .withIndex("by_deviceName", (q) => q.eq("deviceName", deviceName))
                .unique();
            const actor = override?.active ? override.actor : item.actor;

            const wasInserted = await insertSpanAndAggregate(ctx, {
                sourceKey: item.sourceId,
                rawDeviceName: item.deviceName,
                deviceName,
                actor,
                agentName: agentNameFromActor(actor),
                startedAt: item.createdAt,
                endedAt: item.createdAt + item.durationMs,
                durationMs: item.durationMs,
                category: item.category,
                isIdle: item.isIdle,
                windowId: item.windowId,
                programProcessName: item.programProcessName,
                programName: item.programName,
                subProgram: item.subProgram,
                tmuxSession: item.tmuxSession,
                bucket: item.bucket,
                browserTitle: item.browserTitle,
                keysPressedCount: item.keysPressedCount ?? 0,
                mouseMovementInMM: item.mouseMovementInMM ?? 0,
                leftClickCount: item.leftClickCount ?? 0,
                rightClickCount: item.rightClickCount ?? 0,
                middleClickCount: item.middleClickCount ?? 0,
                tokensSpent: item.tokensSpent,
                importBatch: "live",
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
