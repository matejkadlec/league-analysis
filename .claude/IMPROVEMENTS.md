# Improvements

- 2026-08-19 deploy/container-qa.sh: two gate runs on the self-hosted runner
  cannot coexist. The script hard-defaults to ports 18097/18098 and aborts with
  "Container QA port 18097 is already in use", while `quality-checks.yml`
  scopes concurrency per pull request (`quality-checks-${{ pr.number || ref }}`),
  so any two open PRs race. Observed killing a green run on PR #93. Either give
  the workflow a runner-wide concurrency group for this step, or derive
  `LGA_CONTAINER_QA_*_PORT` from `github.run_id` — the overrides already exist.

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
