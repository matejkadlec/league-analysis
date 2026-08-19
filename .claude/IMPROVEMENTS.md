# Improvements

- 2026-08-19 backend/app/features/playstyle_analysis/: the whole feature is
  1,864 lines with no consumer. Its router is mounted at
  `/api/v1/playstyle-analysis` with two endpoints, but nothing in the frontend
  calls either one — the only frontend route named `/playstyle-analysis` is a
  server-side `redirect()` to player overview, and no background job writes a
  `PlaystyleAnalysis` row (`maintenance.py` only prunes the table). The
  evidence is a grep of `frontend/` for the path, of `backend/app` for the
  service outside its own package, and of `jobs/implementations/` for the
  model. That makes `evaluators.py` (760 lines, 396 statements, 8.6% covered)
  the largest untested file in the repository *and* unreachable from the
  product. Decide whether it is a planned feature or a leftover before anyone
  spends a test campaign on it; if it is planned, a ticket, and if not, a
  deletion of the package plus its router registration and its table.

- 2026-08-19 frontend/features/matchmaking/components/matchmaking-analysis-history.tsx:
  its private `formatDateTime` is a second copy of the exported one in
  `features/jobs/components/job-execution-format.ts` — same D.M.YYYY H:MM AM/PM
  format, same midnight and zero-padding fixes, character for character. Both
  are now tested, so the same behaviour is pinned twice and a fix to one would
  silently not reach the other. Deleting the local copy and importing the
  jobs-side export is the whole change; it was left alone because moving a
  helper across features is a structural call this loop did not come for.

- 2026-08-19 frontend/features/jobs/components/job-execution-format.ts:
  `apiCallKey` joins endpoint, region, param_key, and the first/last
  timestamp and param — but not `count`. Two API-call entries differing only
  in their count produce the same string, and it is used as a React `key`, so
  the second row would keep the first one's rendered numbers. The surrounding
  fields make that combination unlikely, which is why it was left alone;
  adding `call.count` to the join is the whole fix.

- 2026-08-19 frontend/components/ui/form.tsx: `FormControl` always points
  `aria-describedby` at `${formItemId}-form-item-description`, but
  `FormDescription` is exported and never used anywhere in the app, so that id
  never exists in the DOM. Either render a description or stop referencing one.
  The dangling half is ignored by assistive tech today, so this is tidiness,
  not a live defect.
- 2026-08-19 frontend/components/ui/form.tsx: the `if (!fieldContext) throw`
  in `useFormField` cannot fire — `FormFieldContext` is created with `{}` as
  its default, so the value is always truthy — and it sits *after*
  `getFieldState(fieldContext.name, …)` has already read through it. Vendored
  shadcn code with one consumer, so it was left alone; a guard on
  `fieldContext.name`, moved above that call, would make it mean something.
