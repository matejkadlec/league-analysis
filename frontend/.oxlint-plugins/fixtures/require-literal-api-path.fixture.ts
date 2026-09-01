// Fixture for `house/require-literal-api-path`: directives mark MUST-flag shapes,
// none on accepts -- so a stale selector orphans a directive, an over-broad one flags an accept.

declare const Schema: unknown;
declare const client: {
  validatedDelete: (schema: unknown, url: string) => Promise<unknown>;
};
declare const validatedGet: (
  schema: unknown,
  url: string,
  options?: unknown,
) => Promise<unknown>;
declare const validatedPost: (
  schema: unknown,
  url: string,
  body?: unknown,
  options?: unknown,
) => Promise<unknown>;
declare const validatedPut: typeof validatedPost;
declare const validatedPatch: typeof validatedPost;
declare const jobId: string;
declare const puuid: string;
declare const force: boolean;

const JOBS_PAUSE_PATH = "/jobs/pause";
const jobPath = (id: string) => `/jobs/${id}/stop`;

// MUST flag: the hoisted constant. Both scanners walk straight past this call,
// and the route it asks for stops being checked with no failure anywhere.
export const hoisted = () =>
  // oxlint-disable-next-line house/require-literal-api-path
  validatedPost(Schema, JOBS_PAUSE_PATH);

// MUST flag: the path threaded through a helper, which is the same loss
// wearing a decomposition's clothes.
export const viaHelper = () =>
  // oxlint-disable-next-line house/require-literal-api-path
  validatedPost(Schema, jobPath(jobId), undefined, { params: { force } });

// MUST flag: concatenation. The scanners read the opening quote and stop at
// `/jobs/`, so this one goes wrong by matching a route that does not exist.
export const concatenated = () =>
  // oxlint-disable-next-line house/require-literal-api-path
  validatedGet(Schema, "/jobs/" + jobId);

// MUST flag: a cast in front of the literal is as unreadable to a regex
// starting at the comma as a bare identifier is.
export const cast = () =>
  // oxlint-disable-next-line house/require-literal-api-path
  validatedPut(Schema, JOBS_PAUSE_PATH as string, { paused: true });

// MUST flag: reached through an object, which an identifier-only check walks
// past even though both scanners match the helper name there.
export const viaMember = () =>
  // oxlint-disable-next-line house/require-literal-api-path
  client.validatedDelete(Schema, JOBS_PAUSE_PATH);

// MUST flag: no path argument at all, which reads as a call the scanners find
// and then cannot follow.
export const noPath = () =>
  // oxlint-disable-next-line house/require-literal-api-path
  validatedPatch(Schema);

// Accepted -- a plain literal with an options bag, the shape of most requests.
export const literal = () =>
  validatedGet(Schema, "/players/suggestions", { params: { limit: 5 } });

// Accepted -- interpolation, which both scanners erase to a path parameter.
export const interpolated = () =>
  validatedGet(Schema, `/players/${puuid}/league`);

// Accepted -- an interpolated query, which the scanners cut at the `?`.
export const interpolatedQuery = () =>
  validatedPost(Schema, `/jobs/${jobId}/stop${force ? "?force=true" : ""}`);

// Accepted -- a longer name the scanners' `validated<Method>(` regex does not
// match either, so nothing is lost by hoisting its argument.
export const unrelatedHelper = () => {
  const validatedGetSetting = (schema: unknown, url: string) => [schema, url];
  return validatedGetSetting(Schema, JOBS_PAUSE_PATH);
};

// Accepted -- not a call at all.
export const passedAlong = () => [validatedGet, validatedPost];
