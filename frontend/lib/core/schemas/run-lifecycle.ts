/**
 * Splits a parsed run into `completed` — the only variant that owns `results`
 * — and everything else, which has no `results` property at all. Reading
 * `run.results` without first narrowing on `run.status === "completed"` is
 * therefore a compile error, not a silent render of a failed run as a
 * successful one.
 *
 * The wire format is parsed permissively rather than rejected. Both backends
 * write `status` and `results` in a single UPDATE, but a row persisted before
 * that guarantee could still be `completed` with no results, and failing the
 * parse would break the page instead of degrading it. Such a run is reported
 * as `failed`, which is what it is: it finished without producing a result.
 *
 * The status and results fields are destructured out rather than left to the
 * rest spread. If a variant inherited the wire `status`, its discriminant
 * would be an intersection with the full enum instead of a bare literal, and
 * TypeScript would not discriminate the union on it.
 */
type RunLifecycleSplit<TWire extends { status: string }, TResults> =
  | (Omit<TWire, "status" | "results"> & {
      status: "completed";
      results: TResults;
    })
  | (Omit<TWire, "status" | "results"> & {
      // "failed" is unioned in rather than merely excluded, because the
      // malformed-completion branch below manufactures it. Leaving it out
      // would make this `never` for a wire type whose only status is
      // "completed", and the cast at the end would then be a lie.
      status: Exclude<TWire["status"], "completed"> | "failed";
    });

/**
 * Split a parsed run into a union where only `completed` carries `results`.
 *
 * `status` must be destructured out alongside `results`: if the rest spread
 * retains it, each variant's discriminant becomes an intersection with the
 * full status enum and TypeScript refuses to discriminate on it.
 *
 * `TResults` is constrained against the wire's own `results` so a caller
 * cannot ask for a type the payload does not carry. `undefined` is spelled out
 * in that constraint because `exactOptionalPropertyTypes` reads a bare
 * `results?: T | null` as "absent, or present and non-undefined", which no
 * Zod `.nullable().optional()` field satisfies.
 */
export function splitRunOnLifecycle<
  TWire extends { status: string; results?: TResults | null | undefined },
  TResults,
>(run: TWire): RunLifecycleSplit<TWire, TResults> {
  const { results, status, ...common } = run;
  const split =
    status === "completed"
      ? results
        ? { ...common, status, results }
        : {
            ...common,
            status: "failed",
            // Both fields are replaced together. Overwriting only the code
            // would leave a legacy row's unrelated message describing a
            // different failure than the code names.
            error_code: "results_missing",
            error_message:
              "This run was stored as complete but carries no results.",
          }
      : { ...common, status };

  return split as RunLifecycleSplit<TWire, TResults>;
}
