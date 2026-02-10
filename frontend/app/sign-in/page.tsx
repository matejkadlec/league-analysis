import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignInForm } from "@/features/auth";
import {
  AUTH_STATE_COOKIE_NAME,
  AUTH_STATE_COOKIE_VALUE,
} from "@/features/auth/utils/auth-state-cookie";

export default async function SignInPage() {
  const cookieStore = await cookies();
  const authStateCookie = cookieStore.get(AUTH_STATE_COOKIE_NAME)?.value;

  if (authStateCookie === AUTH_STATE_COOKIE_VALUE) {
    redirect("/");
  }

  return <SignInForm />;
}
