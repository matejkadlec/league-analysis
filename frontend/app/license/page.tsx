import { cookies } from "next/headers";
import { LegalPageShell } from "@/components/legal-page-shell";
import {
  AUTH_STATE_COOKIE_NAME,
  AUTH_STATE_COOKIE_VALUE,
} from "@/lib/session/auth-state-cookie";

export default async function LicensePage() {
  const cookieStore = await cookies();
  const authStateCookie = cookieStore.get(AUTH_STATE_COOKIE_NAME)?.value;
  const isAuthenticatedHint = authStateCookie === AUTH_STATE_COOKIE_VALUE;

  return (
    <LegalPageShell title="License" isAuthenticatedHint={isAuthenticatedHint}>
      <p className="leading-relaxed">
        League Analysis is a proprietary application developed for analyzing
        League of Legends player data and match statistics.
      </p>

      <h2 className="text-2xl font-semibold mt-6 mb-3">Terms of Use</h2>
      <p className="leading-relaxed">
        This application is provided for personal and educational use. By using
        League Analysis, you agree to use the service responsibly and in
        accordance with Riot Games&apos; Terms of Service and API Usage Policy.
      </p>

      <h2 className="text-2xl font-semibold mt-6 mb-3">Data Source</h2>
      <p className="leading-relaxed">
        League Analysis uses data from the Riot Games API. League Analysis
        isn&apos;t endorsed by Riot Games and doesn&apos;t reflect the views or
        opinions of Riot Games or anyone officially involved in producing or
        managing Riot Games properties. Riot Games, and all associated
        properties are trademarks or registered trademarks of Riot Games, Inc.
      </p>

      <h2 className="text-2xl font-semibold mt-6 mb-3">Disclaimer</h2>
      <p className="leading-relaxed">
        The analysis and predictions provided by this application are for
        informational purposes only. We do not guarantee the accuracy or
        completeness of any information or analysis provided through this
        service.
      </p>

      <h2 className="text-2xl font-semibold mt-6 mb-3">Copyright</h2>
      <p className="leading-relaxed">
        Copyright © 2026 Matěj Kadlec. All rights reserved.
      </p>
    </LegalPageShell>
  );
}
