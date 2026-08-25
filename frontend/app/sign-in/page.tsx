import { SignInForm } from "@/features/auth";

// No auth-state cookie read here. `proxy.ts` already redirects a request
// carrying the hint away from `/sign-in`, so reading `cookies()` would only
// make this route render per request for output that never varies.
export default function SignInPage() {
  return <SignInForm />;
}
