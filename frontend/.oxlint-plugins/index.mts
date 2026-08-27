// The one plugin oxlint loads, and the only place a house rule is registered.
// Rule IDs are `house/<key>`; `../oxlint.config.mts` decides where each runs.

import { meaningfulTestsRule } from "./meaningful-tests.mts";
import { noCompatShimsRule } from "./no-compat-shims.mts";
import { noDeferralCommentsRule } from "./no-deferral-comments.mts";
import { noRawJsonParseRule } from "./no-raw-json-parse.mts";
import { noLongCommentsRule } from "./no-long-comments.mts";
import { noSpreadInputInQueryKeyRule } from "./no-spread-input-in-query-key.mts";
import { requireCnForClassnameCompositionRule } from "./require-cn-for-classname-composition.mts";
import { requireFetchTimeoutRule } from "./require-fetch-timeout.mts";
import { requireQueryKeyFactoryRule } from "./require-query-key-factory.mts";
import { requireQuerySignalRule } from "./require-query-signal.mts";
import {
  edgeIsolationSyntaxRule,
  sessionTeardownSyntaxRule,
} from "./restricted-syntax.mts";

export default {
  meta: { name: "house" },
  rules: {
    "edge-isolation-syntax": edgeIsolationSyntaxRule,
    "meaningful-tests": meaningfulTestsRule,
    "no-compat-shims": noCompatShimsRule,
    "no-deferral-comments": noDeferralCommentsRule,
    "no-raw-json-parse": noRawJsonParseRule,
    "no-long-comments": noLongCommentsRule,
    "no-spread-input-in-query-key": noSpreadInputInQueryKeyRule,
    "require-cn-for-classname-composition":
      requireCnForClassnameCompositionRule,
    "require-fetch-timeout": requireFetchTimeoutRule,
    "require-query-key-factory": requireQueryKeyFactoryRule,
    "require-query-signal": requireQuerySignalRule,
    "session-teardown-syntax": sessionTeardownSyntaxRule,
  },
};
