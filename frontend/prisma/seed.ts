// Synthetic activity seed for local dev. Run: bunx tsx prisma/seed.ts (or bun run prisma/seed.ts)
import { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";

const db = new PrismaClient();

type ProgramDef = {
    processName: string;
    programName: string;
    category: string;
    browserTitles?: string[];
    weight: number;
    keysPerMin: [number, number];
};

const PROGRAMS: ProgramDef[] = [
    { processName: "kitty", programName: "kitty", category: "Coding", weight: 34, keysPerMin: [40, 220] },
    { processName: "nvim", programName: "Neovim", category: "Coding", weight: 18, keysPerMin: [80, 300] },
    {
        processName: "zen",
        programName: "Zen Browser",
        category: "Research",
        weight: 22,
        keysPerMin: [5, 60],
        browserTitles: [
            "Hacker News",
            "chronomaxi/README.md at main",
            "Rust std::time - docs.rs",
            "Hyprland Wiki - Window Rules",
            "YouTube",
        ],
    },
    { processName: "slack", programName: "Slack", category: "Communication", weight: 8, keysPerMin: [20, 120] },
    { processName: "spotify", programName: "Spotify", category: "Entertainment", weight: 6, keysPerMin: [0, 5] },
    { processName: "discord", programName: "Discord", category: "Communication", weight: 5, keysPerMin: [10, 90] },
    { processName: "obsidian", programName: "Obsidian", category: "Other", weight: 4, keysPerMin: [60, 200] },
    { processName: "steam", programName: "Steam", category: "Entertainment", weight: 3, keysPerMin: [0, 30] },
];

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const randInt = (lo: number, hi: number) => Math.floor(rand(lo, hi + 1));

function pickProgram(): ProgramDef {
    const total = PROGRAMS.reduce((s, p) => s + p.weight, 0);
    let r = Math.random() * total;
    for (const p of PROGRAMS) {
        r -= p.weight;
        if (r <= 0) return p;
    }
    return PROGRAMS[0]!;
}

async function main() {
    const existing = await db.log.count();
    if (existing > 0) {
        console.log(`DB already has ${existing} logs, skipping seed. Delete prisma/db.sqlite rows to reseed.`);
        return;
    }

    const rows: Prisma.LogCreateManyInput[] = [];
    const now = new Date();

    for (let dayOffset = 6; dayOffset >= 0; dayOffset--) {
        const day = new Date(now);
        day.setDate(day.getDate() - dayOffset);
        // Sessions: morning 9-12, afternoon 13-18, evening 20-23 (skip some randomly)
        const sessions: Array<[number, number]> = [
            [9, 12],
            [13, 18],
            [20, 23],
        ].filter(() => Math.random() > 0.15) as Array<[number, number]>;

        for (const [startH, endH] of sessions) {
            let t = new Date(day);
            t.setHours(startH, randInt(0, 20), 0, 0);
            const end = new Date(day);
            end.setHours(endH, randInt(0, 45), 0, 0);
            if (dayOffset === 0 && end > now) end.setTime(now.getTime());

            let current = pickProgram();
            while (t < end) {
                // switch programs occasionally
                if (Math.random() < 0.12) current = pickProgram();
                const durationMs = randInt(25_000, 35_000);
                const minutes = durationMs / 60_000;
                const keys = Math.round(rand(...current.keysPerMin) * minutes);
                rows.push({
                    createdAt: new Date(t),
                    updatedAt: new Date(t),
                    durationMs,
                    category: current.category,
                    isIdle: Math.random() < 0.06,
                    deviceName: "D2",
                    windowId: `0x${randInt(0x1000, 0xffff).toString(16)}`,
                    programProcessName: current.processName,
                    programName: current.programName,
                    browserTitle: current.browserTitles
                        ? current.browserTitles[randInt(0, current.browserTitles.length - 1)]
                        : null,
                    keysPressedCount: keys,
                    mouseMovementInMM: rand(0, 900),
                    leftClickCount: randInt(0, 40),
                    rightClickCount: randInt(0, 6),
                    middleClickCount: randInt(0, 3),
                });
                t = new Date(t.getTime() + durationMs);
            }
        }
    }

    // createMany in chunks
    for (let i = 0; i < rows.length; i += 500) {
        await db.log.createMany({ data: rows.slice(i, i + 500) });
    }
    console.log(`Seeded ${rows.length} logs across 7 days.`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => db.$disconnect());
