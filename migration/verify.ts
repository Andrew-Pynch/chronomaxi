// chronomaxi migration verification.
//
//   bun run verify.ts --db <path> --dataset <bertha-archive|ron-live|ron-demo>
//
// Ground truth comes from an INDEPENDENT SQL run-length-encoding query against
// the source SQLite (not a re-run of migration/lib/compaction.ts -- the point
// is to catch a bug IN the compactor, not just confirm "did the network send
// what I told it to"). Convex-side actuals come from `convex export` (the
// same tool deploy/BACKUP-RUNBOOK.md uses for pre-import snapshots), read
// straight off the exported spans/documents.jsonl -- no bespoke verification
// query needed on the Convex side.
//
// See migration/README.md for paste-ready copies of these commands.

import { loadLocalEnv } from "./lib/load-env";
loadLocalEnv();

import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFlags, requireString } from "./lib/args";
import { DATASETS, isDatasetName } from "./lib/datasets";
import { normalizeTimestamp } from "./lib/normalize-timestamp";

interface SourceGroundTruth {
    rawDeviceName: string;
    runCount: number;
    rowCount: number;
    sumDurationMs: number;
    sumKeysPressedCount: number;
    sumClickCount: number;
    sumMouseMovementInMM: number;
    earliestStartedAt: number;
    latestEndedAt: number;
}

// Independent RLE cross-check: a global running run_id via SUM(is_new_run) OVER
// (ORDER BY rowid), grouped by device to get per-device run/row/sum totals in
// one pass. `IS` (not `=`) makes every key comparison NULL-safe, matching
// migration/lib/compaction.ts's `?? ""` fold for a nullable deviceName.
const RLE_SQL = `
    WITH ordered AS (
        SELECT rowid, deviceName, durationMs, keysPressedCount, mouseMovementInMM,
               leftClickCount, rightClickCount, middleClickCount,
               CASE WHEN deviceName IS LAG(deviceName) OVER w
                     AND windowId IS LAG(windowId) OVER w
                     AND programProcessName IS LAG(programProcessName) OVER w
                     AND category IS LAG(category) OVER w
                     AND isIdle IS LAG(isIdle) OVER w
                    THEN 0 ELSE 1 END AS is_new_run
        FROM Log
        WHERE (:deviceFilter IS NULL OR deviceName = :deviceFilter)
        WINDOW w AS (ORDER BY rowid)
    ),
    runs AS (
        SELECT rowid, deviceName, durationMs, keysPressedCount, mouseMovementInMM,
               leftClickCount, rightClickCount, middleClickCount,
               SUM(is_new_run) OVER (ORDER BY rowid) AS run_id
        FROM ordered
    )
    SELECT deviceName AS rawDeviceName,
           COUNT(DISTINCT run_id) AS runCount,
           COUNT(*) AS rowCount,
           SUM(durationMs) AS sumDurationMs,
           SUM(COALESCE(keysPressedCount, 0)) AS sumKeysPressedCount,
           SUM(COALESCE(leftClickCount, 0) + COALESCE(rightClickCount, 0) + COALESCE(middleClickCount, 0)) AS sumClickCount,
           SUM(COALESCE(mouseMovementInMM, 0)) AS sumMouseMovementInMM
    FROM runs
    GROUP BY deviceName
`;

function computeSourceGroundTruth(dbPath: string, deviceFilter: string | null): SourceGroundTruth[] {
    const db = new Database(dbPath, { readonly: true, create: false });
    try {
        const rows = db.query(RLE_SQL).all({ ":deviceFilter": deviceFilter }) as Array<
            Omit<SourceGroundTruth, "earliestStartedAt" | "latestEndedAt">
        >;

        return rows.map((row) => {
            const first = db
                .query("SELECT createdAt FROM Log WHERE deviceName = ? ORDER BY rowid ASC LIMIT 1")
                .get(row.rawDeviceName) as { createdAt: number | string };
            const last = db
                .query("SELECT createdAt, durationMs FROM Log WHERE deviceName = ? ORDER BY rowid DESC LIMIT 1")
                .get(row.rawDeviceName) as { createdAt: number | string; durationMs: number };
            return {
                ...row,
                earliestStartedAt: normalizeTimestamp(first.createdAt),
                latestEndedAt: normalizeTimestamp(last.createdAt) + last.durationMs,
            };
        });
    } finally {
        db.close();
    }
}

interface SpanDoc {
    sourceKey: string;
    rawDeviceName: string;
    deviceName: string;
    startedAt: number;
    endedAt: number;
    durationMs: number;
    keysPressedCount: number;
    mouseMovementInMM: number;
    leftClickCount: number;
    rightClickCount: number;
    middleClickCount: number;
}

function isSpanDoc(value: unknown): value is SpanDoc {
    if (typeof value !== "object" || value === null) return false;
    const v = value as Record<string, unknown>;
    return typeof v.sourceKey === "string" && typeof v.rawDeviceName === "string" && typeof v.startedAt === "number";
}

async function exportSpansViaConvexCli(): Promise<SpanDoc[]> {
    const tmpDir = mkdtempSync(join(tmpdir(), "chronomaxi-verify-"));
    const zipPath = join(tmpDir, "export.zip");
    const extractDir = join(tmpDir, "extracted");

    console.log(`[verify] running: bunx convex export --path ${zipPath}`);
    const exportProc = Bun.spawn(["bunx", "convex", "export", "--path", zipPath], {
        cwd: `${import.meta.dir}`,
        stdout: "pipe",
        stderr: "pipe",
    });
    const [exportExit, exportErr] = await Promise.all([exportProc.exited, new Response(exportProc.stderr).text()]);
    if (exportExit !== 0) {
        throw new Error(`convex export failed (exit ${exportExit}): ${exportErr}`);
    }

    // bsdtar (libarchive), not unzip: GNU unzip's zip-bomb heuristic false-positives
    // on Convex's export zips (overlapping local-file-header layout), rejecting a
    // perfectly valid archive with "invalid zip file with overlapped components".
    mkdirSync(extractDir, { recursive: true });
    const extractProc = Bun.spawn(["bsdtar", "-xf", zipPath, "-C", extractDir], {
        stdout: "pipe",
        stderr: "pipe",
    });
    const [extractExit, extractErr] = await Promise.all([extractProc.exited, new Response(extractProc.stderr).text()]);
    if (extractExit !== 0) {
        throw new Error(`bsdtar extraction failed (exit ${extractExit}): ${extractErr}`);
    }

    const jsonlPath = join(extractDir, "spans", "documents.jsonl");
    let contents: string;
    try {
        contents = readFileSync(jsonlPath, "utf8");
    } catch (err) {
        throw new Error(`no spans/documents.jsonl in export (spans table empty or missing?): ${err}`);
    }

    const spans: SpanDoc[] = [];
    for (const line of contents.split("\n")) {
        if (line.trim().length === 0) continue;
        const parsed: unknown = JSON.parse(line);
        if (!isSpanDoc(parsed)) {
            throw new Error(`spans/documents.jsonl line does not match expected span shape: ${line}`);
        }
        spans.push(parsed);
    }

    rmSync(tmpDir, { recursive: true, force: true });
    return spans;
}

interface ConvexAggregate {
    spanCount: number;
    sumDurationMs: number;
    sumKeysPressedCount: number;
    sumClickCount: number;
    sumMouseMovementInMM: number;
    earliestStartedAt: number;
    latestEndedAt: number;
}

function aggregateSpansByRawDevice(spans: SpanDoc[]): Map<string, ConvexAggregate> {
    const byDevice = new Map<string, ConvexAggregate>();
    for (const span of spans) {
        const existing = byDevice.get(span.rawDeviceName);
        const clickCount = span.leftClickCount + span.rightClickCount + span.middleClickCount;
        if (existing) {
            existing.spanCount += 1;
            existing.sumDurationMs += span.durationMs;
            existing.sumKeysPressedCount += span.keysPressedCount;
            existing.sumClickCount += clickCount;
            existing.sumMouseMovementInMM += span.mouseMovementInMM;
            existing.earliestStartedAt = Math.min(existing.earliestStartedAt, span.startedAt);
            existing.latestEndedAt = Math.max(existing.latestEndedAt, span.endedAt);
        } else {
            byDevice.set(span.rawDeviceName, {
                spanCount: 1,
                sumDurationMs: span.durationMs,
                sumKeysPressedCount: span.keysPressedCount,
                sumClickCount: clickCount,
                sumMouseMovementInMM: span.mouseMovementInMM,
                earliestStartedAt: span.startedAt,
                latestEndedAt: span.endedAt,
            });
        }
    }
    return byDevice;
}

function findDuplicateSourceKeys(spans: SpanDoc[]): string[] {
    const seen = new Map<string, number>();
    for (const span of spans) {
        seen.set(span.sourceKey, (seen.get(span.sourceKey) ?? 0) + 1);
    }
    return [...seen.entries()].filter(([, count]) => count > 1).map(([key]) => key);
}

function checkRow(label: string, expected: number, actual: number, tolerance = 0): boolean {
    const diff = Math.abs(expected - actual);
    const ok = diff <= tolerance;
    console.log(`  ${ok ? "OK  " : "FAIL"} ${label}: expected=${expected} actual=${actual}${ok ? "" : ` diff=${diff}`}`);
    return ok;
}

async function main(): Promise<void> {
    const flags = parseFlags(process.argv.slice(2));
    const dbPath = requireString(flags, "db");
    const datasetArg = requireString(flags, "dataset");
    if (!isDatasetName(datasetArg)) {
        throw new Error(`--dataset must be one of ${Object.keys(DATASETS).join(", ")}, got "${datasetArg}"`);
    }

    console.log(`[verify] dataset=${datasetArg} db=${dbPath}`);
    console.log(`[verify] computing ground truth via independent SQL RLE query against source...`);
    const groundTruth = computeSourceGroundTruth(dbPath, DATASETS[datasetArg].deviceFilter);

    console.log(`[verify] fetching Convex spans via convex export...`);
    const spans = await exportSpansViaConvexCli();
    const convexByDevice = aggregateSpansByRawDevice(spans);

    let allOk = true;
    for (const gt of groundTruth) {
        console.log(`\n[verify] device "${gt.rawDeviceName}": ${gt.rowCount} source rows -> ${gt.runCount} expected spans`);
        const actual = convexByDevice.get(gt.rawDeviceName);
        if (!actual) {
            console.log(`  FAIL no Convex spans found for rawDeviceName="${gt.rawDeviceName}"`);
            allOk = false;
            continue;
        }
        allOk = checkRow("span count", gt.runCount, actual.spanCount) && allOk;
        allOk = checkRow("SUM(durationMs)", gt.sumDurationMs, actual.sumDurationMs) && allOk;
        allOk = checkRow("SUM(keysPressedCount)", gt.sumKeysPressedCount, actual.sumKeysPressedCount) && allOk;
        allOk = checkRow("SUM(clicks)", gt.sumClickCount, actual.sumClickCount) && allOk;
        // mouseMovementInMM is a REAL/float sum -- tolerate float rounding.
        allOk =
            checkRow("SUM(mouseMovementInMM)", Math.round(gt.sumMouseMovementInMM), Math.round(actual.sumMouseMovementInMM), 1) &&
            allOk;
        allOk = checkRow("MIN(startedAt)", gt.earliestStartedAt, actual.earliestStartedAt) && allOk;
        allOk = checkRow("MAX(endedAt)", gt.latestEndedAt, actual.latestEndedAt) && allOk;
    }

    const relevantDevices = new Set(groundTruth.map((gt) => gt.rawDeviceName));
    const relevantSpans = spans.filter((s) => relevantDevices.has(s.rawDeviceName));
    const duplicates = findDuplicateSourceKeys(relevantSpans);
    console.log(`\n[verify] uniqueness: ${duplicates.length} duplicate sourceKey(s) among ${relevantSpans.length} spans`);
    if (duplicates.length > 0) {
        console.log(`  FAIL duplicates: ${duplicates.slice(0, 10).join(", ")}${duplicates.length > 10 ? ", ..." : ""}`);
        allOk = false;
    } else {
        console.log(`  OK   no duplicate sourceKeys`);
    }

    console.log(`\n[verify] ${allOk ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED"}`);
    if (!allOk) process.exit(1);
}

await main();
