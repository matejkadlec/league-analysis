"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, GitBranch } from "lucide-react";
import Image from "next/image";

export function MatchmakingExplanationCard() {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-primary" />
            Calculation Flowchart
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="hidden button-medium no-rotation"
          >
            {isExpanded ? "Collapse" : "Expand"}
            <ChevronDown
              className={`ml-2 h-4 w-4 transition-transform duration-300 ${
                isExpanded ? "rotate-180" : "rotate-0"
              }`}
            />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-2 pb-4">
        <p className="text-sm text-muted-foreground mb-3">
          A visual representation of how the matchmaking analysis is being
          calculated, step-by-step.
        </p>

        <div
          className={`grid transition-all duration-500 ease-in-out ${
            isExpanded
              ? "grid-rows-[1fr] opacity-100"
              : "grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="overflow-hidden">
            <div className="p-2">
              <Image
                src="/matchmaking_analysis.png"
                alt="Matchmaking Analysis Calculation Explanation"
                width={1920}
                height={1080}
                className={`w-full h-auto transition-opacity duration-500 ${
                  isExpanded ? "opacity-100" : "opacity-0"
                }`}
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
