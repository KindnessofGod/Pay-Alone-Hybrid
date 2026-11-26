# CLAUDE.md

Pay Alone hybrid: entry for #BuildHybridAI 2026 (Firebase AI Logic hybrid inference). Deadline Mon 30 Nov 2026, 2 PM PT (11 PM Lagos); submit by 6 PM Lagos.

## Rules
1. **Tests first.** For every module: write the test, see it fail, then write the code.
2. The AI never approves, pays, or confirms money. Model output is reduced to `{action, amountMinor, payee}` and checked by plain code (`src/lib/hybrid/crosscheck.ts`).
3. The cloud model only receives redacted text (`src/lib/hybrid/redact.ts`). Never call the cloud with a raw sentence.
4. The spoken-PIN tripwire runs before any model or network call.
5. Read-back and receipts are templates from our own data, never model text.
6. Money is integer minor units. No floats.
7. Never fabricate results. Label anything simulated (UI, README, video).
8. No secrets in git. Firebase config and keys come from env (`.env.example`).
9. Keep `README.md` "How Firebase AI Logic is used" table and `DISCLOSURES.md` current.
