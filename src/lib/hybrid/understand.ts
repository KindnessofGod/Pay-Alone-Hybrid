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

export type Understood =
  | { kind: "secret_spoken"; secret: SecretKind; source: "rules" }
  | { kind: "proposal"; proposal: Proposal; needsApproval: true; source: Source; sentToCloud?: string }
  | { kind: "rejected"; reason: Exclude<CheckReason, "not_send">; source: Source; sentToCloud?: string }
  | { kind: "intent"; action: string; source: Source; sentToCloud?: string }
  | { kind: "unclear"; source: Source; sentToCloud?: string };

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
    try {
      v = JSON.parse(v);
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
  let raw: unknown;
  let source: Source = "rules";
  let sentToCloud: string | undefined;
  let cloudContacts: string[] = [];

  if (route === "on_device") {
    try {
      raw = await engines.onDevice(said);
      source = "on_device";
    } catch {
      route = ctx.policy === "on_device_only" ? "none" : "cloud";
    }
  }
  if (route === "cloud") {
    const r = redactForCloud(said, ctx.contacts.map((c) => c.name));
    sentToCloud = r.text;
    cloudContacts = r.contacts;
    try {
      raw = await engines.cloud(r.text);
      source = "cloud";
    } catch {
      route = "none";
      sentToCloud = undefined;
      cloudContacts = [];
    }
  }

  const intent = route === "none" ? rulesIntent(said, ctx.contacts) : toIntent(raw);
  const extra = sentToCloud !== undefined ? { sentToCloud } : {};
  if (!intent || intent.action === "unclear") return { kind: "unclear", source, ...extra };
  if (intent.action !== "send") return { kind: "intent", action: intent.action, source, ...extra };

  const checked = crossCheck(intent, said, ctx.contacts, ctx.limitMinor, cloudContacts);
  if (!checked.ok) return { kind: "rejected", reason: checked.reason as Exclude<CheckReason, "not_send">, source, ...extra };
  return { kind: "proposal", proposal: checked.proposal, needsApproval: true, source, ...extra };
}
