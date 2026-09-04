// Module-private: the page size is observable through `getChampionPage`,
// which is what the tests assert against.
const CHAMPIONS_PER_PAGE = 5;

export interface ChampionPaginationState {
  dataSourceKey: string;
  page: number;
}

export interface ChampionPage<T> {
  endIndex: number;
  items: readonly T[];
  page: number;
  startIndex: number;
  totalPages: number;
}

export function getChampionPage<T>(
  champions: readonly T[],
  requestedPage: number,
): ChampionPage<T> {
  const totalPages = Math.ceil(champions.length / CHAMPIONS_PER_PAGE);
  const page =
    totalPages === 0
      ? 0
      : Math.min(Math.max(requestedPage, 0), totalPages - 1);
  const startIndex = page * CHAMPIONS_PER_PAGE;
  const endIndex = Math.min(startIndex + CHAMPIONS_PER_PAGE, champions.length);

  return {
    endIndex,
    items: champions.slice(startIndex, endIndex),
    page,
    startIndex,
    totalPages,
  };
}

export function pageForChampionDataSource(
  state: ChampionPaginationState,
  dataSourceKey: string,
): number {
  return state.dataSourceKey === dataSourceKey ? state.page : 0;
}
