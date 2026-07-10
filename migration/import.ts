// chronomaxi historical migration importer.
//
//   bun run import.ts --db <path> --dataset <bertha-archive|ron-live|ron-demo> [--mode compact|raw]
//                      [--batch-size 400] [--chunk-size 10000] [--import-batch <tag>]
//
// See migration/README.md for the full runbook (bertha copy-vs-in-place
// strategy, runtime estimates, the migration-before-cutover ordering gate,
// and paste-ready verification commands).
//
// NEVER run this against big-bertha or the real archive from this wave --
// repo-side only, local-stack smoke testing per the assignment.

import { loadLocalEnv } from "./lib/load-env";
loadLocalEnv();

import { createAdminClient } from "./lib/convex-client";
import { DeviceAliasResolver } from "./lib/device-aliases";
import { CheckpointManager } from "./lib/checkpoint-manager";
import { DATASETS, isDatasetName } from "./lib/datasets";
import { SqliteLogSource } from "./lib/sqlite-source";
import { RunCompactor, type CompactionMode } from "./lib/compaction";
import { AdaptiveBatchWriter, toSpanImportInput } from "./lib/batch-writer";
import { parseFlags, requireString, optionalString, optionalInt } from "./lib/args";

const PROGRESS_INTERVAL_ROWS = 10_000;

function formatEta(rowsPerSecond: number, rowsRemaining: number): string {
    if (rowsPerSecond <= 0) return "unknown";
    const secondsRemaining = rowsRemaining / rowsPerSecond;
    if (secondsRemaining < 60) return `${secondsRemaining.toFixed(0)}s`;
    if (secondsRemaining < 3600) return `${(secondsRemaining / 60).toFixed(1)}m`;
    return `${(secondsRemaining / 3600).toFixed(2)}h`;
}

async function main(): Promise<void> {
    const flags = parseFlags(process.argv.slice(2));
    const dbPath = requireString(flags, "db");
    const datasetArg = requireString(flags, "dataset");
    if (!isDatasetName(datasetArg)) {
        throw new Error(`--dataset must be one of ${Object.keys(DATASETS).join(", ")}, got "${datasetArg}"`);
    }
    const dataset = datasetArg;
    const modeArg = optionalString(flags, "mode") ?? "compact";
    if (modeArg !== "compact" && modeArg !== "raw") {
        throw new Error(`--mode must be "compact" or "raw", got "${modeArg}"`);
    }
    const mode: CompactionMode = modeArg;
    const batchSize = optionalInt(flags, "batch-size", 400);
    const chunkSize = optionalInt(flags, "chunk-size", 10_000);
    const importBatchOverride = optionalString(flags, "import-batch");

    console.log(`[import] dataset=${dataset} mode=${mode} db=${dbPath} batchSize=${batchSize} chunkSize=${chunkSize}`);

    const client = createAdminClient();
    const [aliasResolver, checkpointManager] = [
        await DeviceAliasResolver.load(client),
        new CheckpointManager(client, dataset),
    ];

    const existingCheckpoint = await checkpointManager.load();
    const fromRowidFlag = optionalString(flags, "from-rowid");
    const cursorStart = fromRowidFlag !== undefined ? Number.parseInt(fromRowidFlag, 10) : (existingCheckpoint?.lastSourceRowid ?? 0);
    const importBatch =
        importBatchOverride ??
        `${existingCheckpoint ? "catchup" : "backfill"}-${dataset}-${new Date().toISOString()}`;

    const source = new SqliteLogSource(dbPath, DATASETS[dataset].deviceFilter);
    const watermarkRowid = source.maxRowid();

    if (cursorStart >= watermarkRowid) {
        console.log(
            `[import] nothing to do: checkpoint cursor ${cursorStart} already at or past watermark ${watermarkRowid}`
        );
        source.close();
        return;
    }

    const totalRowsThisPass = source.totalRowCountEstimate(cursorStart, watermarkRowid);
    console.log(
        `[import] resuming from rowid ${cursorStart}, watermark ${watermarkRowid} (${totalRowsThisPass} rows this pass), importBatch="${importBatch}"`
    );

    const compactor = new RunCompactor(dataset, mode, aliasResolver);
    const writer = new AdaptiveBatchWriter(client, importBatch, batchSize);

    let cursorRowid = cursorStart;
    let lastSourceLogId: string | null = existingCheckpoint?.lastSourceLogId ?? null;
    let rowsProcessedThisPass = 0;
    let rowsSinceLastLog = 0;
    let rowsSinceLastCheckpoint = 0;
    const startTime = Date.now();

    for (const rows of source.streamFrom(cursorStart, watermarkRowid, chunkSize)) {
        const closedSpans = compactor.push(rows);
        if (closedSpans.length > 0) {
            await writer.write(closedSpans.map(toSpanImportInput));
        }

        cursorRowid = rows[rows.length - 1]!.rowid;
        lastSourceLogId = rows[rows.length - 1]!.id;
        rowsProcessedThisPass += rows.length;
        rowsSinceLastLog += rows.length;
        rowsSinceLastCheckpoint += rows.length;

        if (rowsSinceLastLog >= PROGRESS_INTERVAL_ROWS) {
            const elapsedSeconds = (Date.now() - startTime) / 1000;
            const rowsPerSecond = rowsProcessedThisPass / elapsedSeconds;
            const remaining = totalRowsThisPass - rowsProcessedThisPass;
            console.log(
                `[import] ${rowsProcessedThisPass}/${totalRowsThisPass} rows ` +
                    `(${((rowsProcessedThisPass / totalRowsThisPass) * 100).toFixed(1)}%), ` +
                    `${writer.totalInserted} inserted, ${writer.totalSkipped} skipped, ` +
                    `${rowsPerSecond.toFixed(0)} rows/s, ETA ${formatEta(rowsPerSecond, remaining)}, ` +
                    `batchSize=${writer.currentBatchSize}`
            );
            rowsSinceLastLog = 0;
        }

        if (rowsSinceLastCheckpoint >= PROGRESS_INTERVAL_ROWS) {
            await checkpointManager.save({
                dataset,
                lastSourceRowid: cursorRowid,
                lastSourceLogId,
                spansWritten: writer.totalInserted + writer.totalSkipped,
                status: "running",
                importBatch,
            });
            rowsSinceLastCheckpoint = 0;
        }
    }

    // Always close whatever run is still open at the end of a pass -- never
    // thread in-flight accumulator state across process restarts.
    const finalSpans = compactor.flushOpenRun();
    if (finalSpans.length > 0) {
        await writer.write(finalSpans.map(toSpanImportInput));
    }

    await checkpointManager.save({
        dataset,
        lastSourceRowid: watermarkRowid,
        lastSourceLogId,
        spansWritten: writer.totalInserted + writer.totalSkipped,
        status: "complete",
        importBatch,
    });

    const elapsedSeconds = (Date.now() - startTime) / 1000;
    source.close();

    console.log(
        `[import] done: ${rowsProcessedThisPass} source rows -> ${writer.totalInserted} spans inserted, ` +
            `${writer.totalSkipped} spans skipped (already present), ${elapsedSeconds.toFixed(1)}s elapsed, ` +
            `importBatch="${importBatch}", checkpoint at rowid ${watermarkRowid} (status=complete)`
    );
}

await main();
