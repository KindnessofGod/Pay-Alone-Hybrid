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

## Security requirements before submission (from /mnt/project-files/security/red-team-report.md)
10. Approval (passkey or PIN) is verified on the SERVER (`passkey.ts`, `approval.ts`). Never client-only.
11. Yes/no must be negation-safe ("No, don't send it" is a no). Do not port payalone `flow.js` `yesNo()`.
12. No default PIN. Per-user lockout, stored, not per call.
13. Payment speech uses on-device recognition (`processLocally`) or typing/keypad. Cloud speech only after an explicit opt-in the screen and voice explain. Help questions also go through redaction.
14. Firestore rules tests; receipts written only by the server; App Check enforced; no debug token in repo or bundle; AI Logic quota and budget alert set.
15. A PIN-leak test: a PIN never appears in logs, state, or any model/network call.
