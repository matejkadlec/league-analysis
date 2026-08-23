"use client";

import { CircleAlert, CircleHelp, Gauge, ShieldQuestion } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  SmurfBoostFamily,
  SmurfBoostResults,
  SmurfBoostSignal,
} from "@/lib/core/schemas";

import {
  BAND_LABELS,
  bandMeaning,
  CONFIDENCE_LABELS,
  familyDescription,
  familyTitle,
  noteLabel,
} from "../smurf-boost-vocabulary";

interface SmurfBoostResultCardProps {
  results: SmurfBoostResults;
  /** The exact threshold set the run was computed with. */
  thresholds: Record<string, number>;
  minimumBaselineGames: number;
}

/**
 * One colour ladder, read two ways. The band word takes the text colour and
 * the family's own card takes the same step as a left edge, so two readings
 * stay tellable apart at a glance while scrolling.
 *
 * Colour never encodes a number -- the specification forbids showing a
 * per-family score -- and never carries the reading alone; the band word is
 * always present beside it.
 */
const BAND_STYLES: Record<
  SmurfBoostFamily["band"],
  { text: string; accent: string }
> = {
  strong_indicators: { text: "text-rose-500", accent: "border-l-rose-500" },
  notable_indicators: { text: "text-amber-500", accent: "border-l-amber-500" },
  weak_indicators: { text: "text-yellow-500", accent: "border-l-yellow-500" },
  no_unusual_pattern: {
    text: "text-emerald-500",
    accent: "border-l-emerald-500",
  },
  not_enough_data: {
    text: "text-muted-foreground",
    accent: "border-l-muted-foreground",
  },
};

const UNREADABLE_BAND_STYLE = BAND_STYLES.not_enough_data;

function formatValue(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : value.toFixed(2);
}

/**
 * The version half of a `module/version` model identifier.
 *
 * The backend stores the module name alongside the version, and that module
 * is still called `smurf-boost` because renaming it would move the API
 * contract for nothing. Only the version tells a reader which formulas
 * produced the numbers beside it, so the module name is dropped rather than
 * shown. A value carrying no slash is passed through unchanged.
 */
function modelVersionLabel(modelVersion: string): string {
  const separator = modelVersion.lastIndexOf("/");
  return separator === -1 ? modelVersion : modelVersion.slice(separator + 1);
}

/**
 * The recent window is taken first, so the earlier games the comparison needs
 * sit behind a full recent window. Reporting only the two sample floors would
 * understate the requirement whenever the recent window is the larger of them.
 */
function requiredGames(
  results: SmurfBoostResults,
  thresholds: Record<string, number>,
  minimumBaselineGames: number,
): { recentWindow: number; required: number; missing: number } {
  const stored = thresholds.recent_window_size;
  // A run stored under an older threshold contract may not carry the window at
  // all; its own recent count is then the only honest stand-in.
  const recentWindow =
    stored !== undefined && Number.isFinite(stored)
      ? stored
      : results.recent_games;
  const required = recentWindow + minimumBaselineGames;
  return {
    recentWindow,
    required,
    missing: Math.max(0, required - results.eligible_games),
  };
}

/**
 * Why an available signal did not trigger.
 *
 * Four of the eight signals combine their threshold with a separate condition —
 * an account-level gate, a flat-composite ceiling, two tail fractions, a
 * sustained drop. Any of those can fail while the measured value sits above the
 * threshold printed beside it, and "Below threshold" on a row reading 1.50
 * against 1.20 is simply not true.
 */
function signalOutcome(signal: SmurfBoostSignal): string {
  const value = signal.raw_value;
  const threshold = signal.threshold;
  const met =
    value !== null &&
    value !== undefined &&
    threshold !== null &&
    threshold !== undefined &&
    value >= threshold;
  return met ? "Other conditions not met" : "Below threshold";
}

/** The outcome pill, identical in both the table and the stacked layout. */
function SignalOutcome({ signal }: { signal: SmurfBoostSignal }) {
  if (!signal.available) {
    return <Badge variant="outline">Not available</Badge>;
  }
  if (signal.triggered) {
    return <Badge variant="secondary">Above threshold</Badge>;
  }
  return (
    // Each family sizes its own table, so this column can end up narrower in
    // one than the other and split a two-word outcome across lines.
    <span className="whitespace-nowrap text-sm text-muted-foreground">
      {signalOutcome(signal)}
    </span>
  );
}

/**
 * The measured value drawn against its threshold.
 *
 * The tick sits at a fixed fraction of the track, so "how close is this value
 * to mattering" reads the same in every row even though the rows' units
 * differ. Length carries the number and the outcome stays worded in the pill
 * beside it — colour encodes nothing, per the specification. Decorative on
 * purpose: the figures beside the bar are the accessible reading.
 */
const METER_TICK_PERCENT = 62;

function SignalMeter({ signal }: { signal: SmurfBoostSignal }) {
  const value = signal.raw_value;
  const threshold = signal.threshold;
  // A missing figure or a non-positive threshold has no meaningful ratio to
  // draw; the row then simply shows its figures.
  if (
    value === null ||
    value === undefined ||
    threshold === null ||
    threshold === undefined ||
    threshold <= 0
  ) {
    return null;
  }
  const fill = Math.min(
    100,
    Math.max(0, (value / threshold) * METER_TICK_PERCENT),
  );
  return (
    <div
      aria-hidden="true"
      className="relative h-2 min-w-24 flex-1 overflow-hidden rounded-full bg-muted/60"
    >
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-primary/70"
        style={{ width: `${fill}%` }}
      />
      <div
        className="absolute inset-y-0 w-0.5 bg-foreground/60"
        style={{ left: `${METER_TICK_PERCENT}%` }}
      />
    </div>
  );
}

/**
 * One measurement: what it asked, how it came out, and the value drawn
 * against its threshold. One layout at every width — the meter needs no
 * columns, so nothing has to hide behind a sideways gesture on a phone.
 */
function SignalItem({ signal }: { signal: SmurfBoostSignal }) {
  return (
    <li className="rounded-md border border-border/60 bg-muted/20 p-3">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 flex-1 basis-52 text-sm">
          <span className="mr-2 font-mono text-primary">{signal.id}</span>
          {signal.reason}
        </p>
        <SignalOutcome signal={signal} />
      </div>
      {signal.notes.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {signal.notes.map((note) => (
            <li key={note} className="text-sm text-muted-foreground">
              {noteLabel(note)}
            </li>
          ))}
        </ul>
      )}
      {signal.available && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <SignalMeter signal={signal} />
          <span className="whitespace-nowrap font-mono text-sm">
            {formatValue(signal.raw_value)}
            <span className="text-muted-foreground">
              {" / "}
              {formatValue(signal.threshold)}
            </span>
          </span>
          <span className="whitespace-nowrap text-sm text-muted-foreground">
            {signal.sample_size} {signal.sample_size === 1 ? "game" : "games"}
          </span>
        </div>
      )}
    </li>
  );
}

function SignalList({ family }: { family: SmurfBoostFamily }) {
  return (
    <div>
      {/* Tailwind's reset removes the list marker, and WebKit then drops the
          list role — which would leave this labelled group unannounced on the
          one platform that ever sees it. `role="list"` puts the semantics back. */}
      <ul
        role="list"
        aria-label={`${familyTitle(family.family)} measurements`}
        data-testid={`smurf-boost-measurements-${family.family}`}
        className="space-y-3"
      >
        {family.signals.map((signal) => (
          <SignalItem key={signal.id} signal={signal} />
        ))}
      </ul>

      <p className="mt-2 text-sm text-muted-foreground">
        Each bar reaches toward the tick that marks its threshold; the figures
        beside it read value / threshold. Units are named in each description:
        standardized units, a win rate, or doublings of spread.
      </p>
    </div>
  );
}

function FamilySummary({ family }: { family: SmurfBoostFamily }) {
  const triggered = family.signals.filter((signal) => signal.triggered);
  const unavailable = family.signals.filter((signal) => !signal.available);

  return (
    <p className="text-sm">
      {triggered.length === 0
        ? "No area of this comparison moved past its threshold."
        : `${triggered.length} of ${family.signals.length} areas moved past their threshold, covering ${family.distinct_evidence} distinct ${family.distinct_evidence === 1 ? "kind" : "kinds"} of measurement.`}
      {unavailable.length > 0 &&
        ` ${unavailable.length} ${unavailable.length === 1 ? "area" : "areas"} could not be measured; each states why below, so a missing area is never read as a pass.`}
    </p>
  );
}

function FamilySection({
  family,
  shortfall,
}: {
  family: SmurfBoostFamily;
  shortfall: string;
}) {
  const insufficient = family.band === "not_enough_data";
  // `noUncheckedIndexedAccess` is on, so the fallback is what the types need,
  // not a second policy.
  const bandStyle = BAND_STYLES[family.band] ?? UNREADABLE_BAND_STYLE;

  return (
    // Each family is read on its own and never combined, so each gets its own
    // card. The tint separates it from the run card holding it, which shares
    // the same `bg-card`.
    <Card className={`border-l-4 bg-muted/20 shadow-none ${bandStyle.accent}`}>
      <CardHeader className="pb-3">
        {/* The band is the reading. Beside the title there is room for it on
            the right, but once the row wraps on a phone `justify-between`
            leaves it stranded mid-line, so below `sm` the two simply stack. */}
        <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-baseline sm:justify-between sm:gap-2">
          <h4 className="text-base font-semibold">
            {familyTitle(family.family)}
          </h4>
          <span className="sm:text-right">
            <span
              data-testid={`smurf-boost-band-${family.family}`}
              className={`block text-lg font-bold ${bandStyle.text}`}
            >
              {BAND_LABELS[family.band]}
            </span>
            <span className="block text-sm text-muted-foreground">
              {bandMeaning(family.band)}
            </span>
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          {familyDescription(family.family)}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {insufficient ? (
          <p className="text-sm text-muted-foreground">{shortfall}</p>
        ) : (
          <>
            <FamilySummary family={family} />
            {family.signals.length > 0 && <SignalList family={family} />}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function SmurfBoostResultCard({
  results,
  thresholds,
  minimumBaselineGames,
}: SmurfBoostResultCardProps) {
  const { recentWindow, required, missing } = requiredGames(
    results,
    thresholds,
    minimumBaselineGames,
  );
  // An empty family list is a result that says nothing. Reporting a game
  // shortfall for it would invent a reason the model never gave.
  const insufficient =
    results.families.length > 0 &&
    results.families.some((family) => family.band === "not_enough_data");

  const shortfall =
    `This player has ${results.eligible_games} eligible ranked solo/duo ` +
    `${results.eligible_games === 1 ? "game" : "games"} stored. The comparison ` +
    `reads the most recent ${recentWindow} and needs at least ` +
    `${minimumBaselineGames} earlier games behind them, so at least ` +
    `${required} in total` +
    (missing > 0 ? `, which is ${missing} more than are stored` : "") +
    ".";

  return (
    <Card id="smurf-boost-result">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="flex items-center gap-2">
            <ShieldQuestion className="h-5 w-5 text-primary" />
            Comparison Result
          </CardTitle>
          <Badge variant="secondary" className="ml-auto">
            Recent {results.recent_games} games against the previous{" "}
            {results.baseline_games}
          </Badge>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="gap-1">
            <Gauge className="h-3 w-3" />
            {CONFIDENCE_LABELS[results.confidence_band]}
          </Badge>
          <span className="text-sm text-muted-foreground">
            How much this comparison can be relied on, separate from what it
            found.
          </span>
          {/* The stored value is a namespaced slug (`smurf-boost/v1`) naming
              the detection module, which is the one place the retired product
              name still reached a reader. Only the version identifies what
              produced this reading, so only the version is shown. */}
          <span className="ml-auto font-mono text-sm text-muted-foreground">
            Model {modelVersionLabel(results.model_version)}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {results.families.map((family) => (
          <FamilySection
            key={family.family}
            family={family}
            shortfall={shortfall}
          />
        ))}

        {insufficient && (
          <p className="text-sm text-muted-foreground">
            A game counts only when it is ranked solo/duo, not a remake, at
            least five minutes long, and played in a recognised position.
          </p>
        )}

        {results.notes.length > 0 && (
          <div className="space-y-2">
            <h4 className="flex items-center gap-2 text-sm font-medium">
              <CircleAlert className="h-4 w-4 text-muted-foreground" />
              Limits of This Data
            </h4>
            <ul className="space-y-1">
              {results.notes.map((note) => (
                <li key={note} className="text-sm text-muted-foreground">
                  {noteLabel(note)}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex gap-2 rounded-md border border-border/60 bg-muted/40 p-3">
          <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-sm leading-relaxed text-muted-foreground">
            {results.disclaimer}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
