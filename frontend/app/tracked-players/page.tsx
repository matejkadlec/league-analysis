import { redirect } from "next/navigation";

interface TrackedPlayersRedirectProps {
  searchParams: Promise<{ puuid?: string | string[] }>;
}

export default async function TrackedPlayersRedirect({
  searchParams,
}: TrackedPlayersRedirectProps) {
  const params = await searchParams;
  const puuid = Array.isArray(params.puuid) ? params.puuid[0] : params.puuid;
  redirect(
    puuid ? `/my-profile?puuid=${encodeURIComponent(puuid)}` : "/my-profile",
  );
}
