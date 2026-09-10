import { cookies } from "next/headers";
import Link from "next/link";
import { LegalPageShell } from "@/components/legal-page-shell";
import {
  AUTH_STATE_COOKIE_NAME,
  AUTH_STATE_COOKIE_VALUE,
} from "@/lib/session/auth-state-cookie";

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
        Games API, including Riot IDs, match history, performance
        statistics, and rank information. This data is used solely for the
        purpose of providing analysis and insights within the application.
      </p>

      <h2 className="text-2xl font-semibold mt-6 mb-3">How We Use Your Data</h2>
      <p className="leading-relaxed">
        The data collected is used exclusively to:
      </p>
      <ul className="list-disc pl-6 space-y-2">
        <li>
          Provide playstyle analysis and account anomaly detection services
        </li>
        <li>Display match history and performance statistics</li>
        <li>Track player rank progression and metrics</li>
        <li>Generate matchmaking analysis reports</li>
      </ul>

      <h2 className="text-2xl font-semibold mt-6 mb-3">
        Data Storage and Security
      </h2>
      <p className="leading-relaxed">
        Your installation stores account details, password hashes, session
        records, preferences, and collected game information in its database.
        Its operator controls access, backups, and retention. Requests to Riot
        Games and any configured email or security services are processed by
        those providers.
      </p>

      <h2 className="text-2xl font-semibold mt-6 mb-3">Cookies and Storage</h2>
      <p className="leading-relaxed">
        We use strictly necessary cookies/local storage for authentication and
        security. Optional preference storage is only enabled after explicit
        consent via the cookie dialog.
      </p>
      <p className="leading-relaxed">
        For the full storage list, retention periods, and preference controls,
        see our{" "}
        <Link href="/cookie-policy" className="underline hover:text-gold-base">
          Cookie Policy
        </Link>
        .
      </p>

      <h2 className="text-2xl font-semibold mt-6 mb-3">Your Rights</h2>
      <p className="leading-relaxed">
        You can stop tracking a player in the application. This removes the
        tracking relationship; it does not erase the account or all stored
        match records. For access or deletion requests, contact the operator
        of your installation. Data being available from Riot does not by itself
        make our stored copy exempt from applicable deletion requirements.
      </p>

      <h2 className="text-2xl font-semibold mt-6 mb-3">Contact</h2>
      <p className="leading-relaxed">
        If you have any questions or concerns about our privacy practices,
        please contact the operator of your installation. For this portfolio
        project, contact mat.kadlec@email.cz.
      </p>

      <p className="leading-relaxed text-sm mt-8 text-center">
        Copyright © 2026 Matěj Kadlec. All rights reserved.
      </p>
    </LegalPageShell>
  );
}
