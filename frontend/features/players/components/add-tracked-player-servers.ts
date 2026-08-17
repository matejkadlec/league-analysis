import type { Player } from "@/lib/core/schemas";

export const SERVERS = [
  ["eun1", "🇪🇺", "EUNE"],
  ["euw1", "🇪🇺", "EUW"],
  ["na1", "🇺🇸", "NA"],
  ["kr", "🇰🇷", "KR"],
  ["tr1", "🇹🇷", "TR"],
  ["br1", "🇧🇷", "BR"],
  ["la1", "🇲🇽", "LAN"],
  ["la2", "🇦🇷", "LAS"],
  ["oc1", "🇦🇺", "OCE"],
  ["ru", "🇷🇺", "RU"],
  ["jp1", "🇯🇵", "JP"],
  ["tw2", "🇹🇼", "TW"],
  ["vn2", "🇻🇳", "VN"],
  ["ph2", "🇵🇭", "PH"],
  ["sg2", "🇸🇬", "SG"],
  ["th2", "🇹🇭", "TH"],
] as const;

export function displayRiotId(player: Player): string {
  const gameName = player.game_name || "Unknown player";

  return player.tag_line ? `${gameName}#${player.tag_line}` : gameName;
}

export function isExactRiotIdMatch(
  player: Player,
  gameName: string,
  tagLine: string,
): boolean {
  return (
    (player.game_name ?? "").trim().toLocaleLowerCase() ===
      gameName.toLocaleLowerCase() &&
    (player.tag_line ?? "").trim().toLocaleLowerCase() ===
      tagLine.toLocaleLowerCase()
  );
}
