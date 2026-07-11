// chronomaxi aggregate rebuild.
//
//   bun run scripts/rebuild-aggregates.ts --yes [--run-id <id>]
//
// Wipes dayAgg/hourAgg/programAgg/categoryAgg/programDetailAgg on the
// target deployment and replays every span (up to a watermark captured the
// moment the wipe starts) through the exact same deriveSpanDeltas /
// applyAggregateDeltas path live ingest uses (see convex/rebuild.ts),
// rebuilding every rollup bucket with deviceName now part of its identity.
// The spans table itself is NEVER modified -- this only touches the
// materialized rollups, which are always reconstructible from spans.
//
// Resumable: all progress (which wipe table, which pagination cursor, the
// watermark, spans replayed so far) lives server-side in the
// rebuildCheckpoints table, keyed by --run-id. Re-running with the same
// --run-id after a crash/interrupt continues from the last committed page;
// each page's work and its cursor advance commit in the same Convex
// mutation transaction, so there is no dual-write drift to reconcile.
//
// NEVER run this against big-bertha prod from this wave -- local-stack
// validation only (see deploy/). The orchestrator runs the real wave-3
// rebuild once every tracker writing to that deployment is confirmed
// stopped and a snapshot/export has been taken.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference, type FunctionReference } from "convex/server";

// --- env -------------------------------------------------------------------
//
// Loads .env.local (repo root, resolved relative to this file so `bun run`
// works the same from any cwd) into process.env. Mirrors
// migration/lib/load-env.ts's exact convention -- existing process.env
// values always win, so an operator can override via a real export without
// editing the file.
function loadLocalEnv(): void {
    const envPath = join(dirname(fileURLToPath(import.meta.url)), "..", ".env.local");
    let contents: string;
    try {
        contents = readFileSync(envPath, "utf8");
    } catch {
        return;
    }
    for (const line of contents.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = value;
    }
}

// --- flags -------------------------------------------------------------------
//
// Mirrors migration/lib/args.ts's minimal parser -- no external CLI
// framework needed for two flags.
function parseFlags(argv: string[]): Map<string, string | true> {
    const flags = new Map<string, string | true>();
    for (let i = 0; i < argv.length; i++) {
        const token = argv[i]!;
        if (!token.startsWith("--")) continue;
        const name = token.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
            flags.set(name, next);
            i++;
        } else {
            flags.set(name, true);
        }
    }
    return flags;
}

// --- convex client -----------------------------------------------------------
//
// Same env vars and the same sanctioned setAdminAuth cast as
// migration/lib/convex-client.ts (see that file for the full justification:
// setAdminAuth is real at runtime but marked @internal and omitted from the
// published .d.ts). Function references are hand-built with
// makeFunctionReference rather than importing `internal` from
// convex/_generated/api on purpose -- ConvexHttpClient's public .mutation()/
// .query() methods are typed to accept only "public"-visibility
// FunctionReferences, and rebuild:rebuildAggregates / rebuild:bucketCounts
// are deliberately internalMutation/internalQuery (never callable from an
// ordinary Convex client); the admin-authenticated HTTP client is the one
// sanctioned way to invoke them from outside another Convex function.
function createAdminClient(): ConvexHttpClient {
    const url = process.env.CONVEX_SELF_HOSTED_URL;
    const adminKey = process.env.CONVEX_SELF_HOSTED_ADMIN_KEY;
    if (!url) {
        throw new Error("CONVEX_SELF_HOSTED_URL is not set (export it or put it in .env.local)");
    }
    if (!adminKey) {
        throw new Error("CONVEX_SELF_HOSTED_ADMIN_KEY is not set (export it or put it in .env.local)");
    }
    const client = new ConvexHttpClient(url, { skipConvexDeploymentUrlCheck: true });
    const withAdminAuth = client as unknown as { setAdminAuth: (token: string) => void };
    withAdminAuth.setAdminAuth(adminKey);
    return client;
}

interface RebuildStepResult {
    phase: "wipe" | "replay" | "complete";
    done: boolean;
    wipeTable?: string;
    deletedThisPage: number;
    replayedThisPage: number;
    totalSpansReplayed: number;
}

interface BucketCounts {
    dayAgg: number;
    hourAgg: number;
    programAgg: number;
    categoryAgg: number;
    programDetailAgg: number;
}

const fn = {
    rebuildAggregates: makeFunctionReference<"mutation", { runId: string }, RebuildStepResult>(
        "rebuild:rebuildAggregates",
    ),
    bucketCounts: makeFunctionReference<"query", Record<string, never>, BucketCounts>(
        "rebuild:bucketCounts",
    ),
} satisfies Record<string, FunctionReference<"query" | "mutation">>;

// --- preconditions -----------------------------------------------------------

const PRECONDITIONS_BANNER = `
chronomaxi rebuild-aggregates: DESTRUCTIVE against the target deployment's
dayAgg / hourAgg / programAgg / categoryAgg / programDetailAgg tables (wiped,
then replayed from spans). The spans table itself is never modified.

Operator preconditions -- verify ALL of these BEFORE running with --yes:
  1. Every tracker writing to this deployment is stopped. (A tracker still
     flushing spans mid-rebuild does not lose data -- its spans land after
     the watermark and get picked up by the NEXT rebuild run -- but the
     dashboard shows a stale/partial rollup view while this run is live.)
  2. A snapshot/export of the deployment has been taken (\`bunx convex export
     --path <file>\`, or the deploy/ backup runbook) so the pre-rebuild
     rollup state can be restored if this run needs to be aborted.
  3. CONVEX_SELF_HOSTED_URL / CONVEX_SELF_HOSTED_ADMIN_KEY point at the
     INTENDED deployment. Double check now -- this cannot be undone by
     re-running with a different --run-id.

Usage: bun run scripts/rebuild-aggregates.ts --yes [--run-id <id>]
`;

const PROGRESS_INTERVAL_SPANS = 2_500;

async function main(): Promise<void> {
    loadLocalEnv();
    const flags = parseFlags(process.argv.slice(2));
    const yes = flags.get("yes") === true;
    const runIdFlag = flags.get("run-id");
    const runId = typeof runIdFlag === "string" ? runIdFlag : "default";

    if (!yes) {
        console.log(PRECONDITIONS_BANNER);
        console.log(
            `[rebuild] refusing to run without --yes (target would be: ${process.env.CONVEX_SELF_HOSTED_URL ?? "CONVEX_SELF_HOSTED_URL not set"})`,
        );
        process.exit(1);
    }

    const client = createAdminClient();
    console.log(`[rebuild] target=${process.env.CONVEX_SELF_HOSTED_URL} runId="${runId}"`);

    const startTime = Date.now();
    let lastPhase: RebuildStepResult["phase"] | null = null;
    let deletedTotal = 0;
    let spansSinceLastLog = 0;
    let lastLogTime = startTime;
    let finalResult: RebuildStepResult | null = null;

    for (;;) {
        const step = await client.mutation(fn.rebuildAggregates, { runId });

        if (step.phase !== lastPhase) {
            const tableSuffix = step.wipeTable !== undefined ? ` (${step.wipeTable})` : "";
            console.log(`[rebuild] phase -> ${step.phase}${tableSuffix}`);
            lastPhase = step.phase;
        }

        deletedTotal += step.deletedThisPage;
        spansSinceLastLog += step.replayedThisPage;

        if (step.phase === "replay" && spansSinceLastLog >= PROGRESS_INTERVAL_SPANS) {
            const now = Date.now();
            const elapsedSeconds = (now - lastLogTime) / 1000;
            const spansPerSecond = elapsedSeconds > 0 ? spansSinceLastLog / elapsedSeconds : 0;
            console.log(
                `[rebuild] replay: ${step.totalSpansReplayed} spans replayed so far (${spansPerSecond.toFixed(0)} spans/s)`,
            );
            spansSinceLastLog = 0;
            lastLogTime = now;
        }

        if (step.done) {
            finalResult = step;
            break;
        }
    }

    const counts = await client.query(fn.bucketCounts, {});
    const elapsedSeconds = (Date.now() - startTime) / 1000;

    console.log(
        `[rebuild] done: deleted ${deletedTotal} pre-existing bucket rows, replayed ${finalResult?.totalSpansReplayed ?? 0} spans, ${elapsedSeconds.toFixed(1)}s elapsed`,
    );
    console.log(
        `[rebuild] final bucket counts: dayAgg=${counts.dayAgg} hourAgg=${counts.hourAgg} ` +
            `programAgg=${counts.programAgg} categoryAgg=${counts.categoryAgg} ` +
            `programDetailAgg=${counts.programDetailAgg}`,
    );
}

await main();
