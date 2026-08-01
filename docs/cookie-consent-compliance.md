# Cookie Consent Compliance Notes (EU)

> **Authority:** Compliance baseline and implementation boundary for browser
> cookies/storage and authenticated consent persistence.
>
> **Maintenance:** Re-review when storage keys, purposes, consent UX,
> persistence, policy disclosures, or the legal baseline changes.

Last reviewed: February 10, 2026

This document captures the legal baseline used for the League Analysis cookie-consent implementation.

## Primary Legal Baseline

1. ePrivacy Directive 2002/58/EC, Article 5(3) (as amended by Directive 2009/136/EC)
2. GDPR consent standards (Articles 4(11), 7; Recital 32)
3. CJEU Planet49 judgment (C-673/17)
4. EDPB guidance and Cookie Banner Taskforce report

## Requirements Implemented

### 1) Prior consent for non-essential cookies/storage

- Rule: non-essential storage requires consent before setting/reading.
- Exemption: storage strictly necessary for transmission or a user-requested service can be used without prior consent.

Implementation:
- Strictly necessary only by default.
- Optional storage keys are blocked until `Accept all`.

### 2) Freely given, specific, informed, unambiguous consent

- Rule: consent must be an affirmative action, and users must be informed.
- No implied consent by inactivity.

Implementation:
- Explicit first-layer buttons:
  - `Accept necessary`
  - `Accept all`
- No pre-ticked optional consent.

### 3) Reject path on first layer

- EDPB taskforce reports broad enforcement view that missing first-layer reject is non-compliant in most cases.

Implementation:
- `Accept necessary` is a direct reject of non-essential storage on the first layer.

### 4) No pre-ticked boxes

- Planet49 and EDPB: pre-checked consent is invalid.

Implementation:
- Optional storage is disabled by default.

### 5) Easy withdrawal/change

- GDPR/EDPB: withdrawing consent must be as easy as giving it.

Implementation:
- Persistent global `Cookie settings` button reopens preferences at any time.

### 6) Clear information including duration and third-party access

- Planet49: users must be informed about cookie duration and third-party access.

Implementation:
- `/cookie-policy` includes key name, purpose, category, duration, and provider.

## Data Model / Technical Notes

- Browser decision key: `league_analysis_cookie_consent` (source of truth for display)
- Consent versioning: `v1`
- Authenticated audit persistence: `auth.user_cookie_consents`
- API:
  - `GET /api/v1/settings/user/cookie-consent`
  - `PUT /api/v1/settings/user/cookie-consent`

## Current Storage Classification

- Strictly necessary:
  - `league_analysis_auth_state`
  - `auth_access_token`
  - `auth_refresh_token`
  - `league_analysis_cookie_consent`
- Optional preference:
  - `header_messages_closed`

## Important Caveat

ePrivacy rules are implemented via national laws and enforcement practice can vary by EU/EEA country. This implementation follows EU-level baseline and widely enforced DPA positions, but legal counsel is still recommended for country-specific production rollout.

## Sources

- ePrivacy Directive Article 5(3):
  https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=celex%3A02002L0058-20091219
- GDPR text (EUR-Lex):
  https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng
- EDPB Guidelines 05/2020 on consent:
  https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-052020-consent-under-regulation-2016679_en
- EDPB Cookie Banner Taskforce report:
  https://www.edpb.europa.eu/system/files/2023-01/edpb_03-2023_report_of_the_work_undertaken_by_the_cookie_banner_taskforce_en.pdf
- CJEU Planet49 case overview:
  https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A62017CJ0673
- CNIL practical guidance on refusing cookies:
  https://www.cnil.fr/en/cookies-and-other-tracking-devices-cnil-publishes-new-guidelines-and-recommendations
- Irish DPC cookies guidance (strictly necessary exemptions):
  https://www.dataprotection.ie/en/organisations/cookies
