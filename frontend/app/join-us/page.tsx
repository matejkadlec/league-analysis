import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  AUTH_STATE_COOKIE_NAME,
  AUTH_STATE_COOKIE_VALUE,
} from "@/features/auth/utils/auth-state-cookie";

export default async function JoinUsPage() {
  const cookieStore = await cookies();
  const authStateCookie = cookieStore.get(AUTH_STATE_COOKIE_NAME)?.value;
  const isAuthenticatedHint = authStateCookie === AUTH_STATE_COOKIE_VALUE;

  // Temporarily hidden while Riot production-key review is pending.
  // Signed-in users are sent to home, signed-out users to sign-in.
  if (isAuthenticatedHint) {
    redirect("/");
  }

  redirect("/sign-in");
}
