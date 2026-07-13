import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { statuslineHttpHandler } from "./statusline";

// Machine-to-machine auth for both routes below: a single shared secret in
// the Authorization header, per docs.convex.dev/auth's documented pattern
// for HTTP actions with no end-user identity ("write public functions
// accessible to the internet that check a shared secret ... before doing
// anything else"). Set via `convex env set CHRONOMAXI_INGEST_SECRET <value>`
// on the deployment; there is no default, a missing env var fails closed.
const MAX_INGEST_BATCH_SIZE = 500;

function checkBearerSecret(request: Request): Response | null {
    const expected = process.env.CHRONOMAXI_INGEST_SECRET;
    if (!expected) {
        return new Response("CHRONOMAXI_INGEST_SECRET not configured", {
            status: 500,
        });
    }
    const header = request.headers.get("Authorization") ?? "";
    const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (provided !== expected) {
        return new Response("Unauthorized", { status: 401 });
    }
    return null;
}

async function readJsonBody(request: Request): Promise<unknown | typeof INVALID_JSON> {
    try {
        return await request.json();
    } catch {
        return INVALID_JSON;
    }
}
const INVALID_JSON = Symbol("invalid-json");

// serde_json (the Rust tracker's JSON serializer) encodes `Option::None` as
// an explicit JSON `null`, not an omitted key, by default -- normalize null
// to undefined for every top-level field so Convex's `v.optional(...)`
// validators (which mean "absent", not "null") accept the wire format
// either way, without forcing every optional field on the Rust side to
// carry a `#[serde(skip_serializing_if = "Option::is_none")]` annotation.
function nullsToUndefined(value: unknown): unknown {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return value;
    }
    const result: Record<string, unknown> = {};
    for (const [key, fieldValue] of Object.entries(value)) {
        result[key] = fieldValue === null ? undefined : fieldValue;
    }
    return result;
}

// Mirrors convex/spans.ts's ingestSpanValidator -- validated here (not just
// cast) because this is untrusted network input crossing the HTTP boundary;
// a shape failure should produce a clear 400 for the tracker's spool/retry
// logic to act on, rather than an opaque error surfacing from deep inside
// the downstream mutation's own argument validator.
interface IngestSpanItem {
    sourceId: string;
    createdAt: number;
    durationMs: number;
    category: string;
    isIdle: boolean;
    deviceName: string;
    actor: string;
    windowId: string;
    programProcessName: string;
    programName: string;
    subProgram?: string;
    tmuxSession?: string;
    bucket?: string;
    browserTitle?: string;
    keysPressedCount?: number;
    mouseMovementInMM?: number;
    leftClickCount?: number;
    rightClickCount?: number;
    middleClickCount?: number;
    tokensSpent?: number;
}

function isIngestSpanItem(item: unknown): item is IngestSpanItem {
    if (typeof item !== "object" || item === null) return false;
    if (!("sourceId" in item) || typeof item.sourceId !== "string") return false;
    if (!("createdAt" in item) || typeof item.createdAt !== "number") return false;
    if (!("durationMs" in item) || typeof item.durationMs !== "number") return false;
    if (!("category" in item) || typeof item.category !== "string") return false;
    if (!("isIdle" in item) || typeof item.isIdle !== "boolean") return false;
    if (!("deviceName" in item) || typeof item.deviceName !== "string") return false;
    if (!("actor" in item) || typeof item.actor !== "string") return false;
    if (!("windowId" in item) || typeof item.windowId !== "string") return false;
    if (!("programProcessName" in item) || typeof item.programProcessName !== "string")
        return false;
    if (!("programName" in item) || typeof item.programName !== "string") return false;
    return true;
}

const http = httpRouter();

http.route({
    path: "/ingest",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
        const authError = checkBearerSecret(request);
        if (authError) return authError;

        const body = await readJsonBody(request);
        if (body === INVALID_JSON) {
            return new Response("Invalid JSON body", { status: 400 });
        }
        if (typeof body !== "object" || body === null || !("batch" in body)) {
            return new Response('Body must be { "batch": [...] }', { status: 400 });
        }
        const { batch } = body;
        if (!Array.isArray(batch)) {
            return new Response('Body must be { "batch": [...] }', { status: 400 });
        }
        if (batch.length === 0) {
            return new Response(JSON.stringify({ inserted: 0, skipped: 0 }), {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        }
        if (batch.length > MAX_INGEST_BATCH_SIZE) {
            return new Response(
                `batch exceeds max size of ${MAX_INGEST_BATCH_SIZE}`,
                { status: 400 },
            );
        }
        const normalizedBatch = batch.map(nullsToUndefined);
        if (!normalizedBatch.every(isIngestSpanItem)) {
            return new Response("batch contains a malformed span item", {
                status: 400,
            });
        }

        const result = await ctx.runMutation(internal.spans.ingestSpanBatch, {
            batch: normalizedBatch,
        });

        return new Response(JSON.stringify(result), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
    }),
});

interface DictationBody {
    host: string;
    ts: number | string;
    words: number;
    source: "kloyce";
}

function isDictationBody(body: unknown): body is DictationBody {
    if (typeof body !== "object" || body === null) return false;
    if (!("host" in body) || typeof body.host !== "string") return false;
    if (!("ts" in body) || (typeof body.ts !== "number" && typeof body.ts !== "string")) return false;
    if (!("words" in body) || typeof body.words !== "number") return false;
    if (!("source" in body) || body.source !== "kloyce") return false;
    return true;
}

function normalizeDictationTs(ts: number | string): number | null {
    if (typeof ts === "number") return Number.isFinite(ts) ? ts : null;
    const parsed = Date.parse(ts);
    return Number.isFinite(parsed) ? parsed : null;
}

http.route({
    path: "/dictation",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
        const authError = checkBearerSecret(request);
        if (authError) return authError;

        const body = await readJsonBody(request);
        if (body === INVALID_JSON) {
            return new Response("Invalid JSON body", { status: 400 });
        }
        if (!isDictationBody(body)) {
            return new Response('Body must be { "host": string, "ts": number|string, "words": number, "source": "kloyce" }', { status: 400 });
        }
        const ts = normalizeDictationTs(body.ts);
        if (ts === null) {
            return new Response("ts must be unix ms or an ISO date string", { status: 400 });
        }

        const result = await ctx.runMutation(internal.dictation.ingestDictationEvent, {
            host: body.host,
            ts,
            words: body.words,
            source: body.source,
        });

        return new Response(JSON.stringify(result), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
    }),
});

// Mirrors convex/sshSessions.ts's ingestSessionEvent args validator.
interface SessionEventBody {
    sourceId: string;
    kind: "ssh-start" | "ssh-end";
    actor: string;
    agentName?: string;
    originHost: string;
    targetHost: string;
    targetHostAlias?: string;
    remoteUser?: string;
    startedAt: number;
    endedAt?: number;
    durationMs?: number;
    exitCode?: number;
    sessionId: string;
    model?: string;
    provider?: string;
    inputTokens?: number;
    outputTokens?: number;
    estimatedCostUsd?: number;
}

function isSessionEventBody(body: unknown): body is SessionEventBody {
    if (typeof body !== "object" || body === null) return false;
    if (!("sourceId" in body) || typeof body.sourceId !== "string") return false;
    if (!("kind" in body) || (body.kind !== "ssh-start" && body.kind !== "ssh-end"))
        return false;
    if (!("actor" in body) || typeof body.actor !== "string") return false;
    if (!("originHost" in body) || typeof body.originHost !== "string") return false;
    if (!("targetHost" in body) || typeof body.targetHost !== "string") return false;
    if (!("startedAt" in body) || typeof body.startedAt !== "number") return false;
    if (!("sessionId" in body) || typeof body.sessionId !== "string") return false;
    return true;
}

http.route({
    path: "/session-event",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
        const authError = checkBearerSecret(request);
        if (authError) return authError;

        const body = nullsToUndefined(await readJsonBody(request));
        if (body === INVALID_JSON) {
            return new Response("Invalid JSON body", { status: 400 });
        }
        if (!isSessionEventBody(body)) {
            return new Response("Malformed session event body", { status: 400 });
        }

        const result = await ctx.runMutation(
            internal.sshSessions.ingestSessionEvent,
            body,
        );

        return new Response(JSON.stringify(result), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
    }),
});

// Mirrors convex/timer.ts's start args validator. "toggle" has no direct
// Convex-function counterpart -- it is resolved here by reading current
// running state first, then dispatching to start or pause.
interface TimerActionBody {
    action: "start" | "pause" | "toggle" | "reset";
    durationMs?: number;
}

function isTimerActionBody(body: unknown): body is TimerActionBody {
    if (typeof body !== "object" || body === null) return false;
    if (
        !("action" in body) ||
        (body.action !== "start" &&
            body.action !== "pause" &&
            body.action !== "toggle" &&
            body.action !== "reset")
    )
        return false;
    if (
        "durationMs" in body &&
        body.durationMs !== undefined &&
        typeof body.durationMs !== "number"
    )
        return false;
    return true;
}

http.route({
    path: "/timer",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
        const authError = checkBearerSecret(request);
        if (authError) return authError;

        const body = nullsToUndefined(await readJsonBody(request));
        if (body === INVALID_JSON) {
            return new Response("Invalid JSON body", { status: 400 });
        }
        if (!isTimerActionBody(body)) {
            return new Response(
                'Body must be { "action": "start"|"pause"|"toggle"|"reset", "durationMs"?: number }',
                { status: 400 },
            );
        }

        let result;
        if (body.action === "start") {
            result = await ctx.runMutation(api.timer.start, { durationMs: body.durationMs });
        } else if (body.action === "pause") {
            result = await ctx.runMutation(api.timer.pause, {});
        } else if (body.action === "reset") {
            result = await ctx.runMutation(api.timer.reset, {});
        } else {
            const current = await ctx.runQuery(api.timer.get, {});
            result = current.running
                ? await ctx.runMutation(api.timer.pause, {})
                : await ctx.runMutation(api.timer.start, { durationMs: body.durationMs });
        }

        return new Response(JSON.stringify(result), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
    }),
});

// Mirrors convex/actorOverride.ts's set args validator.
interface ActorOverrideBody {
    deviceName: string;
    active: boolean;
    actor?: string;
}

function isActorOverrideBody(body: unknown): body is ActorOverrideBody {
    if (typeof body !== "object" || body === null) return false;
    if (!("deviceName" in body) || typeof body.deviceName !== "string") return false;
    if (!("active" in body) || typeof body.active !== "boolean") return false;
    return true;
}

http.route({
    path: "/actor-override",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
        const authError = checkBearerSecret(request);
        if (authError) return authError;

        const body = nullsToUndefined(await readJsonBody(request));
        if (body === INVALID_JSON) {
            return new Response("Invalid JSON body", { status: 400 });
        }
        if (!isActorOverrideBody(body)) {
            return new Response(
                'Body must be { "deviceName": string, "active": boolean, "actor"?: string }',
                { status: 400 },
            );
        }

        const result = await ctx.runMutation(api.actorOverride.set, body);

        return new Response(JSON.stringify(result), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
    }),
});

http.route({ path: "/statusline", method: "GET", handler: statuslineHttpHandler });

export default http;
