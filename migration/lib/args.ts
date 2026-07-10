// Minimal flag parser shared by import.ts and verify.ts -- no external CLI
// framework needed for a script with this few flags.

export function parseFlags(argv: string[]): Map<string, string | true> {
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

export function requireString(flags: Map<string, string | true>, name: string): string {
    const value = flags.get(name);
    if (typeof value !== "string" || value.length === 0) {
        throw new Error(`missing required --${name} <value>`);
    }
    return value;
}

export function optionalString(flags: Map<string, string | true>, name: string): string | undefined {
    const value = flags.get(name);
    return typeof value === "string" ? value : undefined;
}

export function optionalInt(flags: Map<string, string | true>, name: string, fallback: number): number {
    const value = flags.get(name);
    if (value === undefined) return fallback;
    if (typeof value !== "string") throw new Error(`--${name} requires a numeric value`);
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`--${name} must be a positive integer, got ${value}`);
    return n;
}

export function hasFlag(flags: Map<string, string | true>, name: string): boolean {
    return flags.get(name) !== undefined;
}
