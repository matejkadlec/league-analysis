import { cookies } from "next/headers";
import { LegalPageShell } from "@/components/legal-page-shell";
import {
  AUTH_STATE_COOKIE_NAME,
  AUTH_STATE_COOKIE_VALUE,
} from "@/features/auth/utils/auth-state-cookie";
import { COOKIE_CONSENT_VERSION } from "@/features/cookie-consent/utils/consent-storage";

export default async function CookiePolicyPage() {
  const cookieStore = await cookies();
  const authStateCookie = cookieStore.get(AUTH_STATE_COOKIE_NAME)?.value;
  const isAuthenticatedHint = authStateCookie === AUTH_STATE_COOKIE_VALUE;

  return (
    <LegalPageShell title="Cookie Policy" isAuthenticatedHint={isAuthenticatedHint}>
      <p className="leading-relaxed">
        This Cookie Policy explains how League Analysis uses cookies and similar
        browser storage technologies on our website.
      </p>

      <h2 className="text-2xl font-semibold mt-6 mb-3">How Consent Works</h2>
      <ul className="list-disc pl-6 space-y-2">
        <li>
          Strictly necessary storage is always used to provide requested core
          functionality (for example sign-in state and security).
        </li>
        <li>
          Optional preference storage is only enabled after selecting{" "}
          <strong>Accept all</strong> in the cookie dialog.
        </li>
        <li>
          You can reopen the cookie dialog at any time using the{" "}
          <strong>Cookie settings</strong> link in the page footer. Signed-in
          users can also open it from the <strong>Cookie settings</strong>{" "}
          section on the Settings page.
        </li>
      </ul>

      <h2 className="text-2xl font-semibold mt-6 mb-3">Storage We Use</h2>
      <div className="overflow-x-auto rounded-md border border-white/10">
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-left">Category</th>
              <th className="px-3 py-2 text-left">Purpose</th>
              <th className="px-3 py-2 text-left">Duration</th>
              <th className="px-3 py-2 text-left">Provider</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-white/10">
              <td className="px-3 py-2 font-mono">league_analysis_auth_state</td>
              <td className="px-3 py-2">Cookie</td>
              <td className="px-3 py-2">Strictly necessary</td>
              <td className="px-3 py-2">
                Authentication hint used for route handling and signed-in UX.
              </td>
              <td className="px-3 py-2">30 days</td>
              <td className="px-3 py-2">First-party (League Analysis)</td>
            </tr>
            <tr className="border-t border-white/10">
              <td className="px-3 py-2 font-mono">
                league_analysis_access_token
              </td>
              <td className="px-3 py-2">Cookie (HttpOnly)</td>
              <td className="px-3 py-2">Strictly necessary</td>
              <td className="px-3 py-2">
                Stores the short-lived access token for authenticated API
                requests. JavaScript cannot read it.
              </td>
              <td className="px-3 py-2">Until logout or expiration</td>
              <td className="px-3 py-2">First-party (League Analysis)</td>
            </tr>
            <tr className="border-t border-white/10">
              <td className="px-3 py-2 font-mono">
                league_analysis_refresh_token
              </td>
              <td className="px-3 py-2">Cookie (HttpOnly)</td>
              <td className="px-3 py-2">Strictly necessary</td>
              <td className="px-3 py-2">
                Stores the refresh token for session continuity and rotation.
                JavaScript cannot read it.
              </td>
              <td className="px-3 py-2">Until logout or expiration</td>
              <td className="px-3 py-2">First-party (League Analysis)</td>
            </tr>
            <tr className="border-t border-white/10">
              <td className="px-3 py-2 font-mono">
                league_analysis_cookie_consent
              </td>
              <td className="px-3 py-2">Cookie</td>
              <td className="px-3 py-2">Strictly necessary</td>
              <td className="px-3 py-2">
                Stores your cookie preference choice and version.
              </td>
              <td className="px-3 py-2">180 days</td>
              <td className="px-3 py-2">First-party (League Analysis)</td>
            </tr>
            <tr className="border-t border-white/10">
              <td className="px-3 py-2 font-mono">header_messages_closed:v1</td>
              <td className="px-3 py-2">Local storage</td>
              <td className="px-3 py-2">Optional preference</td>
              <td className="px-3 py-2">
                Remembers manually dismissed admin/header notices.
              </td>
              <td className="px-3 py-2">Persistent until deleted</td>
              <td className="px-3 py-2">First-party (League Analysis)</td>
            </tr>
            <tr className="border-t border-white/10">
              <td className="px-3 py-2 font-mono">
                league_analysis_match_history_page_size
              </td>
              <td className="px-3 py-2">Local storage</td>
              <td className="px-3 py-2">Optional preference</td>
              <td className="px-3 py-2">
                Remembers your selected Match History page size.
              </td>
              <td className="px-3 py-2">Persistent until deleted</td>
              <td className="px-3 py-2">First-party (League Analysis)</td>
            </tr>
            <tr className="border-t border-white/10">
              <td className="px-3 py-2 font-mono">
                league_analysis_match_history_queue_filters
              </td>
              <td className="px-3 py-2">Local storage</td>
              <td className="px-3 py-2">Optional preference</td>
              <td className="px-3 py-2">
                Remembers your selected Match History queue filters.
              </td>
              <td className="px-3 py-2">Persistent until deleted</td>
              <td className="px-3 py-2">First-party (League Analysis)</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 className="text-2xl font-semibold mt-6 mb-3">Third-Party Storage</h2>
      <p className="leading-relaxed">
        We do not currently set advertising cookies or analytics cookies. Some
        third-party integrations may place their own cookies when you interact
        with their widgets or services; those providers are responsible for
        their own cookie disclosures.
      </p>

      <h2 className="text-2xl font-semibold mt-6 mb-3">Policy Version</h2>
      <p className="leading-relaxed">
        Current cookie consent version: <strong>{COOKIE_CONSENT_VERSION}</strong>
      </p>
    </LegalPageShell>
  );
}
