import type { QueryCtx, MutationCtx } from "../_generated/server";

// Resolves a raw device name (exactly as sent on the wire, e.g.
// "andrew-MS-7B86") to its canonical device name (e.g. "big-bertha") via the
// deviceAliases table. Falls back to the raw name unchanged when no alias
// row exists -- an unrecognized device is its own canonical identity, not an
// error, so a brand-new host can start reporting before anyone registers it.
export async function resolveCanonicalDevice(
    ctx: QueryCtx | MutationCtx,
    rawDeviceName: string,
): Promise<string> {
    const alias = await ctx.db
        .query("deviceAliases")
        .withIndex("by_alias", (q) => q.eq("alias", rawDeviceName))
        .unique();
    return alias?.canonicalDevice ?? rawDeviceName;
}
