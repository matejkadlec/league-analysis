/**
 * The Join Us message bounds, in the one place the form reads them from.
 *
 * Both are enforced by the API too, in two different places: the maximum is a
 * `max_length` on `JoinUsContactRequest.body`, so it reaches the OpenAPI
 * document, while the minimum is `JOIN_US_MIN_BODY_LENGTH` in the service and
 * reaches nothing. `tests/join-us-message-alignment.test.ts` reads each from
 * wherever it actually lives and holds these equal to it.
 */
export const JOIN_US_BODY_MIN_LENGTH = 300;
export const JOIN_US_BODY_MAX_LENGTH = 5000;
