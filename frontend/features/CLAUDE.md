# Features (features/)

- Pure helpers live at the feature root, beside `*-api.ts` and `*-query.ts`.
  `components/` holds components and the hooks serving them, nothing else.
  There is no `utils/` directory: the three-way split between the root,
  `utils/` and `components/` meant the answer to "where does this go" was
  whichever the last author picked.
- Pick the freshness timestamp matching the card's actual source
  (`profile_synced_at` / `league_synced_at` / `match_synced_at`); a card built
  from several sources shows the oldest of the timestamps it requires.
