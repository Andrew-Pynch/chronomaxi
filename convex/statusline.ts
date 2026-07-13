import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { httpAction, query } from "./_generated/server";
import { localTimeParts } from "./lib/aggregation";

const MS_PER_MINUTE = 60_000;
const TYPED_WORD_SIZE = 5;

const statuslineValidator = v.object({
    activeMinutes: v.number(),
    keystrokes: v.number(),
    clicks: v.number(),
    typedWpm: v.number(),
    dictatedWords: v.number(),
});

type StatuslineStats = {
    activeMinutes: number;
    keystrokes: number;
    clicks: number;
    typedWpm: number;
    dictatedWords: number;
};

const statuslineQuery = makeFunctionReference<"query", { host?: string }, StatuslineStats>(
    "statusline:get",
);

export const get = query({
    args: { host: v.optional(v.string()) },
    returns: statuslineValidator,
    handler: async (ctx, args) => {
        const todayKey = localTimeParts(Date.now()).dayKey;
        const requestedHost = args.host?.trim();
        const selectedHost = requestedHost === undefined || requestedHost.length === 0 || requestedHost === "all"
            ? undefined
            : requestedHost;

        const rows = await ctx.db
            .query("dayAgg")
            .withIndex("by_dayKey_device", (q) => q.eq("dayKey", todayKey))
            .collect();
        const selectedRows = selectedHost === undefined
            ? rows
            : rows.filter((row) => row.deviceName === selectedHost);

        let activeMs = 0;
        let keystrokes = 0;
        let clicks = 0;
        for (const row of selectedRows) {
            activeMs += row.totalDurationMs;
            keystrokes += row.keysPressedCount;
            clicks += row.leftClickCount + row.rightClickCount + row.middleClickCount;
        }

        const dictationRows = await ctx.db
            .query("dictationDayAgg")
            .withIndex("by_day_device", (q) => q.eq("dayKey", todayKey))
            .collect();
        const selectedDictationRows = selectedHost === undefined
            ? dictationRows
            : dictationRows.filter((row) => row.deviceName === selectedHost);
        const dictatedWords = selectedDictationRows.reduce(
            (sum, row) => sum + row.dictatedWords,
            0,
        );

        const activeMinutes = Math.floor(activeMs / MS_PER_MINUTE);
        const typedWpm = activeMinutes > 0
            ? Math.round((keystrokes / TYPED_WORD_SIZE) / (activeMinutes / 60))
            : 0;

        return {
            activeMinutes,
            keystrokes,
            clicks,
            typedWpm,
            dictatedWords,
        };
    },
});

export const statuslineHttpHandler = httpAction(async (ctx, request) => {
    const expected = process.env.CHRONOMAXI_INGEST_SECRET;
    if (!expected) {
        return new Response("CHRONOMAXI_INGEST_SECRET not configured", { status: 500 });
    }
    const header = request.headers.get("Authorization") ?? "";
    const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (provided !== expected) {
        return new Response("Unauthorized", { status: 401 });
    }

    const url = new URL(request.url);
    const host = url.searchParams.get("host") ?? undefined;
    const result = await ctx.runQuery(statuslineQuery, { host });

    return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "content-type": "application/json" },
    });
});
