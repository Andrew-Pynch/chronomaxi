import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

// Only called from convex/http.ts POST /session-event -- never exposed to a
// public Convex client. One POST carries exactly one lifecycle event
// (ssh-start or ssh-end); ssh-end is correlated to its ssh-start row by
// sessionId (shared across both events), not by sourceId (unique per event,
// used only for idempotent replay detection of THAT specific event).
export const ingestSessionEvent = internalMutation({
    args: {
        sourceId: v.string(),
        kind: v.union(v.literal("ssh-start"), v.literal("ssh-end")),
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
        sessionId: v.string(),
        model: v.optional(v.string()),
        provider: v.optional(v.string()),
        inputTokens: v.optional(v.number()),
        outputTokens: v.optional(v.number()),
        estimatedCostUsd: v.optional(v.number()),
    },
    returns: v.object({ applied: v.boolean() }),
    handler: async (ctx, args) => {
        if (args.kind === "ssh-start") {
            const existing = await ctx.db
                .query("sshSessions")
                .withIndex("by_sourceId", (q) => q.eq("sourceId", args.sourceId))
                .unique();
            if (existing !== null) {
                return { applied: false }; // idempotent retry of the same start event
            }
            await ctx.db.insert("sshSessions", {
                sourceId: args.sourceId,
                sessionId: args.sessionId,
                actor: args.actor,
                agentName: args.agentName,
                originHost: args.originHost,
                targetHost: args.targetHost,
                targetHostAlias: args.targetHostAlias,
                remoteUser: args.remoteUser,
                startedAt: args.startedAt,
                model: args.model,
                provider: args.provider,
                inputTokens: args.inputTokens,
                outputTokens: args.outputTokens,
                estimatedCostUsd: args.estimatedCostUsd,
                lastEventSourceId: args.sourceId,
            });
            return { applied: true };
        }

        // ssh-end
        const existing = await ctx.db
            .query("sshSessions")
            .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
            .unique();

        if (existing === null) {
            // Out-of-order delivery (end arrived before start, or the start
            // POST was lost entirely) -- create a synthetic row rather than
            // silently dropping the end event; still keyed by this event's
            // own sourceId so a retried end POST is still idempotent below.
            await ctx.db.insert("sshSessions", {
                sourceId: args.sourceId,
                sessionId: args.sessionId,
                actor: args.actor,
                agentName: args.agentName,
                originHost: args.originHost,
                targetHost: args.targetHost,
                targetHostAlias: args.targetHostAlias,
                remoteUser: args.remoteUser,
                startedAt: args.startedAt,
                endedAt: args.endedAt,
                durationMs: args.durationMs,
                exitCode: args.exitCode,
                model: args.model,
                provider: args.provider,
                inputTokens: args.inputTokens,
                outputTokens: args.outputTokens,
                estimatedCostUsd: args.estimatedCostUsd,
                lastEventSourceId: args.sourceId,
            });
            return { applied: true };
        }

        if (existing.lastEventSourceId === args.sourceId) {
            return { applied: false }; // idempotent retry of the same end event
        }

        await ctx.db.patch(existing._id, {
            endedAt: args.endedAt,
            durationMs: args.durationMs,
            exitCode: args.exitCode,
            model: args.model ?? existing.model,
            provider: args.provider ?? existing.provider,
            inputTokens: args.inputTokens ?? existing.inputTokens,
            outputTokens: args.outputTokens ?? existing.outputTokens,
            estimatedCostUsd: args.estimatedCostUsd ?? existing.estimatedCostUsd,
            lastEventSourceId: args.sourceId,
        });
        return { applied: true };
    },
});
