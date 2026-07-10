---
applyTo: "**"
description: FareProof decisions and user-confirmed implementation patterns.
---

# Confirmed patterns

## Extension first, reporting web app second
- **Confirmed:** 2026-07-10 — initial FareProof foundation request.
- **Rule:** Build airfare capture, normalized evidence, watch state, and verification behavior in the private Chrome extension first; expose the same shared domain and portable reporting data in the GitHub Pages app second.
- **Why:** The extension can observe browser-delivered ITA and retailer evidence, while the static web app provides a larger surface for local reporting and later features without pretending to have browser access it does not have.
- **Reference:** `packages/extension`, `packages/core`, and `packages/web`.

## Local-only static architecture
- **Confirmed:** 2026-07-10 — the user requested a private extension and a GitHub Pages companion modeled on port.
- **Rule:** Keep version-one fare data on the user's computer. Deploy only static assets to GitHub Pages and exchange extension data through a validated, versioned export bundle; do not add a remote backend by default.
- **Why:** This preserves the privacy boundary in the product specification and keeps deployment equivalent to the established port Pages workflow.
- **Reference:** `.github/workflows/deploy.yml` and `fareProofExportSchema`.

## Claim adapter support only with evidence
- **Confirmed:** 2026-07-10 — the prompt requires phased ITA, BookWithMatrix, airline, and OTA support with conservative verification.
- **Rule:** Display an adapter as supported only after its parser has sanitized fixtures and extraction tests; otherwise label it planned or manual. Preserve marketing and operating carrier identities separately at every handoff.
- **Why:** Airfare pages change frequently, and a same-physical-flight result can still be the wrong fare or ticketing channel.
- **Reference:** `packages/extension/src/content/adapter.ts` and the options screen.

## A scaffold is not fare-verification automation
- **Confirmed:** 2026-07-10 — Martin asked where the installable extension was that performed the automation in the specification after the initial foundation was presented as implemented.
- **Rule:** Do not describe FareProof as implementing the requested automation until a loadable extension has fixture-backed ITA capture, verification-site adapters, guided handoff, retailer observation, comparison, and notification behavior working end to end. A manifest, manual JSON import, storage, alarm shell, or adapter interface is foundation only and must be labeled that way.
- **Why:** The testable deliverable is the browser workflow, not project scaffolding or UI around deferred behavior.
- **Reference:** `prompt.txt` sections 7, 11–20, and 30; `packages/extension`.

## Requested default airfare policies
- **Confirmed:** 2026-07-10 — Martin specified the initial searches and asked for five-minute Matrix → BookWithMatrix → retailer validation with immediate alerts.
- **Rule:** Ship the five requested policies as editable extension defaults: YVR→FRA one way; YVR→SKG/TIA one way; both round trips leaving Sep 1–20 and returning 30–45 days later; and corresponding one-way returns 30–45 days after outbound. Default to two adults, CAD 1,600 per person, business/first on segments over six hours, economy allowed on shorter segments, and Canadian connections for the FRA policy. Run one bounded owned-tab workflow every five minutes while Chrome is available; validate Matrix's copied JSON, BookWithMatrix handoff, and retailer-visible route/flight/cabin/price before a high-confidence alert.
- **Why:** These are the user's actual booking constraints; price alone or a Matrix-only result is insufficient evidence.
- **Reference:** `defaultFareSearchPolicies`, `matchSearchPolicy`, and `packages/extension/src/background/serviceWorker.ts`.

## Mobile push is explicit opt-in
- **Confirmed:** 2026-07-10 — Martin requested browser, mobile, or other immediate notification channels.
- **Rule:** Browser notifications remain local and enabled by default. Mobile push may use only an explicitly configured user topic and optional host permission, with the external data disclosure stated in settings; do not add a FareProof backend by default.
- **Why:** A phone cannot receive local Chrome extension notifications when it is away from the computer; mobile delivery requires an external relay and must not silently cross the local-only privacy boundary.
- **Reference:** optional `ntfy.sh` permission and notification settings.

## Pages login mirrors port
- **Confirmed:** 2026-07-10 — Martin requested a simple encrypted login using the same pattern as the port project.
- **Rule:** Gate the static Pages dashboard in memory with port's PBKDF2-SHA-256/AES-GCM verifier and the same password; never persist the password or unlocked plaintext. Lock again on reload and state plainly that this is client-side obfuscation, not server authentication.
- **Why:** The lightweight gate keeps casual access consistent across Martin's private dashboards without adding a backend or overstating what static-site JavaScript can secure.
- **Reference:** `packages/web/src/auth.ts`, `packages/web/src/Login.tsx`, and `packages/web/scripts/encrypt-access.mjs`.

## Matrix failures are bounded and explicit
- **Confirmed:** 2026-07-10 — Martin reported Check now leaving Matrix on a spinner with `ERROR Object` in Google's bundled script.
- **Rule:** Treat Matrix's console `ERROR Object` as site-generated, not a FareProof exception. Initialize Matrix at `/search`, wait at most 60 seconds for calendar data, retry once with a fresh Matrix session, then stop the cycle and mark every affected policy as Matrix unavailable with its next retry time; never leave an owned tab spinning indefinitely or repeat every task during a site-wide failure.
- **Why:** Matrix can return HTTP 200 for its shell while its internal content RPC fails, including an unauthenticated user-info probe; bounded recovery makes the scheduler truthful and prevents one upstream outage from consuming an entire cycle.
- **Reference:** `retryMatrixCalendar` and `failMatrixRun` in `packages/extension/src/background/serviceWorker.ts`; `tests/e2e/extension-live.spec.ts`.

## Matrix candidates advance from visible results
- **Confirmed:** 2026-07-10 — Martin reported FareProof stopping on Matrix's Flights page and Matrix copied JSON being rejected by manual import.
- **Rule:** On Matrix Flights, publish usable itinerary links even while row-level progress indicators remain; rank eligible candidates by lowest per-person price and shortest duration as the tie-breaker, open the selected itinerary, capture Matrix's copied JSON, then continue through BookWithMatrix and each retailer. Manual import must accept the same authoritative Matrix copied-JSON shape.
- **Why:** Matrix keeps asynchronous row indicators after its result links are actionable, and its copied JSON is the most complete evidence source for codeshare, cabin, fare basis, passenger count, and total price.
- **Reference:** `extractMatrixFlights`, `rankMatrixFlightCandidates`, `parseImportedFare`, and `tests/e2e/extension.spec.ts`.

## Check now never fails silently
- **Confirmed:** 2026-07-10 — Martin reported clicking Check now doing nothing with no console error.
- **Rule:** Validate persisted run ownership and stage age on extension startup, every scheduler alarm, side-panel load, and Check now. Clear a run whose tab is missing or whose stage timeout expired; return and display a user-facing reason when a healthy run or runtime failure prevents a new check. Lock this with an unpacked-extension test seeded with stale durable state.
- **Why:** Manifest V3 workers and owned tabs can end independently, leaving syntactically valid storage that otherwise blocks both manual and automatic checks without an exception.
- **Reference:** `recoverScheduler`, `PolicyDashboard`, and `tests/e2e/extension.spec.ts`.

## Fare evidence is actionable only after retailer validation
- **Confirmed:** 2026-07-10 — Martin reported that a route, price, source, and generic "Fare detected" label did not provide enough information to understand or book the result.
- **Rule:** Show the latest fare's route, travel date, cabin, matched policy, per-person and total prices, traveler count, marketing and operating flight identities, fare identity, evidence source, check time, and confirmed or missing rules in the side panel. Offer a direct booking action only for an HTTPS retailer URL captured from complete retailer evidence with no missing validation rules; Matrix-only or incomplete evidence must show the next verification step without a booking link.
- **Why:** A detected Matrix price is not a booking-ready result. The user needs enough evidence to assess the fare and an observed retailer destination only after route, date, flight, cabin, and price survive validation.
- **Reference:** `FareEvidencePanel`, `buildFareEvidenceView`, and `tests/e2e/extension.spec.ts`.