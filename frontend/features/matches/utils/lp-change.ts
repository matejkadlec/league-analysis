export function formatMatchLpChange(
  lpChange: number | null | undefined,
  isRemake: boolean,
): string {
  if (lpChange === null || lpChange === undefined) return "— LP";
  if (lpChange > 0) return `+${lpChange} LP`;
  if (lpChange < 0) return `${lpChange} LP`;
  return isRemake ? "+0 LP" : "0 LP";
}
