#!/usr/bin/env bash
# Retain bounded successful League Analysis daily and pre-deployment archives.
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

prune_family() {
  local family="$1"
  local find_regex="$2"
  local validation_regex="$3"
  local archive
  local basename
  local -a archives

  mapfile -t archives < <(
    find "$backup_directory" -maxdepth 1 -type f \
      -regextype posix-extended \
      -regex "$find_regex" \
      -printf '%f\n' | LC_ALL=C sort -r
  )
  ((${#archives[@]} > retention_count)) || return 0

  for basename in "${archives[@]:retention_count}"; do
    [[ "$basename" =~ $validation_regex ]] \
      || die 'find returned an unexpected archive name'
    archive="$backup_directory/$basename"
    [[ -f "$archive" && ! -L "$archive" ]] \
      || die "retention target changed before removal: $basename"
    rm -- "$archive"
    printf 'Expired %s PostgreSQL backup: %s\n' "$family" "$archive"
  done
}

prune_family \
  daily \
  '.*/league-analysis-postgres-daily-[0-9]{8}T[0-9]{6}[+-][0-9]{4}\.dump' \
  '^league-analysis-postgres-daily-[0-9]{8}T[0-9]{6}[+-][0-9]{4}\.dump$'
prune_family \
  pre-deployment \
  '.*/league-analysis-postgres-pre-deploy-[0-9]{8}T[0-9]{6}[+-][0-9]{4}-[0-9a-f]{12}\.dump' \
  '^league-analysis-postgres-pre-deploy-[0-9]{8}T[0-9]{6}[+-][0-9]{4}-[0-9a-f]{12}\.dump$'
