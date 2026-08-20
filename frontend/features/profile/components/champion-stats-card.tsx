"use client";

import Image from "next/image";
import { useState } from "react";
import { ChampionStatsResponse } from "@/lib/core/schemas";
import {
  getChampionIconUrl,
  getChampionDisplayName,
} from "@/lib/core/data-dragon";
import { useDDragonVersion } from "@/lib/core/data-dragon-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { ProfileCardEmptyState } from "./profile-card-empty-state";
import { UpdatedStamp } from "./updated-stamp";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Swords, ChevronLeft, ChevronRight } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  formatFractionAsPercent,
  formatKDA,
  kdaColor,
  winRateColors,
} from "@/lib/core/format";
import {
  ChampionPaginationState,
  getChampionPage,
  pageForChampionDataSource,
} from "../utils/champion-pagination";

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

  if (!stats.champions || stats.champions.length === 0) {
    return (
      <ProfileCardEmptyState
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
        <div className="min-h-[20.5rem] space-y-3">
          {championPage.items.map((champ, index) => (
            <div
              key={champ.champion_name}
              className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
            >
              {/* Rank number */}
              <span className="text-sm font-medium text-muted-foreground w-4">
                {championPage.startIndex + index + 1}
              </span>

              {/* Champion icon */}
              <div className="relative h-10 w-10 rounded-full overflow-hidden border-2 border-primary/20">
                <Image
                  src={getChampionIconUrl(champ.champion_name, ddragonVersion)}
                  alt={getChampionDisplayName(champ.champion_name)}
                  fill
                  className="object-cover"
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

              {/* KDA */}
              <div className="text-right">
                <p className="text-sm font-medium">
                  {champ.avg_kills.toFixed(1)} / {champ.avg_deaths.toFixed(1)} /{" "}
                  {champ.avg_assists.toFixed(1)}
                </p>
                <p className="text-xs">
                  <span className={kdaColor(champ.avg_kda)}>
                    {formatKDA(champ.avg_kda)}
                  </span>{" "}
                  <span className="text-muted-foreground">KDA</span>
                </p>
              </div>

              {/* Win rate */}
              <div className="text-right w-16">
                <p
                  className={`text-sm font-bold ${winRateColors(champ.win_rate).text}`}
                >
                  {formatFractionAsPercent(champ.win_rate)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {champ.wins}W {champ.losses}L
                </p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
