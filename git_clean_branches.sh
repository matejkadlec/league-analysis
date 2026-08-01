#!/usr/bin/env bash
# Remove local branches safely after they are merged into origin/master.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

TARGET_REMOTE="origin"
TARGET_BRANCH="master"
TARGET_REF="$TARGET_REMOTE/$TARGET_BRANCH"
CLOSED_PRS_MODE=false
ASSUME_YES=false

usage() {
  cat <<'EOF'
Usage: ./git_clean_branches.sh [--closed-prs] [--yes]

Without options, safely remove local branches and attached clean worktrees that
are already merged into origin/master.

  --closed-prs  Also consider local branches for closed, unmerged pull requests.
                Each candidate must have no remote branch, match the pull
                request head exactly, and have a clean attached worktree.
  --yes         Confirm closed pull request deletion non-interactively. This is
                valid only together with --closed-prs.
EOF
}

print_header() {
  echo -e "${BLUE}============================================${NC}"
  echo -e "${BLUE}$1${NC}"
  echo -e "${BLUE}============================================${NC}"
}

print_error() {
  echo -e "${RED}ERROR: $1${NC}"
}

print_info() {
  echo -e "${YELLOW}$1${NC}"
}

print_success() {
  echo -e "${GREEN}$1${NC}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --closed-prs)
      CLOSED_PRS_MODE=true
      ;;
    --yes)
      ASSUME_YES=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      print_error "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
  shift
done

if [[ "$ASSUME_YES" == true && "$CLOSED_PRS_MODE" != true ]]; then
  print_error "--yes is only valid together with --closed-prs."
  usage
  exit 1
fi

cd "$SCRIPT_DIR"

print_header "Git Branch Cleanup"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  print_error "This script must be run inside a Git repository."
  exit 1
fi

if ! git remote get-url "$TARGET_REMOTE" >/dev/null 2>&1; then
  print_error "Remote '$TARGET_REMOTE' does not exist."
  exit 1
fi

print_info "Fetching and pruning deleted remote branches from $TARGET_REMOTE..."
git fetch --prune "$TARGET_REMOTE"

if ! git rev-parse --verify --quiet "$TARGET_REF" >/dev/null; then
  print_error "Target ref '$TARGET_REF' does not exist after fetch."
  exit 1
fi

current_branch="$(git branch --show-current)"
if [[ -z "$current_branch" ]]; then
  print_error "Detached HEAD detected. Check out a branch before running cleanup."
  exit 1
fi

worktree_path_for_branch() {
  local branch_ref="refs/heads/$1"
  local line
  local worktree_path=""

  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      "worktree "*)
        worktree_path="${line#worktree }"
        ;;
      "branch "*)
        if [[ "${line#branch }" == "$branch_ref" ]]; then
          printf '%s\n' "$worktree_path"
          return 0
        fi
        ;;
    esac
  done < <(git worktree list --porcelain)

  return 1
}

worktree_is_clean() {
  local worktree_path="$1"
  local status_output

  if ! status_output="$(git -C "$worktree_path" status --porcelain=v1 --untracked-files=all 2>/dev/null)"; then
    return 1
  fi

  [[ -z "$status_output" ]]
}

is_protected_closed_pr_branch() {
  local branch="$1"
  [[ "$branch" == "$current_branch" || "$branch" == "$TARGET_BRANCH" || "$branch" == recovery/* ]]
}

deleted_count=0
skipped_count=0

echo ""
print_info "Checking local branches merged into $TARGET_REF..."

while IFS= read -r branch; do
  if [[ "$branch" == "$current_branch" || "$branch" == "$TARGET_BRANCH" ]]; then
    echo -e "${BLUE}Keeping:${NC} $branch"
    skipped_count=$((skipped_count + 1))
    continue
  fi

  if git merge-base --is-ancestor "$branch" "$TARGET_REF"; then
    if worktree_path="$(worktree_path_for_branch "$branch")"; then
      echo -e "${GREEN}Removing worktree:${NC} $worktree_path"
      if ! git worktree remove "$worktree_path"; then
        print_error "Could not remove worktree for $branch; keeping the branch. Resolve any uncommitted changes or worktree lock, then retry."
        skipped_count=$((skipped_count + 1))
        continue
      fi
    fi

    echo -e "${GREEN}Deleting:${NC} $branch"
    git branch -D -- "$branch" >/dev/null
    deleted_count=$((deleted_count + 1))
  else
    echo -e "${YELLOW}Keeping unmerged:${NC} $branch"
    skipped_count=$((skipped_count + 1))
  fi
done < <(git for-each-ref --format='%(refname:short)' refs/heads)

closed_candidate_branches=()
closed_candidate_pr_numbers=()
closed_candidate_worktrees=()

consider_closed_pr_branch() {
  local branch="$1"
  local branch_head
  local remote_output
  local pr_output
  local pr_number
  local pr_merged_at
  local pr_head_name
  local pr_head_oid
  local _pr_url
  local worktree_path=""
  local -a pr_rows=()

  if is_protected_closed_pr_branch "$branch"; then
    echo -e "${BLUE}Keeping protected branch:${NC} $branch"
    return
  fi

  if ! remote_output="$(git ls-remote --heads "$TARGET_REMOTE" "refs/heads/$branch" 2>&1)"; then
    print_error "Keeping $branch because its remote branch state could not be verified."
    return
  fi

  if [[ -n "$remote_output" ]]; then
    echo -e "${YELLOW}Keeping remote branch:${NC} $branch"
    return
  fi

  if ! command -v gh >/dev/null 2>&1; then
    print_error "Keeping $branch because GitHub CLI metadata is unavailable."
    return
  fi

  if ! pr_output="$(gh pr list --state closed --head "$branch" --json number,mergedAt,headRefName,headRefOid,url --jq '.[] | [.number, (.mergedAt // "UNMERGED"), .headRefName, .headRefOid, .url] | join("|")' 2>/dev/null)"; then
    print_error "Keeping $branch because GitHub pull request metadata could not be established safely."
    return
  fi

  if [[ -z "$pr_output" ]]; then
    echo -e "${YELLOW}Keeping without a matching closed pull request:${NC} $branch"
    return
  fi

  mapfile -t pr_rows < <(printf '%s\n' "$pr_output")
  if [[ ${#pr_rows[@]} -ne 1 ]]; then
    print_error "Keeping $branch because GitHub returned ambiguous closed pull request metadata."
    return
  fi

  IFS='|' read -r pr_number pr_merged_at pr_head_name pr_head_oid _pr_url <<< "${pr_rows[0]}"
  if [[ "$pr_merged_at" != "UNMERGED" || "$pr_head_name" != "$branch" || -z "$pr_head_oid" ]]; then
    print_error "Keeping $branch because its pull request is not unambiguously closed and unmerged."
    return
  fi

  branch_head="$(git rev-parse "$branch")"
  if [[ "$branch_head" != "$pr_head_oid" ]]; then
    print_error "Keeping $branch because local HEAD differs from closed PR #$pr_number."
    return
  fi

  if worktree_path="$(worktree_path_for_branch "$branch")"; then
    if ! worktree_is_clean "$worktree_path"; then
      print_error "Keeping $branch because its worktree is dirty or could not be inspected: $worktree_path"
      return
    fi
  fi

  closed_candidate_branches+=("$branch")
  closed_candidate_pr_numbers+=("$pr_number")
  closed_candidate_worktrees+=("$worktree_path")
  echo -e "${GREEN}Closed PR candidate:${NC} $branch (PR #$pr_number, closed and unmerged)"
}

remove_closed_pr_candidate() {
  local branch="$1"
  local pr_number="$2"
  local worktree_path="$3"

  if is_protected_closed_pr_branch "$branch"; then
    print_error "Keeping $branch because it became protected during cleanup."
    return
  fi

  if [[ -n "$worktree_path" ]]; then
    if ! worktree_is_clean "$worktree_path"; then
      print_error "Keeping $branch because its worktree changed after confirmation: $worktree_path"
      return
    fi

    echo -e "${GREEN}Removing closed PR worktree:${NC} $worktree_path"
    if ! git worktree remove "$worktree_path"; then
      print_error "Could not remove worktree for $branch; keeping the branch."
      return
    fi
  fi

  echo -e "${GREEN}Deleting closed PR branch:${NC} $branch (PR #$pr_number)"
  if git branch -D -- "$branch" >/dev/null; then
    closed_deleted_count=$((closed_deleted_count + 1))
  else
    print_error "Could not delete $branch after removing its worktree."
  fi
}

closed_deleted_count=0

if [[ "$CLOSED_PRS_MODE" == true ]]; then
  echo ""
  print_info "Checking local branches for closed, unmerged pull requests..."

  while IFS= read -r branch; do
    consider_closed_pr_branch "$branch"
  done < <(git for-each-ref --format='%(refname:short)' refs/heads)

  if [[ ${#closed_candidate_branches[@]} -gt 0 ]]; then
    if [[ "$ASSUME_YES" != true ]]; then
      read -r -p "Type DELETE to remove the ${#closed_candidate_branches[@]} closed pull request candidate(s): " confirmation || confirmation=""
      if [[ "$confirmation" != "DELETE" ]]; then
        print_info "Closed pull request cleanup cancelled; no candidates were removed."
      else
        ASSUME_YES=true
      fi
    fi

    if [[ "$ASSUME_YES" == true ]]; then
      for candidate_index in "${!closed_candidate_branches[@]}"; do
        remove_closed_pr_candidate \
          "${closed_candidate_branches[$candidate_index]}" \
          "${closed_candidate_pr_numbers[$candidate_index]}" \
          "${closed_candidate_worktrees[$candidate_index]}"
      done
    fi
  else
    print_info "No safe closed pull request candidates found."
  fi
fi

echo ""
print_header "Cleanup Complete"
print_success "Deleted merged local branches: $deleted_count"
if [[ "$CLOSED_PRS_MODE" == true ]]; then
  print_success "Deleted closed pull request branches: $closed_deleted_count"
fi
print_success "Kept local branches: $skipped_count"
print_success "Pruned deleted remote branch references from $TARGET_REMOTE"
