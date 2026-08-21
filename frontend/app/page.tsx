import Image from "next/image";
import { ClipboardList } from "lucide-react";

import { ProtectedRoute } from "@/features/auth";
import { Card, CardContent } from "@/components/ui/card";

export default function Home() {
  return (
    <ProtectedRoute>
      <div className="container mx-auto max-w-4xl px-4 py-8 space-y-6">
        <Card id="header-card" className="py-2">
          <div className="flex flex-col">
            <div className="px-8 pt-4 pb-2 flex items-start justify-between">
              <div className="flex items-center gap-3">
                <h1 className="text-4xl font-[family-name:var(--font-league)]">
                  League Analysis
                </h1>
                <div className="relative h-[3.5rem] w-[3.5rem] -m-t-2 -m-b-3">
                  <Image
                    src="/magnifier.png"
                    alt="Magnifier"
                    fill
                    sizes="56px"
                    className="object-contain"
                  />
                </div>
              </div>
            </div>
          </div>
          <CardContent className="px-8 pt-0 pb-4 max-w-none space-y-4">
            <p className="leading-relaxed">
              Welcome to League Analysis - your all in one tool for
              comprehensive analysis of League of Legends players, matches and
              matchmaking fairness as well as a great multiple player tracking
              tool.
            </p>
          </CardContent>
        </Card>

        <Card className="border-white/15 bg-[#0a1428]/95 py-2 text-white">
          <div className="px-8 pt-4 pb-2 flex items-center gap-3">
            <ClipboardList className="h-6 w-6 text-[#cfa93a]" />
            <h2 className="text-2xl font-semibold">Planned Features</h2>
          </div>
          <CardContent className="px-8 pt-0 pb-6">
            <ul className="list-disc space-y-3 pl-6 text-sm leading-relaxed marker:text-[#cfa93a]">
              <li>
                Smurfing/boosting detection tool.
                <ul className="list-disc space-y-1 pl-6 marker:text-[#cfa93a]/80">
                  <li>
                    Will analyze player&apos;s match history and check several
                    factors, thresholds of the factors will be configurable
                    per-user.
                  </li>
                  <li>
                    For example, hard-stuck account starts rapidly climbing, or
                    the opposite, a high win rate account suddenly begin to lose
                    a lot more.
                  </li>
                </ul>
              </li>
              <li>
                Custom user configuration to cards where it&apos;s applicable.
                <ul className="list-disc space-y-1 pl-6 marker:text-[#cfa93a]/80">
                  <li>
                    Mostly for cards that have some hard-coded threshhold, like
                    performance trends.
                  </li>
                  <li>
                    As well as specific configurations, like show only champions
                    with X%+ winrate/X+ KDA/played on mid only in Top Champions
                    card.
                  </li>
                </ul>
              </li>
              <li>
                Extended Match History component.
                <ul className="list-disc space-y-1 pl-6 marker:text-[#cfa93a]/80">
                  <li>Individual matches will be clickable and expandable.</li>
                  <li>
                    When expanded, far more match info will be shown to the user
                    (exact statistics are subject to discussion).
                  </li>
                </ul>
              </li>
              <li>
                Evidence-based Playstyle card for Player Overview.
                <ul className="list-disc space-y-1 pl-6 marker:text-[#cfa93a]/80">
                  <li>
                    Research meaningful formulas and tags before presenting
                    them as player-level analysis.
                  </li>
                </ul>
              </li>
              <li>
                Comprehensive meta analysis with configurable weights.
                <ul className="list-disc space-y-1 pl-6 marker:text-[#cfa93a]/80">
                  <li>Multiple approaches on how to analyze meta.</li>
                  <li>
                    Configurable weights of what important is e.g. Win Rate vs
                    Pick Rate, with some pre-configured sets.
                  </li>
                </ul>
              </li>
              <li>
                A page with toggleable cards, so users can create their own
                custom page with available cards.
                <ul className="list-disc space-y-1 pl-6 marker:text-[#cfa93a]/80">
                  <li>
                    Card order will also be changeable, so users can prioritize
                    what matters most to them.
                  </li>
                  <li>
                    Card ordering might be added to common pages as well via
                    draggable cards, if there is enough demand.
                  </li>
                </ul>
              </li>
              <li>
                Dedicated Discord server where new features and enhancements can
                be discussed, as well as general discussion.
                <ul className="list-disc space-y-1 pl-6 marker:text-[#cfa93a]/80">
                  <li>
                    Potentially a forum-like page where users could discuss
                    directly on the website.
                  </li>
                </ul>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </ProtectedRoute>
  );
}
