import { cookies } from "next/headers";
import { LegalPageShell } from "@/components/legal-page-shell";
import {
  AUTH_STATE_COOKIE_NAME,
  AUTH_STATE_COOKIE_VALUE,
} from "@/features/auth/utils/auth-state-cookie";

export default async function PrivacyPolicyPage() {
  const cookieStore = await cookies();
  const authStateCookie = cookieStore.get(AUTH_STATE_COOKIE_NAME)?.value;
  const isAuthenticatedHint = authStateCookie === AUTH_STATE_COOKIE_VALUE;

  return (
    <LegalPageShell
      title="Privacy Policy"
      isAuthenticatedHint={isAuthenticatedHint}
    >
      <p className="leading-relaxed">
        League Analysis respects your privacy and is committed to protecting
        your personal information.
      </p>

      <h2 className="text-2xl font-semibold mt-6 mb-3">
        Information We Collect
      </h2>
      <p className="leading-relaxed">
        We collect and process League of Legends player data through the Riot
        Games API, including summoner names, match history, performance
        statistics, and rank information. This data is used solely for the
        purpose of providing analysis and insights within the application.
      </p>

      <h2 className="text-2xl font-semibold mt-6 mb-3">
        How We Use Your Data
      </h2>
      <p className="leading-relaxed">The data collected is used exclusively to:</p>
      <ul className="list-disc pl-6 space-y-2">
        <li>Provide playstyle analysis and account anomaly detection services</li>
        <li>Display match history and performance statistics</li>
        <li>Track player rank progression and metrics</li>
        <li>Generate matchmaking analysis reports</li>
      </ul>

      <h2 className="text-2xl font-semibold mt-6 mb-3">
        Data Storage and Security
      </h2>
      <p className="leading-relaxed">
        All data is stored securely and is only accessible to authenticated
        users of the application. We do not share, sell, or distribute your
        data to third parties.
      </p>

      <h2 className="text-2xl font-semibold mt-6 mb-3">Your Rights</h2>
      <p className="leading-relaxed">
        You have the right to request deletion of your tracked player data at
        any time through the application interface. Public match data from the
        Riot Games API cannot be deleted as it is publicly available
        information.
      </p>

      <h2 className="text-2xl font-semibold mt-6 mb-3">Contact</h2>
      <p className="leading-relaxed">
        If you have any questions or concerns about our privacy practices,
        please contact the application administrators.
      </p>

      <p className="leading-relaxed text-sm mt-8 text-center">
        © 2026 Matěj Kadlec. All rights reserved.
      </p>
    </LegalPageShell>
  );
}
