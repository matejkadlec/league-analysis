/**
 * Only `completed` owns `results`, so reading it without narrowing on
 * `status` is a compile error.
 */
type RunLifecycleSplit<TWire extends { status: string }, TResults> =
  | (Omit<TWire, "status" | "results"> & {
      status: "completed";
      results: TResults;
    })
  | (Omit<TWire, "status" | "results"> & {
      // "failed" is unioned in, not merely excluded: without it a wire type
      // whose only status is "completed" narrows to `never`.
      status: Exclude<TWire["status"], "completed"> | "failed";
    });

/**
 * `status` must be destructured out, or each variant's discriminant becomes
 * an intersection with the full enum and stops discriminating.
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
            // Both replaced together: a legacy row's message would otherwise
            // describe a different failure than the code names.
            error_code: "results_missing",
            error_message:
              "This run was stored as complete but carries no results.",
          }
      : { ...common, status };

  return split as RunLifecycleSplit<TWire, TResults>;
}
