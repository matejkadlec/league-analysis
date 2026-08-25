import { SignInForm } from "@/features/auth";

// No auth-state cookie read here. `proxy.ts` already redirects a request
// carrying the hint away from `/sign-in`, so reading `cookies()` only made
// this the one route in `app/` that rendered per request to produce output
// that never varies.
export default function SignInPage() {
  return <SignInForm />;
}
