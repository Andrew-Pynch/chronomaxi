/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as actorOverride from "../actorOverride.js";
import type * as dashboard from "../dashboard.js";
import type * as deviceAliases from "../deviceAliases.js";
import type * as dictation from "../dictation.js";
import type * as http from "../http.js";
import type * as lib_aggregation from "../lib/aggregation.js";
import type * as lib_deviceAlias from "../lib/deviceAlias.js";
import type * as lib_spanIngest from "../lib/spanIngest.js";
import type * as migration from "../migration.js";
import type * as rebuild from "../rebuild.js";
import type * as spans from "../spans.js";
import type * as sshSessions from "../sshSessions.js";
import type * as timer from "../timer.js";
import type * as statusline from "../statusline.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  actorOverride: typeof actorOverride;
  dashboard: typeof dashboard;
  deviceAliases: typeof deviceAliases;
  dictation: typeof dictation;
  http: typeof http;
  "lib/aggregation": typeof lib_aggregation;
  "lib/deviceAlias": typeof lib_deviceAlias;
  "lib/spanIngest": typeof lib_spanIngest;
  migration: typeof migration;
  rebuild: typeof rebuild;
  spans: typeof spans;
  sshSessions: typeof sshSessions;
  timer: typeof timer;
  statusline: typeof statusline;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
