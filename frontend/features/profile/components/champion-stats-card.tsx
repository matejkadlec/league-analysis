"use client";

import { useState } from "react";
import { ChampionStatsResponse } from "@/lib/core/schemas";
import { getChampionDisplayName } from "@/lib/core/riot/data-dragon";
import { ChampionIcon } from "@/components/champion-icon";
import { useDDragonVersion } from "@/lib/core/riot/data-dragon-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { ProfileCardEmptyState } from "./profile-card-empty-state";
import { UpdatedStamp } from "@/components/updated-stamp";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Swords, ChevronLeft, ChevronRight } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PerformanceFigures } from "./performance-figures";
import {
  ChampionPaginationState,
  getChampionPage,
  pageForChampionDataSource,
} from "../champion-pagination";

interface ChampionStatsCardProps {
  dataSourceKey: string;
  stats: ChampionStatsResponse;
  lastUpdated?: string | null | undefined;
}

export function ChampionStatsCard({
  dataSourceKey,
  stats,
  lastUpdated,
}: ChampionStatsCardProps) {
  const ddragonVersion = useDDragonVersion();
  const [paginationState, setPaginationState] =
    useState<ChampionPaginationState>({ dataSourceKey, page: 0 });

  if (stats.champions.length === 0) {
    return (
      <ProfileCardEmptyState
        id="top-champions"
        icon={Swords}
        title="Top Champions"
        message="Not enough match data to analyze champion performance."
      />
    );
  }

  const requestedPage = pageForChampionDataSource(
    paginationState,
    dataSourceKey,
  );
  const championPage = getChampionPage(stats.champions, requestedPage);
  const isFirstPage = championPage.page === 0;
  const isLastPage = championPage.page === championPage.totalPages - 1;

  const setPage = (page: number) => {
    setPaginationState({ dataSourceKey, page });
  };

  return (
    <Card id="top-champions">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="flex items-center gap-2">
            <Swords className="h-5 w-5 text-primary" />
            Top Champions
          </CardTitle>
          <Badge variant="secondary" className="ml-auto text-right">
            Ranked by games played · {stats.champions.length} champions total
          </Badge>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          {lastUpdated ? <UpdatedStamp lastUpdated={lastUpdated} /> : <span />}
          <div className="ml-auto flex items-center gap-1">
            <Button
              aria-label="Previous champions"
              disabled={isFirstPage}
              onClick={() => setPage(championPage.page - 1)}
              size="icon"
              type="button"
              variant="ghost"
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <span aria-atomic="true" aria-live="polite" role="status">
              {championPage.startIndex + 1}–{championPage.endIndex} of{" "}
              {stats.champions.length}
            </span>
            <Button
              aria-label="Next champions"
              disabled={isLastPage}
              onClick={() => setPage(championPage.page + 1)}
              size="icon"
              type="button"
              variant="ghost"
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Ten rows in two ranked columns from `xl` (1-5, then 6-10). The
            height is reserved for a full page, so a short last page does not
            pull the cards below it upwards. `role` survives WebKit's reset. */}
        <ol
          role="list"
          aria-label="Top champions"
          className="grid min-h-[41.75rem] grid-cols-1 content-start gap-3 xl:min-h-[20.5rem] xl:grid-flow-col xl:grid-cols-2 xl:grid-rows-5 xl:gap-x-8"
        >
          {championPage.items.map((champ, index) => (
            <li
              key={champ.champion_name}
              className="flex min-w-0 items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
            >
              {/* Rank number */}
              <span className="text-sm font-medium text-muted-foreground w-4">
                {championPage.startIndex + index + 1}
              </span>

              {/* Champion icon */}
              <div className="relative h-10 w-10 rounded-full overflow-hidden border-2 border-primary/20">
                <ChampionIcon
                  championName={champ.champion_name}
                  ddragonVersion={ddragonVersion}
                  sizes="40px"
                />
              </div>

              {/* Champion name and games */}
              <div className="flex-1 min-w-0">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <p className="font-medium truncate cursor-default">
                        {getChampionDisplayName(champ.champion_name)}
                      </p>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{getChampionDisplayName(champ.champion_name)}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <p className="text-xs text-muted-foreground">
                  {champ.games_played} game{champ.games_played !== 1 ? "s" : ""}
                </p>
              </div>

              <PerformanceFigures stats={champ} />
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
