import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { resolveCanonicalDevice } from "./lib/deviceAlias";
import { localTimeParts } from "./lib/aggregation";

export const ingestDictationEvent = internalMutation({
    args: {
        host: v.string(),
        ts: v.number(),
        words: v.number(),
        source: v.string(),
    },
    returns: v.object({ inserted: v.boolean(), dayKey: v.string(), deviceName: v.string() }),
    handler: async (ctx, args) => {
        const deviceName = await resolveCanonicalDevice(ctx, args.host);
        const words = Math.max(0, Math.floor(args.words));
        const ts = args.ts;
        const { dayKey } = localTimeParts(ts);
        const sourceKey = `${args.source}:${args.host}:${ts}:${words}`;

        const existingEvent = await ctx.db
            .query("dictationEvents")
            .withIndex("by_sourceKey", (q) => q.eq("sourceKey", sourceKey))
            .unique();
        if (existingEvent !== null) {
            return { inserted: false, dayKey, deviceName };
        }

        await ctx.db.insert("dictationEvents", {
            sourceKey,
            host: args.host,
            deviceName,
            ts,
            words,
            source: args.source,
            createdAt: Date.now(),
        });

        const now = Date.now();
        const existingDay = await ctx.db
            .query("dictationDayAgg")
            .withIndex("by_day_device", (q) => q.eq("dayKey", dayKey).eq("deviceName", deviceName))
            .unique();
        if (existingDay === null) {
            await ctx.db.insert("dictationDayAgg", {
                dayKey,
                deviceName,
                dictatedWords: words,
                eventCount: 1,
                updatedAt: now,
            });
        } else {
            await ctx.db.patch(existingDay._id, {
                dictatedWords: existingDay.dictatedWords + words,
                eventCount: existingDay.eventCount + 1,
                updatedAt: now,
            });
        }

        return { inserted: true, dayKey, deviceName };
    },
});
