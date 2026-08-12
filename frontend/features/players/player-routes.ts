export const PLAYER_OVERVIEW_PATH = "/player-overview";
export const MATCH_HISTORY_PATH = "/match-history";

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

export function playerOverviewRoute(puuid?: string | null): string {
  return puuid
    ? `${PLAYER_OVERVIEW_PATH}?puuid=${encodeURIComponent(puuid)}`
    : PLAYER_OVERVIEW_PATH;
}

export function playerNavigationRoute(
  pathname: string,
  puuid?: string | null,
): string {
  return isPlayerCentricPath(pathname) && puuid
    ? `${pathname}?puuid=${encodeURIComponent(puuid)}`
    : pathname;
}
