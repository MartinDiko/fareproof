# FareProof engineering instructions

FareProof is a local-first airfare evidence and verification product with two clients: a private Chrome Manifest V3 extension and a GitHub Pages reporting app. Both clients consume `@fareproof/core`; fare parsing, normalization, fingerprints, matching, and portable schemas belong there rather than in either UI.

Use strict TypeScript and validate every website, message, storage, and imported-JSON boundary with Zod. Keep scoring pure and deterministic. Website content is untrusted: never use `dangerouslySetInnerHTML`, `eval`, remotely hosted executable code, cookies, session tokens, payment data, or broad `<all_urls>` access.

Implement and test one site adapter at a time. Do not label an adapter supported until sanitized fixtures cover extraction and failure behavior. Prefer embedded JSON, accessibility attributes, semantic DOM, stable labels, visible text, then CSS selectors in that order.

The extension never purchases, submits passenger or payment details, bypasses CAPTCHA or bot controls, accepts terms, signs in, or claims a fare is guaranteed. Use evidence-stage language such as "search result reproduced", "fare survived selection", and "manual verification required".

All product data remains local unless a future user-configured integration explicitly says otherwise. The static Pages app has no backend; extension-to-web reporting uses the versioned FareProof export schema.

Before completing a change, run focused tests, strict typecheck, lint, and affected builds. UI changes also require a browser smoke check with no console errors. Keep diffs focused and record durable user decisions in `.github/instructions/confirmed-patterns.instructions.md`.