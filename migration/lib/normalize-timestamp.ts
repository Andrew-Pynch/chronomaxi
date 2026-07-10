// Normalizes the two createdAt storage shapes present across chronomaxi's SQLite
// sources into a single canonical unix-ms integer.
//
//   - Prisma-authored rows (seed.ts, D2 demo data): stored as SQLite INTEGER,
//     already unix ms (Prisma's DateTime serialization for JS Date objects).
//   - rusqlite-authored rows (tracker/src/db.rs, bulk_insert_sqlite): stored as
//     SQLite TEXT via chrono's `DateTime<Utc>::to_rfc3339()`, e.g.
//     "2026-07-10T02:13:21.775240894+00:00" -- nanosecond-precision fractional
//     seconds are NOT guaranteed parseable by every JS Date implementation per
//     ECMA-262 (only milliseconds, 3 digits, are specified), so fractional
//     seconds are defensively truncated to 3 digits before Date.parse.
//
// Verified against agent://MigrationDesign's live sampling of both sources
// (frontend/prisma/db.sqlite: D2=integer 100%, big-ron=text 100%; big-bertha
// archive: text 100%, zero integer rows).

const FRACTIONAL_SECONDS_RE = /\.(\d{3})\d*/;

export function normalizeTimestamp(value: number | string): number {
    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new Error(`non-finite integer createdAt: ${value}`);
        }
        return Math.trunc(value);
    }

    const truncated = value.includes(".") ? value.replace(FRACTIONAL_SECONDS_RE, ".$1") : value;
    const ms = Date.parse(truncated);
    if (Number.isNaN(ms)) {
        throw new Error(`unparseable RFC3339 createdAt: ${JSON.stringify(value)}`);
    }
    return ms;
}
