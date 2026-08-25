/**
 * The Join Us message bounds, in the one place the form reads them from. The
 * API enforces the maximum in its OpenAPI document and the minimum only in the
 * service; `tests/join-us-message-alignment.test.ts` holds these equal.
 */
export const JOIN_US_BODY_MIN_LENGTH = 300;
export const JOIN_US_BODY_MAX_LENGTH = 5000;
