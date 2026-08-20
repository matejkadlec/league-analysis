# Playstyle analysis (app/features/playstyle_analysis/)

- The package has no consumer and that is deliberate. Its router is mounted at
  `/api/v1/playstyle-analysis`, but no frontend route calls either endpoint
  (`/playstyle-analysis` is a server-side `redirect()` to player overview) and
  no job writes a `PlaystyleAnalysis` row — `maintenance.py` only prunes the
  table. Reviewed 2026-08-20 and kept as-is: it is parked, not abandoned.
- So do not "clean it up". Deleting it, its router registration or its table
  is a product decision that has already been made the other way. Equally, do
  not spend a test campaign on it — `evaluators.py` being the least-covered
  file in the repository is a known consequence of it having no callers.
