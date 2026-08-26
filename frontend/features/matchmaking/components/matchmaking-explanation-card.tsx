"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, GitBranch } from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/core/utils";

export function MatchmakingExplanationCard() {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-primary" />
            Calculation Flowchart
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="hidden button-medium no-rotation"
          >
            {isExpanded ? "Collapse" : "Expand"}
            <ChevronDown
              className={cn(
                "ml-2 h-4 w-4 transition-transform duration-300",
                isExpanded ? "rotate-180" : "rotate-0",
              )}
            />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-2 pb-4">
        <p className="text-sm text-muted-foreground mb-3">
          A visual representation of how the matchmaking analysis is being
          calculated, step-by-step. Two notes on the newer figures: DuoQ games
          are inferred from a teammate recurring across the analyzed matches
          (Riot does not expose party data), and player ranks come from the
          nearest stored rank snapshot — for backdated runs, ranks without a
          snapshot near that period fall back to current-day rank, which the
          result labels honestly. Averages over ten or more matches trim the
          most extreme tenth of matches from each end before averaging, and the
          Recent Form figures read each player&apos;s KDA, kill participation
          and damage share over the same recent matches the win rates use.
        </p>

        <div
          className={cn(
            "grid transition-all duration-500 ease-in-out",
            isExpanded
              ? "grid-rows-[1fr] opacity-100"
              : "grid-rows-[0fr] opacity-0",
          )}
        >
          <div className="overflow-hidden">
            <div className="p-2">
              <Image
                src="/matchmaking_analysis.png"
                alt="Matchmaking Analysis Calculation Explanation"
                width={1920}
                height={1080}
                className={cn(
                  "w-full h-auto transition-opacity duration-500",
                  isExpanded ? "opacity-100" : "opacity-0",
                )}
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
