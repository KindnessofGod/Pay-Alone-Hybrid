// The only path from spoken words to a payment proposal.
//
//   1. Spoken-secret tripwire (plain code, on the device). A PIN said aloud is thrown away here,
//      before any model or network sees it.
//   2. Route by policy (Remote Config): on-device model, cloud model, or no AI at all.
//      - The on-device model (Gemini Nano via Firebase AI Logic, ONLY_ON_DEVICE) gets the full sentence.
//      - The cloud model (Gemini via Firebase AI Logic, ONLY_IN_CLOUD) gets ONLY the redacted sentence.
//      - If the on-device model fails, we fall back to the cloud WITH redaction. This is why payment
//        intents do not use PREFER_ON_DEVICE: its automatic fallback would send the raw sentence.
//   3. The model's answer is reduced to three fields and checked by plain code (crosscheck.ts).
//   4. The result is a proposal that still needs the person's own approval. Nothing here can pay.
import { spokenSecret, type SecretKind } from "./tripwire";
import { redactForCloud } from "./redact";
import { validContactName } from "./contacts";
import { crossCheck, type AiIntent, type CheckReason, type Contact, type Proposal } from "./crosscheck";

export type Policy = "on_device_first" | "on_device_only" | "cloud_only" | "ai_off";
export type Route = "on_device" | "cloud" | "none";
export type Source = "on_device" | "cloud" | "rules";

export interface Engines {
  /** Throws if the on-device model is unavailable. Returns parsed JSON (or raw text). */
  onDevice: (prompt: string) => Promise<unknown>;
  cloud: (prompt: string) => Promise<unknown>;
}

export interface Context {
  contacts: Contact[];
  limitMinor: string;
  policy: Policy;
  deviceAvailable: boolean;
}

/** Why a path was not used, for the screen: "on-device: ..." or "online: ...". Never holds the sentence. */
type Skips = { skipped?: string[] };

export type Understood = Skips &
  (
  | { kind: "secret_spoken"; secret: SecretKind; source: "rules" }
  | { kind: "proposal"; proposal: Proposal; needsApproval: true; source: Source; sentToCloud?: string }
  | { kind: "rejected"; reason: Exclude<CheckReason, "not_send">; source: Source; sentToCloud?: string }
  | { kind: "intent"; action: string; source: Source; sentToCloud?: string }
  | { kind: "unclear"; source: Source; sentToCloud?: string }
  );

/** An error message with the person's words and any digits blanked, cut short. */
function reason(e: unknown, said: string): string {
  let m = (e instanceof Error ? `${e.name === "Error" ? "" : e.name + ": "}${e.message}` : String(e)).slice(0, 160);
  for (const w of said.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3)) m = m.replace(new RegExp(`\\b${w}\\b`, "giu"), "…");
  return m.replace(/\p{Nd}+/gu, "#");
}

const ACTIONS = ["send", "balance", "history", "repeat", "cancel", "help", "unclear"];

export function decideRoute(policy: Policy, deviceAvailable: boolean): Route {
  switch (policy) {
    case "on_device_first":
      return deviceAvailable ? "on_device" : "cloud";
    case "on_device_only":
      return deviceAvailable ? "on_device" : "none";
    case "cloud_only":
      return "cloud";
    default:
      return "none";
  }
}

/** Keep only the three fields a model may set. Returns null if the answer is not usable. */
export function toIntent(raw: unknown): AiIntent | null {
  let v = raw;
  if (typeof v === "string") {
    const m = v.match(/\{[\s\S]*\}/); // tolerate code fences or text around the JSON
    if (!m) return null;
    try {
      v = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.action !== "string" || !ACTIONS.includes(o.action)) return null;
  const amount = o.amountMinor;
  const amountMinor = typeof amount === "number" || typeof amount === "string" ? amount : null;
  const payee = typeof o.payee === "string" ? o.payee : null;
  return { action: o.action, amountMinor, payee };
}

/** No-AI reading: a send word, one saved name, and an amount. Used when AI is off or unavailable. */
export function rulesIntent(said: string, contacts: Contact[]): AiIntent {
  const named = contacts.filter((c) => new RegExp(`\\b${c.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(said));
  if (/\b(send|pay|give|transfer|abeg)\b/i.test(said)) return { action: "send", amountMinor: null, payee: named.length === 1 ? named[0].name : null };
  if (/\b(left|remain|balance|limit)\b/i.test(said)) return { action: "balance", amountMinor: null, payee: null };
  if (/\b(again|repeat)\b/i.test(said)) return { action: "repeat", amountMinor: null, payee: null };
  if (/\bhelp\b/i.test(said)) return { action: "help", amountMinor: null, payee: null };
  return { action: "unclear", amountMinor: null, payee: null };
}

export async function understand(said: string, input: Context, engines: Engines): Promise<Understood> {
  // Saved names are untrusted: any name that is not a plain name is dropped before anything else.
  const ctx = { ...input, contacts: input.contacts.filter((c) => validContactName(c.name)) };
  const secret = spokenSecret(said);
  if (secret.tripped) return { kind: "secret_spoken", secret: secret.kind ?? "pin", source: "rules" };

  let route = decideRoute(ctx.policy, ctx.deviceAvailable);
  let intent: AiIntent | null = null;
  let source: Source = "rules";
  let sentToCloud: string | undefined;
  let cloudContacts: string[] = [];
  const skipped: string[] = [];
  if ((ctx.policy === "on_device_first" || ctx.policy === "on_device_only") && !ctx.deviceAvailable) skipped.push("on-device: Gemini Nano not available on this computer");

  if (route === "on_device") {
    try {
      intent = toIntent(await engines.onDevice(said));
      if (!intent) skipped.push("on-device: answer was not usable JSON");
    } catch (e) {
      intent = null;
      skipped.push(`on-device: ${reason(e, said)}`);
    }
    // Unavailable or unusable on-device answer: fall back (cloud with redaction), or rules if on-device only.
    if (intent) source = "on_device";
    else route = ctx.policy === "on_device_only" ? "none" : "cloud";
  }
  if (route === "cloud") {
    const r = redactForCloud(said, ctx.contacts.map((c) => c.name));
    try {
      intent = toIntent(await engines.cloud(r.text));
      source = "cloud";
      sentToCloud = r.text;
      cloudContacts = r.contacts;
    } catch (e) {
      skipped.push(`online: ${reason(e, said)}`);
      route = "none";
    }
  }
  if (route === "none") intent = rulesIntent(said, ctx.contacts);

  const extra = { ...(sentToCloud !== undefined ? { sentToCloud } : {}), ...(skipped.length ? { skipped } : {}) };
  if (!intent || intent.action === "unclear") return { kind: "unclear", source, ...extra };
  if (intent.action !== "send") return { kind: "intent", action: intent.action, source, ...extra };

  const checked = crossCheck(intent, said, ctx.contacts, ctx.limitMinor, cloudContacts);
  if (!checked.ok) return { kind: "rejected", reason: checked.reason as Exclude<CheckReason, "not_send">, source, ...extra };
  return { kind: "proposal", proposal: checked.proposal, needsApproval: true, source, ...extra };
}
