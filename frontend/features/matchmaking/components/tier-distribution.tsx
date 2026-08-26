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

/** Ascending rank order, the unranked bucket last. */
const TIER_ORDER = [
  "IRON",
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
  "EMERALD",
  "DIAMOND",
  "MASTER",
  "GRANDMASTER",
  "CHALLENGER",
  "UNRANKED",
];

// Categorical pair validated with the dataviz palette checker against both
// surface modes (lightness band, CVD separation, contrast all pass).
const ALLY_COLOR = "#3b82f6";
const ENEMY_COLOR = "#ef4444";
const INK = "var(--color-muted-foreground)";

function tierLabel(tier: string): string {
  return tier.charAt(0) + tier.slice(1).toLowerCase();
}

interface TierDistributionProps {
  allyCounts: Record<string, number>;
  enemyCounts: Record<string, number>;
}

/**
 * Unique allies vs enemies per tier over one run, as paired horizontal bars.
 * Rows exist only for tiers someone actually occupies, so a Gold-lobby chart
 * is two or three rows, not eleven.
 */
export function TierDistribution({
  allyCounts,
  enemyCounts,
}: TierDistributionProps) {
  const rows = TIER_ORDER.filter(
    (tier) => (allyCounts[tier] ?? 0) + (enemyCounts[tier] ?? 0) > 0,
  ).map((tier) => ({
    tier: tierLabel(tier),
    Allies: allyCounts[tier] ?? 0,
    Enemies: enemyCounts[tier] ?? 0,
  }));

  if (rows.length === 0) {
    return null;
  }

  const maxCount = Math.max(
    ...rows.map((row) => Math.max(row.Allies, row.Enemies)),
  );

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
            allowDecimals={false}
            domain={[0, maxCount]}
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
