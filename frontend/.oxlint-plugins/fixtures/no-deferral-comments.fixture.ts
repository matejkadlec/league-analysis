// Regression fixture for `house/no-deferral-comments`.

// Every directive below sits above a comment the rule MUST report and the
// accepted cases carry none, so narrowing and widening both fail the run.

// oxlint-disable-next-line house/no-deferral-comments
// TODO wire the retry path
export const retryPath = 1;

// oxlint-disable-next-line house/no-deferral-comments
// FIXME breaks on an empty roster
export const emptyRoster = 2;

// oxlint-disable-next-line house/no-deferral-comments
// XXX the queue id is guessed here
export const guessedQueue = 3;

// oxlint-disable-next-line house/no-deferral-comments
// a hacky sort until the index exists
export const sortOrder = 4;

// oxlint-disable-next-line house/no-deferral-comments
// for now the blob comes from cache
export const cachedBlob = 5;

// oxlint-disable-next-line house/no-deferral-comments
// temporary while the ingest job lands
export const ingestBridge = 6;

// oxlint-disable-next-line house/no-deferral-comments
// stopgap while the queue drains
export const drainGuard = 7;

// oxlint-disable-next-line house/no-deferral-comments
// band-aid over the missing index
export const missingIndex = 8;

// oxlint-disable-next-line house/no-deferral-comments
// quick fix ahead of the release
export const releasePatch = 9;

// oxlint-disable-next-line house/no-deferral-comments
// good enough for one season of data
export const oneSeason = 10;

// oxlint-disable-next-line house/no-deferral-comments
// for the demo we skip validation
export const skipValidation = 11;

// oxlint-disable-next-line house/no-deferral-comments
// in a real app this would paginate
export const unpaginated = 12;

// oxlint-disable-next-line house/no-deferral-comments
// improve this later
export const promisedRework = 13;

// oxlint-disable-next-line house/no-deferral-comments
// follow-up PR adds the cache
export const promisedCache = 14;

// Accepted -- "later" with no deferring verb in front of it is ordinary prose.
// resolves later than the first paint
export const paintOrder = 15;

// Accepted -- the word boundary keeps a longer word out of the family.
// hackathon fixtures live under e2e/
export const eventFixtures = 16;

// Accepted -- "temporal" only looks like the banned word.
// a temporal join across both tables
export const temporalJoin = 17;

// Accepted -- only comments are read, so a marker held as data is untouched.
export const markerLabel = "TODO: rendered in the queue table";
