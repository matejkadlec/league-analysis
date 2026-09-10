# Public Source Release

League Analysis is a paused portfolio project for local exploration. Source
visibility is not Riot approval, an open-source license, or a security
certification.

## Riot policy review — 2026-09-10

Read Riot's [general policies](https://developer.riotgames.com/policies/general),
[League of Legends policies](https://developer.riotgames.com/docs/lol),
[key-use rules](https://developer.riotgames.com/docs/portal), and
[API terms](https://support-developer.riotgames.com/hc/en-us/articles/22698917218323-API-Terms-and-Conditions).

Use your own credentials for permitted private experimentation. Never share an
API key, Riot account, or populated database with the source. Keys are entered
through administrator Settings and sent to Riot over HTTPS. Preserve the
existing application, method, service, and Retry-After rate-limit handling.

Keep the non-endorsement notice in the README and the app's License page. Riot
artwork, data, and trademarks are governed by Riot's terms, not this project's
LICENSE.

The experimental analysis describes patterns in completed games and visible
ranks. It does not reveal hidden MMR or establish smurfing, boosting, cheating,
or account sharing. Do not turn it into an alternative skill-ranking system,
a way to reveal hidden players, or an unfair in-game advantage. Custom-match
history needs Riot's required opt-in/RSO handling before it may be shared;
collection must remain within the supported public queues.

A public source repository does not authorize offering a public application.
Riot registration and the appropriate approval/key are separate requirements
for such use. No Riot approval is claimed by this project.

## Repository hygiene

- Keep `.env`, database exports, logs, local agent state, and personal working
  notes outside Git. The committed environment example contains placeholders.
- Review every branch and tag intended for public visibility, plus attachments,
  issues, pull requests, releases, and Actions artifacts.
- Revoke any exposed credential before it can be used elsewhere. A secret scan
  detects patterns, not whether a password or token remains valid.
- Keep the existing All Rights Reserved license unless the copyright holders
  authorize different terms. Current maintainer metadata does not rewrite
  historical authorship or ownership of contributions.

The documented QA fixture passwords are deliberately local-only. Do not reuse
them for another account or a network-accessible installation. Each reader
should create their own account and fresh local database using the README.

## History

History is preserved. Removing files from the current revision does not erase
older copies or contributor attribution. If selected historic contents must be
removed, prepare a filtered mirror, inspect every rewritten branch/tag, and
coordinate replacement of published refs and existing clones. A fresh public
repository containing only the reviewed source snapshot is another option.
Neither option revokes credentials or erases downloaded copies.
