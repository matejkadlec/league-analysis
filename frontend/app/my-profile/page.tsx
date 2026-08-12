import { redirect } from "next/navigation";

import { playerOverviewRoute } from "@/features/players/player-routes";

interface MyProfileRedirectProps {
  searchParams: Promise<{ puuid?: string | string[] }>;
}

export default async function MyProfileRedirect({
  searchParams,
}: MyProfileRedirectProps) {
  const params = await searchParams;
  const puuid = Array.isArray(params.puuid) ? params.puuid[0] : params.puuid;
  redirect(playerOverviewRoute(puuid));
}
