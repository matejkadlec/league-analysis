/**
 * Splits a parsed run so only `completed` owns `results`: reading
 * `run.results` without narrowing on `status` is a compile error rather than a
 * failed run rendered as a successful one. A `completed` row with no results
 * degrades to `failed` rather than failing the parse.
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
 * `status` must be destructured out, or each variant's discriminant becomes an
 * intersection with the full enum and TypeScript refuses to discriminate on
 * it.
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
