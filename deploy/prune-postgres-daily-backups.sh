#!/usr/bin/env bash
# Retain only the seven newest successful League Analysis daily archives.
set -Eeuo pipefail

if [[ $# -ne 1 ]]; then
  printf 'Usage: prune-postgres-daily-backups BACKUP_DIRECTORY\n' >&2
  exit 2
fi

backup_directory="$1"
retention_count=7

die() {
  printf 'League Analysis PostgreSQL retention refused: %s\n' "$1" >&2
  exit 1
}

[[ "$backup_directory" == /* && "$backup_directory" != "/" && \
  "$backup_directory" != "$HOME" ]] \
  || die 'backup directory must be a dedicated absolute subdirectory'
[[ -d "$backup_directory" && ! -L "$backup_directory" ]] \
  || die 'backup directory must be a regular non-symlink directory'

mapfile -t daily_archives < <(
  find "$backup_directory" -maxdepth 1 -type f \
    -regextype posix-extended \
    -regex '.*/league-analysis-postgres-daily-[0-9]{8}T[0-9]{6}[+-][0-9]{4}\.dump' \
    -printf '%f\n' | LC_ALL=C sort -r
)

if ((${#daily_archives[@]} <= retention_count)); then
  exit 0
fi

for basename in "${daily_archives[@]:retention_count}"; do
  [[ "$basename" =~ ^league-analysis-postgres-daily-[0-9]{8}T[0-9]{6}[+-][0-9]{4}\.dump$ ]] \
    || die 'find returned an unexpected archive name'
  archive="$backup_directory/$basename"
  [[ -f "$archive" && ! -L "$archive" ]] \
    || die "retention target changed before removal: $basename"
  rm -- "$archive"
  printf 'Expired daily PostgreSQL backup: %s\n' "$archive"
done
