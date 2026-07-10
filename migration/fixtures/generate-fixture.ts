// Generates a synthetic SQLite fixture shaped exactly like the real tracker
// sources, for smoke-testing migration/import.ts + verify.ts against a LOCAL
// convex stack only. NEVER points at big-bertha or the real archive.
//
// Mirrors the real bertha-archive story on purpose: device A
// (andrew-MS-7B86) uses Prisma-style INTEGER unix-ms timestamps and ends
// before device B (big-bertha) begins, which uses rusqlite-style RFC3339 TEXT
// timestamps with nanosecond fractional seconds -- exercising both
// normalizeTimestamp() branches AND deviceAliases resolution (both canonicalize
// to "big-bertha") in one fixture. Rows are generated as deterministic
// contiguous runs (round-robin through a small activity-profile pool, random
// run lengths) so verify.ts's independent SQL RLE query has real compaction
// structure to check, not just 1-row-per-run noise.

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parseFlags, optionalString, optionalInt } from "../lib/args";

const DDL = `
    CREATE TABLE "Log" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL,
        "durationMs" INTEGER NOT NULL,
        "category" TEXT NOT NULL,
        "isIdle" BOOLEAN NOT NULL,
        "deviceName" TEXT,
        "windowId" TEXT NOT NULL,
        "programProcessName" TEXT NOT NULL,
        "programName" TEXT NOT NULL,
        "browserTitle" TEXT,
        "keysPressedCount" INTEGER,
        "mouseMovementInMM" REAL,
        "leftClickCount" INTEGER,
        "rightClickCount" INTEGER,
        "middleClickCount" INTEGER
    );
    CREATE INDEX "Log_isIdle_idx" ON "Log"("isIdle");
    CREATE INDEX "Log_windowId_idx" ON "Log"("windowId");
`;

interface Profile {
    windowId: string;
    programProcessName: string;
    programName: string;
    category: string;
    isIdle: number;
}

const PROFILES: Profile[] = [
    { windowId: "win-editor-1", programProcessName: "nvim", programName: "Neovim", category: "Coding", isIdle: 0 },
    { windowId: "win-term-1", programProcessName: "bash", programName: "Bash", category: "Coding", isIdle: 0 },
    {
        windowId: "win-browser-1",
        programProcessName: "firefox",
        programName: "Firefox",
        category: "Research",
        isIdle: 0,
    },
    {
        windowId: "win-slack-1",
        programProcessName: "slack",
        programName: "Slack",
        category: "Communication",
        isIdle: 0,
    },
    {
        windowId: "win-yt-1",
        programProcessName: "firefox",
        programName: "Firefox",
        category: "Entertainment",
        isIdle: 0,
    },
    { windowId: "win-idle-1", programProcessName: "lockscreen", programName: "Lock Screen", category: "Other", isIdle: 1 },
    {
        windowId: "win-editor-2",
        programProcessName: "code",
        programName: "VS Code",
        category: "Coding",
        isIdle: 0,
    },
    {
        windowId: "win-mail-1",
        programProcessName: "thunderbird",
        programName: "Thunderbird",
        category: "Communication",
        isIdle: 0,
    },
];

// mulberry32 -- small, fast, deterministic PRNG for reproducible fixtures.
function mulberry32(seed: number): () => number {
    let a = seed;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function randInt(rng: () => number, min: number, max: number): number {
    return min + Math.floor(rng() * (max - min + 1));
}

interface GeneratedRow {
    id: string;
    createdAt: number | string;
    updatedAt: string;
    durationMs: number;
    category: string;
    isIdle: number;
    deviceName: string;
    windowId: string;
    programProcessName: string;
    programName: string;
    browserTitle: string | null;
    keysPressedCount: number;
    mouseMovementInMM: number;
    leftClickCount: number;
    rightClickCount: number;
    middleClickCount: number;
}

function generateDeviceRows(
    rng: () => number,
    deviceName: string,
    rowCount: number,
    startEpochMs: number,
    timestampFormat: "integer" | "rfc3339",
    idPrefix: string
): GeneratedRow[] {
    const rows: GeneratedRow[] = [];
    let cursorMs = startEpochMs;
    let profileIndex = 0;
    let rowsEmitted = 0;
    let runIndex = 0;

    while (rowsEmitted < rowCount) {
        const profile = PROFILES[profileIndex % PROFILES.length]!;
        const runLength = Math.min(randInt(rng, 3, 60), rowCount - rowsEmitted);
        for (let i = 0; i < runLength; i++) {
            const durationMs = randInt(rng, 800, 90_000);
            const hasBrowserTitle = rng() < 0.6;
            rows.push({
                id: `${idPrefix}-${runIndex}-${i}-${crypto.randomUUID()}`,
                createdAt: timestampFormat === "integer" ? cursorMs : toRfc3339Nanos(cursorMs, rng),
                updatedAt: toRfc3339Nanos(cursorMs, rng),
                durationMs,
                category: profile.category,
                isIdle: profile.isIdle,
                deviceName,
                windowId: profile.windowId,
                programProcessName: profile.programProcessName,
                programName: profile.programName,
                browserTitle: hasBrowserTitle ? `Fixture Title ${runIndex}-${i}` : null,
                keysPressedCount: randInt(rng, 0, 40),
                mouseMovementInMM: randInt(rng, 0, 500),
                leftClickCount: randInt(rng, 0, 5),
                rightClickCount: randInt(rng, 0, 2),
                middleClickCount: randInt(rng, 0, 1),
            });
            cursorMs += durationMs;
        }
        rowsEmitted += runLength;
        profileIndex++;
        runIndex++;
    }
    return rows;
}

// Renders a chrono::DateTime<Utc>::to_rfc3339()-shaped string: nanosecond
// fractional seconds, "+00:00" offset (not "Z") -- matches the real
// rusqlite-authored rows exactly (see tracker/src/db.rs).
function toRfc3339Nanos(epochMs: number, rng: () => number): string {
    const datePart = new Date(epochMs).toISOString().split(".")[0];
    const nanos = String(randInt(rng, 0, 999_999_999)).padStart(9, "0");
    return `${datePart}.${nanos}+00:00`;
}

async function main(): Promise<void> {
    const flags = parseFlags(process.argv.slice(2));
    const outPath = optionalString(flags, "out") ?? `${import.meta.dir}/fixture.sqlite`;
    const rowsPerDevice = optionalInt(flags, "rows-per-device", 25_000);
    const seed = optionalInt(flags, "seed", 42);

    mkdirSync(dirname(outPath), { recursive: true });
    try {
        await Bun.file(outPath).delete();
    } catch {
        // fine, didn't exist
    }

    const rng = mulberry32(seed);

    // Device A (integer timestamps) ends before Device B (RFC3339 text
    // timestamps) begins -- mirrors the real archive's rename story exactly,
    // non-overlapping in time. Defaults reproduce the bertha-archive scenario
    // (andrew-MS-7B86 -> big-bertha); override --device-a/--device-b to
    // generate a ron-live/ron-demo-shaped fixture (e.g. D2 + big-ron) for
    // testing the device-filtered dataset path.
    const deviceAName = optionalString(flags, "device-a") ?? "andrew-MS-7B86";
    const deviceBName = optionalString(flags, "device-b") ?? "big-bertha";
    const deviceAStart = Date.UTC(2024, 0, 1, 0, 0, 0);
    const deviceARows = generateDeviceRows(rng, deviceAName, rowsPerDevice, deviceAStart, "integer", "a");
    const lastA = deviceARows[deviceARows.length - 1]!;
    const deviceAEndMs = (lastA.createdAt as number) + lastA.durationMs;
    const deviceBStart = deviceAEndMs + 3_600_000; // 1h gap, then the rename
    const deviceBRows = generateDeviceRows(rng, deviceBName, rowsPerDevice, deviceBStart, "rfc3339", "b");

    const db = new Database(outPath, { create: true });
    db.exec(DDL);
    const insert = db.query(
        `INSERT INTO Log (id, createdAt, updatedAt, durationMs, category, isIdle, deviceName, windowId,
                           programProcessName, programName, browserTitle, keysPressedCount,
                           mouseMovementInMM, leftClickCount, rightClickCount, middleClickCount)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const insertAll = db.transaction((rows: GeneratedRow[]) => {
        for (const r of rows) {
            insert.run(
                r.id,
                r.createdAt,
                r.updatedAt,
                r.durationMs,
                r.category,
                r.isIdle,
                r.deviceName,
                r.windowId,
                r.programProcessName,
                r.programName,
                r.browserTitle,
                r.keysPressedCount,
                r.mouseMovementInMM,
                r.leftClickCount,
                r.rightClickCount,
                r.middleClickCount
            );
        }
    });

    insertAll([...deviceARows, ...deviceBRows]);
    db.close();

    console.log(
        `[fixture] wrote ${deviceARows.length + deviceBRows.length} rows (${deviceARows.length} ${deviceAName} integer-ts + ${deviceBRows.length} ${deviceBName} rfc3339-ts) to ${outPath}`
    );
}

await main();
