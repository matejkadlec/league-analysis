"use client";

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
                    className="object-contain"
                  />
                </div>
              </div>
            </div>
          </div>
          <CardContent className="px-8 pt-0 pb-4 prose prose-lg max-w-none space-y-4">
            <p className="leading-relaxed">
              Welcome to League Analysis - your all in one tool for
              comprehensive analysis of League of Legends players, matches and
              matchmaking fairness as well as a great multiple player tracking
              toool.
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
                Playstyle Analysis page overhaul.
                <ul className="list-disc space-y-1 pl-6 marker:text-[#cfa93a]/80">
                  <li>Will be renamed to Player Analysis.</li>
                  <li>
                    Add more analyses working with different approaches and
                    using different sets of variables.
                  </li>
                </ul>
              </li>
              <li>
                Comprehensive meta analysis with toggleable parameters, and what
                will not be toggleable will be known to the user.
                <ul className="list-disc space-y-1 pl-6 marker:text-[#cfa93a]/80">
                  <li>Possible multiple approaches on how to analyze meta.</li>
                  <li>
                    Users can participate on the final formulas and
                    calculations.
                  </li>
                </ul>
              </li>
              <li>
                Users will be able to create their own analysis and statistics
                cards (with limitations) and share them with other users.
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
