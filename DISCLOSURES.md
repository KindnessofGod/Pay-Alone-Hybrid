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
- `src/lib/op/hash.ts`, `src/lib/server/walletgrant.ts`, `src/lib/server/opdeps.ts` and `src/app/api/wallet/*`: the one-time wallet connection (grant request, interaction-hash check, token sealing) and the quote/pay wiring follow the earlier prototype's wallet setup, callback and send routes, rewritten for this app's store and tests.
Everything under `src/lib/hybrid/`, `src/lib/firebase/` and `src/app/` is new for this entry.

## Simulated parts
Saved contacts on screen are test data. Payments use test money only (Interledger test wallet when connected). Nothing here moves real money.

## Dependencies
firebase (Apache-2.0), firebase-admin (Apache-2.0), next, react, react-dom (MIT), @interledger/open-payments (Apache-2.0), @simplewebauthn/browser and /server (MIT), vitest, typescript, kokoro-js (Apache-2.0; runs the Kokoro-82M voice model, Apache-2.0, on the device; the model is downloaded once, about 90 MB, from Hugging Face `onnx-community/Kokoro-82M-v1.0-ONNX`; spoken text never leaves the computer).

## Gemini Live (default conversation engine)
Live is on by default; `?live=0` turns it off. Your voice is streamed to Google while it is on. A spoken PIN is detected from the transcript and ends the session at once, but the audio has already reached Google by then, so the app tells people to type the PIN, and the microphone to Live is closed during PIN entry. Our fixed money sentences are read aloud by the Live voice and checked word for word against our template, with our own voice as the fallback; the model never approves or moves money. Language picker: English, French, Spanish, Portuguese, Arabic, Hindi, Yoruba, Hausa. All non-English sentences in `src/lib/hybrid/languages.ts` were machine-translated by an AI assistant (Claude) and are NOT checked by native speakers. Verified with a WebSocket smoke test (greeting, exact read-back, French, Yoruba, Hausa); not yet verified with a real microphone and speakers.
