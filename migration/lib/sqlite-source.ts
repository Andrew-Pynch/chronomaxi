// Rowid-keyset streaming reader over the tracker's SQLite `Log` table.
//
// Deliberately never uses OFFSET (an O(n) skip-scan that gets catastrophically
// slow past a few hundred thousand rows) or `ORDER BY createdAt` (createdAt has
// no index; agent://MigrationDesign measured a 274s cost for
// `ORDER BY createdAt LIMIT 5` against the 84M-row big-bertha archive, vs 1-15s
// for rowid-ordered scans over the same file -- rowid is a direct b-tree key
// lookup and rowid order was confirmed to match createdAt order at both ends of
// that archive). `WHERE rowid > cursor ORDER BY rowid LIMIT n` is an efficient
// seek regardless of table size, giving O(1) memory per chunk.

import { Database } from "bun:sqlite";

export interface SourceRow {
    rowid: number;
    id: string;
    createdAt: number | string;
    durationMs: number;
    category: string;
    isIdle: number;
    deviceName: string | null;
    windowId: string;
    programProcessName: string;
    programName: string;
    browserTitle: string | null;
    keysPressedCount: number | null;
    mouseMovementInMM: number | null;
    leftClickCount: number | null;
    rightClickCount: number | null;
    middleClickCount: number | null;
}

const SELECT_CHUNK_UNFILTERED = `
    SELECT rowid, id, createdAt, durationMs, category, isIdle, deviceName, windowId,
           programProcessName, programName, browserTitle, keysPressedCount,
           mouseMovementInMM, leftClickCount, rightClickCount, middleClickCount
    FROM Log
    WHERE rowid > ? AND rowid <= ?
    ORDER BY rowid
    LIMIT ?
`;

const SELECT_CHUNK_BY_DEVICE = `
    SELECT rowid, id, createdAt, durationMs, category, isIdle, deviceName, windowId,
           programProcessName, programName, browserTitle, keysPressedCount,
           mouseMovementInMM, leftClickCount, rightClickCount, middleClickCount
    FROM Log
    WHERE rowid > ? AND rowid <= ? AND deviceName = ?
    ORDER BY rowid
    LIMIT ?
`;

export class SqliteLogSource {
    private readonly db: Database;
    private readonly deviceFilter: string | null;

    /** `deviceFilter` scopes every read to one `deviceName` -- used for the
     * ron-live / ron-demo datasets, which share one physical SQLite file with
     * two unrelated devices (D2 synthetic seed data at rowid 1-8241, real
     * big-ron tracker rows from rowid 8242 on; confirmed non-interleaved).
     * `null` streams the whole table unfiltered -- used for bertha-archive,
     * where andrew-MS-7B86 and big-bertha are the SAME physical machine across
     * a hostname rename (one temporally sequential timeline, not two
     * concurrent devices), so no split is needed; alias resolution happens at
     * write time instead. */
    constructor(dbPath: string, deviceFilter: string | null = null) {
        this.db = new Database(dbPath, { readonly: true, create: false });
        this.deviceFilter = deviceFilter;
    }

    /** Freezes the read boundary for a migration pass; the live tracker may keep
     * writing beyond this rowid, untouched, for the duration of the pass. */
    maxRowid(): number {
        const sql = this.deviceFilter
            ? "SELECT MAX(rowid) AS m FROM Log WHERE deviceName = ?"
            : "SELECT MAX(rowid) AS m FROM Log";
        const row = (
            this.deviceFilter ? this.db.query(sql).get(this.deviceFilter) : this.db.query(sql).get()
        ) as { m: number | null };
        return row.m ?? 0;
    }

    totalRowCountEstimate(fromRowid: number, toRowid: number): number {
        const sql = this.deviceFilter
            ? "SELECT COUNT(*) AS c FROM Log WHERE rowid > ? AND rowid <= ? AND deviceName = ?"
            : "SELECT COUNT(*) AS c FROM Log WHERE rowid > ? AND rowid <= ?";
        const row = (
            this.deviceFilter
                ? this.db.query(sql).get(fromRowid, toRowid, this.deviceFilter)
                : this.db.query(sql).get(fromRowid, toRowid)
        ) as { c: number };
        return row.c;
    }

    /** Yields chunks of up to `chunkSize` matching rows, strictly increasing by
     * rowid, bounded to (cursorRowid, watermarkRowid]. An empty yield never
     * happens; the generator simply ends when no more matching rows exist in
     * range -- SQLite applies the deviceName predicate and LIMIT together, so
     * a long run of non-matching rows between matches costs a scan, not a
     * premature stop. */
    *streamFrom(cursorRowid: number, watermarkRowid: number, chunkSize = 10_000): Generator<SourceRow[]> {
        const stmt = this.db.query(this.deviceFilter ? SELECT_CHUNK_BY_DEVICE : SELECT_CHUNK_UNFILTERED);
        let cursor = cursorRowid;
        while (cursor < watermarkRowid) {
            const rows = (
                this.deviceFilter
                    ? stmt.all(cursor, watermarkRowid, this.deviceFilter, chunkSize)
                    : stmt.all(cursor, watermarkRowid, chunkSize)
            ) as SourceRow[];
            if (rows.length === 0) break;
            yield rows;
            cursor = rows[rows.length - 1]!.rowid;
        }
    }

    close(): void {
        this.db.close();
    }
}
