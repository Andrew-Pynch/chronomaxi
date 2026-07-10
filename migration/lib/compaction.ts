// Run-length compaction of contiguous source rows into span-shaped records.
//
// Compaction key per agent://MigrationDesign / Main's contract (exactly 5
// fields, in rowid order -- NOT createdAt order, since rowid is the only
// indexed, monotonically-increasing column in the source):
//   (deviceName, windowId, programProcessName, category, isIdle)
//
// `--mode compact` merges contiguous runs sharing that key into one span:
//   startedAt   = first row's normalized createdAt
//   endedAt     = last row's normalized createdAt + its durationMs
//   durationMs  = SUM(durationMs) across the run (the measured/active time;
//                 may be < endedAt-startedAt if there was a tracker-downtime
//                 gap inside the run -- both fields are kept, nothing is lost)
//   counters    = SUM across the run
//   browserTitle = last non-null title observed in the run
//   programName  = first row's programName (expected 1:1-correlated with
//                  programProcessName per MigrationDesign's defensive note;
//                  not part of the compaction key itself)
//   sourceKey   = `<dataset>:<firstRowid>-<lastRowid>`
//
// `--mode raw` treats every row as its own one-row "run" (sourceKey
// `<dataset>:<rowid>`), for a dataset where the source is already span-shaped
// (e.g. a future device with no compaction upside) or for debugging.

import { normalizeTimestamp } from "./normalize-timestamp";
import type { DeviceAliasResolver } from "./device-aliases";
import type { SourceRow } from "./sqlite-source";

export interface CompactedSpan {
    sourceKey: string;
    rawDeviceName: string;
    deviceName: string;
    startedAt: number;
    endedAt: number;
    durationMs: number;
    category: string;
    isIdle: boolean;
    windowId: string;
    programProcessName: string;
    programName: string;
    browserTitle: string | null;
    keysPressedCount: number;
    mouseMovementInMM: number;
    leftClickCount: number;
    rightClickCount: number;
    middleClickCount: number;
    sourceRowCount: number;
}

type RunKey = string;

function runKeyOf(row: SourceRow): RunKey {
    // deviceName is nullable in the source schema; fold null into the empty
    // string rather than silently dropping the row from compaction.
    return JSON.stringify([row.deviceName ?? "", row.windowId, row.programProcessName, row.category, row.isIdle]);
}

class RunAccumulator {
    sourceKeyPrefix: string;
    firstRowid: number;
    lastRowid: number;
    rawDeviceName: string;
    startedAt: number;
    endedAt: number;
    durationMs = 0;
    windowId: string;
    programProcessName: string;
    programName: string;
    category: string;
    isIdle: boolean;
    browserTitle: string | null = null;
    keysPressedCount = 0;
    mouseMovementInMM = 0;
    leftClickCount = 0;
    rightClickCount = 0;
    middleClickCount = 0;
    sourceRowCount = 0;

    constructor(dataset: string, row: SourceRow, startMs: number) {
        this.sourceKeyPrefix = dataset;
        this.firstRowid = row.rowid;
        this.lastRowid = row.rowid;
        this.rawDeviceName = row.deviceName ?? "";
        this.startedAt = startMs;
        this.endedAt = startMs + row.durationMs;
        this.windowId = row.windowId;
        this.programProcessName = row.programProcessName;
        this.programName = row.programName;
        this.category = row.category;
        this.isIdle = Boolean(row.isIdle);
        this.absorb(row, startMs);
    }

    absorb(row: SourceRow, startMs: number): void {
        this.lastRowid = row.rowid;
        this.durationMs += row.durationMs;
        this.endedAt = startMs + row.durationMs;
        if (row.browserTitle) this.browserTitle = row.browserTitle;
        this.keysPressedCount += row.keysPressedCount ?? 0;
        this.mouseMovementInMM += row.mouseMovementInMM ?? 0;
        this.leftClickCount += row.leftClickCount ?? 0;
        this.rightClickCount += row.rightClickCount ?? 0;
        this.middleClickCount += row.middleClickCount ?? 0;
        this.sourceRowCount += 1;
    }

    finalize(aliasResolver: DeviceAliasResolver): CompactedSpan {
        return {
            sourceKey:
                this.firstRowid === this.lastRowid
                    ? `${this.sourceKeyPrefix}:${this.firstRowid}`
                    : `${this.sourceKeyPrefix}:${this.firstRowid}-${this.lastRowid}`,
            rawDeviceName: this.rawDeviceName,
            deviceName: aliasResolver.resolve(this.rawDeviceName),
            startedAt: this.startedAt,
            endedAt: this.endedAt,
            durationMs: this.durationMs,
            category: this.category,
            isIdle: this.isIdle,
            windowId: this.windowId,
            programProcessName: this.programProcessName,
            programName: this.programName,
            browserTitle: this.browserTitle,
            keysPressedCount: this.keysPressedCount,
            mouseMovementInMM: this.mouseMovementInMM,
            leftClickCount: this.leftClickCount,
            rightClickCount: this.rightClickCount,
            middleClickCount: this.middleClickCount,
            sourceRowCount: this.sourceRowCount,
        };
    }
}

export type CompactionMode = "compact" | "raw";

/** Incremental run-length compactor. Deliberately finalizes (closes) whatever
 * run is open whenever `flushOpenRun()` is called explicitly by the caller at
 * the end of a pass, rather than persisting in-flight accumulator state across
 * process restarts -- see agent://MigrationDesign's "resume_design_note": this
 * trades at most one extra span split per source per pass for eliminating an
 * entire class of cross-process resume bugs. Never loses or double-counts a
 * metric across the split. */
export class RunCompactor {
    private readonly dataset: string;
    private readonly mode: CompactionMode;
    private readonly aliasResolver: DeviceAliasResolver;
    private openRun: RunAccumulator | null = null;
    private openRunKey: RunKey | null = null;

    constructor(dataset: string, mode: CompactionMode, aliasResolver: DeviceAliasResolver) {
        this.dataset = dataset;
        this.mode = mode;
        this.aliasResolver = aliasResolver;
    }

    /** Feeds one chunk of rows (already in rowid order); returns spans that
     * closed within this chunk. The last run in the chunk stays open unless it
     * ends the chunk's dataset and the caller calls flushOpenRun(). */
    push(rows: SourceRow[]): CompactedSpan[] {
        const closed: CompactedSpan[] = [];
        for (const row of rows) {
            const startMs = normalizeTimestamp(row.createdAt);

            if (this.mode === "raw") {
                closed.push(new RunAccumulator(this.dataset, row, startMs).finalize(this.aliasResolver));
                continue;
            }

            const key = runKeyOf(row);
            if (this.openRun && this.openRunKey === key) {
                this.openRun.absorb(row, startMs);
            } else {
                if (this.openRun) closed.push(this.openRun.finalize(this.aliasResolver));
                this.openRun = new RunAccumulator(this.dataset, row, startMs);
                this.openRunKey = key;
            }
        }
        return closed;
    }

    /** Must be called once at the end of every pass (backfill, catch-up, or
     * cutover) to close whatever run is still accumulating. Idempotent to call
     * with nothing open. */
    flushOpenRun(): CompactedSpan[] {
        if (!this.openRun) return [];
        const span = this.openRun.finalize(this.aliasResolver);
        this.openRun = null;
        this.openRunKey = null;
        return [span];
    }
}
