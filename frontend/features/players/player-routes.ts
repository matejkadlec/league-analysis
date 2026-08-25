const PLAYER_OVERVIEW_PATH = "/player-overview";
const MATCH_HISTORY_PATH = "/match-history";

// The routes whose `?puuid=` *is* the account's current player, so a link
// between them carries the selection along. `/rank-manipulation` and
// `/matchmaking-analysis` are absent: their `?puuid=` names a page-local
// analysis target, not a promotion to the account's player.
const PLAYER_CENTRIC_PATHS = new Set([
  PLAYER_OVERVIEW_PATH,
  MATCH_HISTORY_PATH,
]);

export function isPlayerCentricPath(pathname: string): boolean {
  return PLAYER_CENTRIC_PATHS.has(pathname);
}

export function playerRoute(
  pathname: string,
  searchParams: URLSearchParams,
  puuid: string,
): string {
  const targetPath = isPlayerCentricPath(pathname)
    ? pathname
    : PLAYER_OVERVIEW_PATH;
  const nextParams = new URLSearchParams(searchParams);
  nextParams.set("puuid", puuid);
  return `${targetPath}?${nextParams.toString()}`;
}

export function playerNavigationRoute(
  pathname: string,
  puuid?: string | null,
): string {
  return isPlayerCentricPath(pathname) && puuid
    ? `${pathname}?puuid=${encodeURIComponent(puuid)}`
    : pathname;
}
