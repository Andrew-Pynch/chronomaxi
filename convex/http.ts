import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

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

export default http;
