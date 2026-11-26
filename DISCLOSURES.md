# Disclosures

## AI assistance
Code is written with Claude Code (Anthropic), tests first, and reviewed and run by the entrant. The app's own AI runs on Firebase AI Logic only.

## Prior work
This repository was created on 26 Nov 2026, inside the #BuildHybridAI submission period (from 11 Nov 2026).
These files were ported from our earlier Pay Alone prototype (`KindnessofGod/cu-hackathon-payments`, written from 15 Nov 2026, also inside the period), with small changes:
- `src/lib/money.ts`, `money.test.ts`: amounts in integer minor units; spoken amounts to numbers.
- `src/lib/approval.ts`, `approval.test.ts`: single-use approval tied to one quote and amount.
- `src/lib/passkey.ts`, `src/lib/secret.ts`: passkey (WebAuthn) checks and signing helpers.
- `src/lib/interval.ts`, `interval.test.ts`: spending-limit intervals.
- `src/lib/op/*`: Open Payments client (official SDK) and a simulated wallet for tests.
- `src/lib/store/*`: small document store (Postgres store removed).
- `src/lib/voice/sentences.ts`, `src/lib/voice/intent.ts`, `intent.test.ts`: read-back sentences and keyword intents in 5 languages (non-English wording not yet checked by native speakers).
Everything under `src/lib/hybrid/`, `src/lib/firebase/` and `src/app/` is new for this entry.

## Simulated parts
Saved contacts on screen are test data. Payments use test money only (Interledger test wallet when connected). Nothing here moves real money.

## Dependencies
firebase (Apache-2.0), firebase-admin (Apache-2.0), next, react, react-dom (MIT), @interledger/open-payments (Apache-2.0), @simplewebauthn/browser and /server (MIT), vitest, typescript.
