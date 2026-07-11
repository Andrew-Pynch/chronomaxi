import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Applied at span-ingest time only (see convex/spans.ts) -- a device with no
// row here, or an inactive row, behaves exactly as before this feature
// existed.
const DEFAULT_OVERRIDE_ACTOR = "agent:unattended";

const actorOverrideValidator = v.object({
    deviceName: v.string(),
    actor: v.string(),
    active: v.boolean(),
    updatedAt: v.number(),
});

// Returns `deviceName`'s override row (0 or 1 elements) when given, else
// every device that has ever had one set. A device with no row is
// equivalent to `{ active: false }` -- it simply is not in the result.
export const get = query({
    args: { deviceName: v.optional(v.string()) },
    returns: v.array(actorOverrideValidator),
    handler: async (ctx, args) => {
        if (args.deviceName === undefined) {
            const rows = await ctx.db.query("actorOverrides").collect();
            return rows.map((row) => ({
                deviceName: row.deviceName,
                actor: row.actor,
                active: row.active,
                updatedAt: row.updatedAt,
            }));
        }
        const deviceName = args.deviceName;
        const row = await ctx.db
            .query("actorOverrides")
            .withIndex("by_deviceName", (q) => q.eq("deviceName", deviceName))
            .unique();
        return row === null
            ? []
            : [{ deviceName: row.deviceName, actor: row.actor, active: row.active, updatedAt: row.updatedAt }];
    },
});

export const set = mutation({
    args: {
        deviceName: v.string(),
        active: v.boolean(),
        actor: v.optional(v.string()),
    },
    returns: actorOverrideValidator,
    handler: async (ctx, args) => {
        const actor = args.actor ?? DEFAULT_OVERRIDE_ACTOR;
        const updatedAt = Date.now();
        const existing = await ctx.db
            .query("actorOverrides")
            .withIndex("by_deviceName", (q) => q.eq("deviceName", args.deviceName))
            .unique();
        if (existing === null) {
            await ctx.db.insert("actorOverrides", {
                deviceName: args.deviceName,
                actor,
                active: args.active,
                updatedAt,
            });
        } else {
            await ctx.db.patch(existing._id, { actor, active: args.active, updatedAt });
        }
        return { deviceName: args.deviceName, actor, active: args.active, updatedAt };
    },
});
