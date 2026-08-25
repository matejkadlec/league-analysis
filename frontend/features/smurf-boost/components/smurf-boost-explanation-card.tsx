"use client";

import { ChevronRight, CircleHelp, MoveRight } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import {
  BAND_LABELS,
  DISCLAIMER,
  FAMILY_DESCRIPTIONS,
  FAMILY_TITLES,
} from "../smurf-boost-vocabulary";
import { cn } from "@/lib/core/utils";

/**
 * The always-visible explanation. The specification requires the disclaimer to
 * be plain and permanent, so it is never a tooltip and never collapsed, and the
 * readings wear the same colour ladder the result card uses.
 */

// The readings a comparison can produce, in escalation order, wearing the
// exact colours `smurf-boost-result-card.tsx` renders them in.
const READING_SCALE = [
  { band: "no_unusual_pattern", dot: "bg-emerald-500" },
  { band: "weak_indicators", dot: "bg-yellow-500" },
  { band: "notable_indicators", dot: "bg-amber-500" },
  { band: "strong_indicators", dot: "bg-rose-500" },
] as const;

function DotRow({ count, className }: { count: number; className: string }) {
  return (
    <div className="flex gap-1" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={cn("h-2.5 w-2.5 rounded-full", className)} />
      ))}
    </div>
  );
}

export function SmurfBoostExplanationCard() {
  return (
    <Card id="smurf-boost-explanation">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <CircleHelp className="h-5 w-5 text-primary" />
          What This Page Does
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* The whole idea in one glance: two windows of the same player's
            games, older set against newer set. */}
        {/* `muted-foreground` strokes, not the border token: these boxes sit
            on the card surface the token is tuned against, so the token
            itself all but disappears here. */}
        <div className="rounded-lg border border-muted-foreground/35 bg-muted/20 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-muted-foreground">
                Earlier ranked games
              </p>
              <DotRow count={8} className="bg-muted-foreground/40" />
            </div>
            {/* Points at the recent window: rightwards when the two windows
                sit side by side, downwards when they stack on a phone. */}
            <MoveRight
              className="h-5 w-5 shrink-0 rotate-90 text-primary sm:rotate-0"
              aria-hidden="true"
            />
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Recent ranked games</p>
              <DotRow count={5} className="bg-primary" />
            </div>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Always the same player&apos;s solo/duo history — never one player
            measured against another.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {(["rapid_improvement", "playing_pattern_change"] as const).map(
            (family) => (
              <div
                key={family}
                className="rounded-md border border-muted-foreground/35 bg-muted/20 p-3"
              >
                <h4 className="text-sm font-semibold">
                  {FAMILY_TITLES[family]}
                </h4>
                <p className="mt-1 text-sm leading-snug text-muted-foreground">
                  {FAMILY_DESCRIPTIONS[family]}
                </p>
              </div>
            ),
          )}
        </div>

        {/* Each area answers on this scale; the colours match the result
            card, so the reading is recognisable before it is read. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          {READING_SCALE.map(({ band, dot }, index) => (
            <span key={band} className="flex items-center gap-2">
              {/* Hidden on a phone: the scale wraps there, and a chevron
                  stranded at a line start points at nothing. */}
              {index > 0 && (
                <ChevronRight
                  className="hidden h-4 w-4 text-muted-foreground/50 sm:block"
                  aria-hidden="true"
                />
              )}
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <span
                  className={cn("h-2 w-2 rounded-full", dot)}
                  aria-hidden="true"
                />
                {BAND_LABELS[band]}
              </span>
            </span>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          Too few stored games reads as{" "}
          <span className="font-medium text-foreground">
            {BAND_LABELS.not_enough_data}
          </span>{" "}
          — an answer, not an error. Confidence is reported separately: how far
          the comparison can be relied on, never what it found.
        </p>

        {/* Permanent and plain per the specification -- never a tooltip,
            never collapsed -- so quiet means a muted footnote, not less. */}
        <p className="border-t border-border/40 pt-3 text-sm leading-snug text-muted-foreground">
          {DISCLAIMER}
        </p>
      </CardContent>
    </Card>
  );
}
