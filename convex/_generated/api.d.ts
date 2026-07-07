/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentApi from "../agentApi.js";
import type * as domain_agentApi from "../domain/agentApi.js";
import type * as domain_finalization from "../domain/finalization.js";
import type * as domain_identity from "../domain/identity.js";
import type * as domain_model from "../domain/model.js";
import type * as domain_rateLimit from "../domain/rateLimit.js";
import type * as domain_results from "../domain/results.js";
import type * as domain_retention from "../domain/retention.js";
import type * as domain_tokens from "../domain/tokens.js";
import type * as domain_validators from "../domain/validators.js";
import type * as maintenance from "../maintenance.js";
import type * as meetings from "../meetings.js";
import type * as rateLimit from "../rateLimit.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentApi: typeof agentApi;
  "domain/agentApi": typeof domain_agentApi;
  "domain/finalization": typeof domain_finalization;
  "domain/identity": typeof domain_identity;
  "domain/model": typeof domain_model;
  "domain/rateLimit": typeof domain_rateLimit;
  "domain/results": typeof domain_results;
  "domain/retention": typeof domain_retention;
  "domain/tokens": typeof domain_tokens;
  "domain/validators": typeof domain_validators;
  maintenance: typeof maintenance;
  meetings: typeof meetings;
  rateLimit: typeof rateLimit;
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
