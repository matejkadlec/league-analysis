"use client";

import {
  Bar,
  BarChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { LobbyTierSchema, type LobbyTier } from "@/lib/core/schemas";

/** Ascending rank order, the unranked bucket last. */
const TIER_ORDER: LobbyTier[] = [...LobbyTierSchema.options];

// Categorical pair validated with the dataviz palette checker against both
// surface modes (lightness band, CVD separation, contrast all pass).
const ALLY_COLOR = "#3b82f6";
const ENEMY_COLOR = "#ef4444";
const INK = "var(--color-muted-foreground)";

function tierLabel(tier: string): string {
  return tier.charAt(0) + tier.slice(1).toLowerCase();
}

export interface TierShareRow {
  tier: string;
  Allies: number;
  Enemies: number;
  allyCount: number;
  enemyCount: number;
}

/**
 * Percent-of-side rows: each side sums to 100 so the bars stay comparable
 * even though enemies outnumber allies (5 per match vs 4, fewer repeats).
 */
export function tierShareRows(
  allyCounts: Partial<Record<LobbyTier, number>>,
  enemyCounts: Partial<Record<LobbyTier, number>>,
): TierShareRow[] {
  const allyTotal = Object.values(allyCounts).reduce((sum, n) => sum + n, 0);
  const enemyTotal = Object.values(enemyCounts).reduce((sum, n) => sum + n, 0);

  return TIER_ORDER.filter(
    (tier) => (allyCounts[tier] ?? 0) + (enemyCounts[tier] ?? 0) > 0,
  ).map((tier) => {
    const allyCount = allyCounts[tier] ?? 0;
    const enemyCount = enemyCounts[tier] ?? 0;
    return {
      tier: tierLabel(tier),
      Allies: allyTotal > 0 ? (allyCount / allyTotal) * 100 : 0,
      Enemies: enemyTotal > 0 ? (enemyCount / enemyTotal) * 100 : 0,
      allyCount,
      enemyCount,
    };
  });
}

interface TierDistributionProps {
  allyCounts: Partial<Record<LobbyTier, number>>;
  enemyCounts: Partial<Record<LobbyTier, number>>;
}

/**
 * Share of each side's unique players per tier, as paired horizontal bars.
 * Rows exist only for occupied tiers, so a Gold lobby is three rows, not eleven.
 */
export function TierDistribution({
  allyCounts,
  enemyCounts,
}: TierDistributionProps) {
  const rows = tierShareRows(allyCounts, enemyCounts);

  if (rows.length === 0) {
    return null;
  }

  return (
    <figure aria-label="Tier distribution of allies and enemies">
      <ResponsiveContainer width="100%" height={rows.length * 44 + 56}>
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 0, right: 12, bottom: 0, left: 8 }}
          barCategoryGap="25%"
          barGap={2}
        >
          <XAxis
            type="number"
            domain={[0, "dataMax"]}
            tickFormatter={(value: number) => `${Math.round(value)}%`}
            tick={{ fill: INK, fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="tier"
            width={92}
            tick={{ fill: INK, fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: "var(--color-muted)", opacity: 0.35 }}
            formatter={(value, name, item) => {
              const row = item.payload as TierShareRow;
              const count = name === "Allies" ? row.allyCount : row.enemyCount;
              return [
                `${Number(value).toFixed(1)}% (${count} players)`,
                String(name),
              ];
            }}
            contentStyle={{
              backgroundColor: "var(--color-popover)",
              border: "1px solid var(--color-border)",
              borderRadius: 6,
              color: "var(--color-popover-foreground)",
            }}
          />
          <Legend
            wrapperStyle={{ color: INK, fontSize: 12 }}
            iconType="circle"
            iconSize={8}
          />
          <Bar
            dataKey="Allies"
            fill={ALLY_COLOR}
            radius={[0, 4, 4, 0]}
            maxBarSize={12}
          />
          <Bar
            dataKey="Enemies"
            fill={ENEMY_COLOR}
            radius={[0, 4, 4, 0]}
            maxBarSize={12}
          />
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}
