"use client";

import Image from "next/image";
import { useState } from "react";

import {
  getChampionDisplayName,
  getChampionIconUrl,
} from "@/lib/core/riot/data-dragon";
import { cn } from "@/lib/core/utils";

interface ChampionIconProps {
  /** The stored MATCH-V5 `championName`, as the API returns it. */
  championName: string;
  ddragonVersion: string;
  /** The `sizes` hint for the rendered width, e.g. `"52px"`. */
  sizes: string;
  unoptimized?: boolean;
}

/**
 * A champion's Data Dragon icon, filling its positioned parent. When Data
 * Dragon has no image for it, a muted tile with the champion's initial takes
 * its place instead of the browser's broken-image glyph (LGA-117).
 */
export function ChampionIcon({
  championName,
  ddragonVersion,
  sizes,
  unoptimized = false,
}: ChampionIconProps) {
  const src = getChampionIconUrl(championName, ddragonVersion);
  const displayName = getChampionDisplayName(championName);
  // Keyed by URL, so a new champion or version gets a fresh attempt.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (failedSrc === src) {
    return (
      <div
        role="img"
        aria-label={displayName}
        className={cn(
          "flex h-full w-full items-center justify-center bg-muted",
          "text-xs font-semibold text-muted-foreground",
        )}
      >
        {displayName.charAt(0)}
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={displayName}
      fill
      sizes={sizes}
      className="object-cover"
      unoptimized={unoptimized}
      onError={() => setFailedSrc(src)}
    />
  );
}
