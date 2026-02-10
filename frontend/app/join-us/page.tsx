import { cookies } from "next/headers";
import { JoinUsForm } from "@/features/auth";
import {
  AUTH_STATE_COOKIE_NAME,
  AUTH_STATE_COOKIE_VALUE,
} from "@/features/auth/utils/auth-state-cookie";

export default async function JoinUsPage() {
  const cookieStore = await cookies();
  const authStateCookie = cookieStore.get(AUTH_STATE_COOKIE_NAME)?.value;
  const isAuthenticatedHint = authStateCookie === AUTH_STATE_COOKIE_VALUE;

  return <JoinUsForm isAuthenticatedHint={isAuthenticatedHint} />;
}
