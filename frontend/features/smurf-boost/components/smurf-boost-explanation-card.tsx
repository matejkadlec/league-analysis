"use client";

import { CircleHelp } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { DISCLAIMER, FAMILY_TITLES } from "../smurf-boost-vocabulary";

/**
 * The always-visible explanation. The specification requires the disclaimer to
 * be plain and permanent, so it is never a tooltip and never collapsed.
 */
export function SmurfBoostExplanationCard() {
  return (
    <Card id="smurf-boost-explanation">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CircleHelp className="h-5 w-5 text-primary" />
          What This Page Does
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm leading-relaxed">
          This page compares a player&apos;s most recent ranked solo/duo games
          against that same player&apos;s earlier ranked solo/duo games. It
          never compares one player against another.
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-md border border-border/60 p-3">
            <h4 className="text-sm font-semibold">
              {FAMILY_TITLES.rapid_improvement}
            </h4>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Whether the recent games look stronger than the earlier ones, in
              performance, win rate, results on rarely played champions, and
              strong play on a very new account.
            </p>
          </div>
          <div className="rounded-md border border-border/60 p-3">
            <h4 className="text-sm font-semibold">
              {FAMILY_TITLES.playing_pattern_change}
            </h4>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Whether the recent games look different in shape: wins and losses
              that no longer track performance, a change in consistency, strong
              and weak games sitting side by side, or a sustained drop after a
              high win rate.
            </p>
          </div>
        </div>

        <p className="text-sm leading-relaxed">
          Each of the two areas above gets its own reading, from{" "}
          <span className="font-medium">No unusual pattern</span> through{" "}
          <span className="font-medium">Weak</span>,{" "}
          <span className="font-medium">Notable</span> and{" "}
          <span className="font-medium">Strong indicators</span>. When there are
          too few stored games to compare, the reading is{" "}
          <span className="font-medium">Not enough data</span>, which is an
          answer rather than an error. Confidence is reported separately, and
          describes how much the comparison can be relied on rather than what it
          found.
        </p>

        <div className="rounded-md border-l-2 border-l-[#cfa93a] bg-muted/40 p-3">
          <p className="text-sm leading-relaxed">{DISCLAIMER}</p>
        </div>
      </CardContent>
    </Card>
  );
}
