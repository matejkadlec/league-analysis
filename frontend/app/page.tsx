"use client";

import Image from "next/image";

import { ProtectedRoute } from "@/features/auth";
import { Card, CardContent } from "@/components/ui/card";

export default function Home() {
  return (
    <ProtectedRoute>
      <div className="container mx-auto max-w-4xl px-4 py-8">
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
              more.
            </p>
          </CardContent>
        </Card>
      </div>
    </ProtectedRoute>
  );
}
