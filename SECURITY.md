# Security

Development is paused. There is no guaranteed response time or supported
production release. Do not use this portfolio project to host a public service
without reviewing its security, privacy, and Riot requirements.

Report vulnerabilities privately to **mat.kadlec@email.cz**. Describe the
problem and reproduction steps using invented data. Do not include passwords,
API keys, session tokens, database exports, or other people's personal data.
Do not publish an exploit or sensitive details in a public issue.

If a credential was committed, revoke or rotate it at its provider before
publication. Deleting a file or rewriting Git history does not revoke a key or
remove copies already downloaded. Keep local configuration, backups, and logs
outside Git. The repository's Gitleaks checks scan source and commit history;
they cannot establish whether an exposed credential is still valid.
