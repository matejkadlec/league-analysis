import { SignInForm } from "@/features/auth";

// No auth-state cookie read here: `proxy.ts` already redirects a request
// carrying the hint away from `/sign-in`, and this page cannot be reached
// without passing through it. Reading `cookies()` only made the route
// dynamic, which is why it is the one page in `app/` that rendered per
// request to produce output that never varies.
export default function SignInPage() {
  return <SignInForm />;
}
