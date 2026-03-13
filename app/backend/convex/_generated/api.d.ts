/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as contentPipeline from "../contentPipeline.js";
import type * as cronConfig from "../cronConfig.js";
import type * as crons from "../crons.js";
import type * as digestAction from "../digestAction.js";
import type * as digests from "../digests.js";
import type * as knowledgeEntries from "../knowledgeEntries.js";
import type * as knowledgePipeline from "../knowledgePipeline.js";
import type * as sources from "../sources.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  contentPipeline: typeof contentPipeline;
  cronConfig: typeof cronConfig;
  crons: typeof crons;
  digestAction: typeof digestAction;
  digests: typeof digests;
  knowledgeEntries: typeof knowledgeEntries;
  knowledgePipeline: typeof knowledgePipeline;
  sources: typeof sources;
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
