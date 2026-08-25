/**
 * The Join Us message bounds, in the one place the form reads them from. The
 * API enforces each somewhere else -- the maximum in the OpenAPI document, the
 * minimum only in the service -- and
 * `tests/join-us-message-alignment.test.ts` holds these equal to both.
 */
export const JOIN_US_BODY_MIN_LENGTH = 300;
export const JOIN_US_BODY_MAX_LENGTH = 5000;
