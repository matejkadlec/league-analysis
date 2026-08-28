export const RIOT_CREDENTIAL_HEALTH_UPDATED_EVENT =
  "riot-credential-health-updated";

/** Ask mounted queries to reload the backend-owned credential-health state. */
export function notifyRiotCredentialHealthUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(RIOT_CREDENTIAL_HEALTH_UPDATED_EVENT));
  }
}
