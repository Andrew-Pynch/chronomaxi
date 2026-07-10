import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

// Known device identities as of the Convex cutover. Editable in place
// (upsertAlias) without a redeploy -- this table, not this constant, is the
// source of truth read by resolveCanonicalDevice at ingest/import time.
const SEED_ALIASES = [
    {
        alias: "andrew-MS-7B86",
        canonicalDevice: "big-bertha",
        note: "pre-rename laptop, same physical lineage",
    },
    { alias: "big-bertha", canonicalDevice: "big-bertha" },
    { alias: "big-ron", canonicalDevice: "big-ron" },
    {
        alias: "D2",
        canonicalDevice: "demo",
        note: "seed.ts synthetic demo data, deliberately not folded into a real device so usage stats are never inflated by synthetic rows",
    },
];

export const seed = internalMutation({
    args: {},
    returns: v.object({ inserted: v.number(), skipped: v.number() }),
    handler: async (ctx) => {
        let inserted = 0;
        let skipped = 0;
        for (const row of SEED_ALIASES) {
            const existing = await ctx.db
                .query("deviceAliases")
                .withIndex("by_alias", (q) => q.eq("alias", row.alias))
                .unique();
            if (existing) {
                skipped += 1;
                continue;
            }
            await ctx.db.insert("deviceAliases", row);
            inserted += 1;
        }
        return { inserted, skipped };
    },
});

export const upsertAlias = internalMutation({
    args: {
        alias: v.string(),
        canonicalDevice: v.string(),
        note: v.optional(v.string()),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("deviceAliases")
            .withIndex("by_alias", (q) => q.eq("alias", args.alias))
            .unique();
        if (existing) {
            await ctx.db.patch(existing._id, {
                canonicalDevice: args.canonicalDevice,
                note: args.note,
            });
        } else {
            await ctx.db.insert("deviceAliases", args);
        }
        return null;
    },
});

export const list = internalQuery({
    args: {},
    returns: v.array(
        v.object({
            alias: v.string(),
            canonicalDevice: v.string(),
            note: v.optional(v.string()),
        }),
    ),
    handler: async (ctx) => {
        const rows = await ctx.db.query("deviceAliases").collect();
        return rows.map((row) => ({
            alias: row.alias,
            canonicalDevice: row.canonicalDevice,
            note: row.note,
        }));
    },
});
