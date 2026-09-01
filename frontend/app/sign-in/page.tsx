import { SignInForm } from "@/features/auth";

// `proxy.ts` already redirects a hinted request away, so reading `cookies()` here
// would only make a route with invariant output render per request.
export default function SignInPage() {
  return <SignInForm />;
}
