# Pay Alone: speak it, approve it, the AI never moves your money

Voice payments for people who cannot use a banking screen: blind and low-vision people, elderly people, and people who cannot read. Entry for **#BuildHybridAI 2026** (Firebase AI Logic hybrid inference). Platform: **Web (desktop Chrome with Gemini Nano; any browser through the cloud path)**.

> Status, 26 Nov 2026 night: voice screen, hybrid router, spoken-PIN tripwire, cloud redaction and plain-code cross-check are built and tested (151 tests, including the red-team fixes). Approval (passkey or PIN) and the Open Payments test-wallet rail are next. Contacts on screen are simulated test data. Test money only.

## How Firebase AI Logic hybrid inference is used
| Task | Mode | Why | File |
|---|---|---|---|
| Understand a payment request (who, how much) | `InferenceMode.ONLY_ON_DEVICE` (Gemini Nano) | Names and amounts stay on the computer | `src/lib/firebase/engines.ts`, `src/lib/hybrid/understand.ts` |
| Same, when Nano is unavailable (phones, older PCs) | `InferenceMode.ONLY_IN_CLOUD` (`gemini-3.5-flash-lite`) with a **redacted** sentence | Reach everyone, without sending who or how much | `src/lib/hybrid/redact.ts`, `src/lib/hybrid/understand.ts` |
| Why not `PREFER_ON_DEVICE` for payments? | - | Its automatic fallback would send the raw sentence to the cloud. Our fallback redacts first. | `src/lib/hybrid/understand.ts` |
| Help questions (no personal data) | `InferenceMode.PREFER_ON_DEVICE` | Safe to let the SDK fall back | `src/lib/firebase/engines.ts` (`helpModel`) |
| Structured output | `onDeviceParams.promptOptions.responseConstraint` + cloud `responseSchema` | Model returns 3 fields only | `src/lib/firebase/engines.ts` |
| Which path answered | `result.response.inferenceSource` | Shown on screen and spoken | `src/lib/firebase/engines.ts`, `src/app/page.tsx` |
| Start Nano | `model.initializeDeviceModel()` on the first tap | Required user gesture | `src/lib/firebase/engines.ts` |
| Routing policy and limit | Remote Config `routing_policy`, `voice_limit_minor` | Change routing live, or switch AI off | `src/lib/firebase/client.ts` |
| Protect the cloud path | App Check (reCAPTCHA v3; debug token locally) | Required for AI Logic | `src/lib/firebase/client.ts` |

## Safety design (each one has tests)
1. **Spoken-PIN tripwire** runs first, in plain code, before any model or network call: `src/lib/hybrid/tripwire.ts` (+ test).
2. **Cloud redaction**: the cloud sees `send [AMOUNT] to [CONTACT_1]`, never digits, saved names or other names: `redact.ts` (+ test).
3. **Plain-code cross-check**: the model only suggests; amount is re-read by code, payee must be a saved contact the person said, limit enforced: `crosscheck.ts` (+ test).
4. **Template read-back**: model text is never spoken, so a model can never say money moved: `readback.ts` (+ test).
5. **AI cannot pay**: `understand()` returns a proposal that still needs approval; extra model fields are dropped: `understand.test.ts`.
6. **AI off still works**: Remote Config `routing_policy = ai_off` falls back to plain rules.
7. **The server approves, not the browser**: the server re-checks payee and amount, quotes, reads back the QUOTE, and checks the PIN itself (salted hash, 5 tries then a 15-minute lock, stored per user). Each approval is bound to one request, quote and amount and works once; a tap alone is refused; a payment is paid once even if the approval is sent twice: `src/lib/server/payflow.ts`, `src/lib/security/approve.ts` (+ tests).
8. **Firestore is server-only**: the rules deny every browser read and write; only the server (Admin SDK) stores PINs, pending payments and receipts. Rules and API are tested on the Firebase emulators: `firestore.rules`, `src/emu/` (`npm run test:emu`).
9. **"No" means no**: "No, don't send it" cancels; a spoken "yes" only asks for the PIN: `src/lib/hybrid/confirm.ts` (+ test).

## What is real and what is simulated
| Part | Status |
|---|---|
| Voice understanding (Nano on-device, Gemini online with redaction, plain rules) | Implemented |
| PIN tripwire, redaction, cross-check, template read-back | Implemented |
| Server-checked PIN approval, receipts written by the server to Firestore | Implemented |
| Contacts (Mama Ade, Tunde, Chidi Okafor) | **Simulated** test list |
| Wallet connection and weekly spending limit (Open Payments grant, consent on the wallet's own page) | Implemented in code and unit-tested with fake wallets; **live only when the `RECEIVER_*` and `PAYER_*` keys are set**, otherwise not available |
| Quote and payment on the Interledger test wallet (USD test money; the naira amount is converted at the CBN rate of 16 Nov, display only; all three contacts pay one receiver wallet) | Implemented for the real rail when both wallets are configured; **Simulated** (no money moves, receipt says SIMULATED) when they are not |
| Windows Hello / phone passkey approval | Planned (server check written and tested; screen not wired) |

## Judge quick test
1. Open the live URL in desktop Chrome, press **Start**, then press Space and say "send five thousand naira to Mama Ade". Or type it.
2. The badge says whether Gemini Nano on your computer or Gemini online understood it, and shows exactly what the cloud received.
3. Say "my PIN is one two three four": it is stopped and deleted before any AI sees it.

## Run locally
`npm install`, copy `.env.example` to `.env.local` and fill it in, then `npm run dev`. Tests: `npm test`. Emulator tests (Firestore rules, store, API; needs Java): `npm run test:emu`.

## Licence and disclosures
Apache-2.0 (see `LICENSE`). Prior work and AI assistance: `DISCLOSURES.md`.
