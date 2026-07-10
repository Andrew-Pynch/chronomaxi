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
            const wasInserted = await insertSpanAndAggregate(ctx, {
                sourceKey: item.sourceId,
                rawDeviceName: item.deviceName,
                deviceName,
                actor: item.actor,
                agentName: agentNameFromActor(item.actor),
                startedAt: item.createdAt,
                endedAt: item.createdAt + item.durationMs,
                durationMs: item.durationMs,
                category: item.category,
                isIdle: item.isIdle,
                windowId: item.windowId,
                programProcessName: item.programProcessName,
                programName: item.programName,
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
