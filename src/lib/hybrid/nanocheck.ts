// The Gemini Nano double-check on every Gemini Live payment. After the plain-code check passes and before the
// Approve card opens, the person's own transcript is read again by Gemini Nano ON THIS DEVICE (Firebase AI Logic,
// ONLY_ON_DEVICE). The cloud is never used for this check. Nano must read the same amount and the same person as
// Live proposed. It never approves anything: it can only stop a card from opening, or add a label to it.
//   agree       Nano read the same {amountMinor, payeeId}.
//   mismatch    Nano read something different: no card, the person is asked to say it again.
//   unavailable Nano is missing, busy, too slow (DEVICE_CHECK_MS), failed, or gave no usable reading: the card
//               opens on the plain-code check alone and is honestly marked "rules".
import type { Contact } from "./crosscheck";
import { understand, type Engines, type Understood } from "./understand";
import { orAfter } from "./timeout";

export const DEVICE_CHECK_MS = 4_000;

export type DeviceCheckResult = { result: "agree" | "mismatch" | "unavailable"; source: "on_device" | "rules" };
export type LiveProposal = { amountMinor: string; payeeId: string };

/** Pure: compare Live's proposal with what Nano understood. Only an answer made on the device counts. */
export function decideDeviceCheck(live: LiveProposal, nano: Understood | "unavailable" | "timeout"): DeviceCheckResult {
  const unavailable: DeviceCheckResult = { result: "unavailable", source: "rules" };
  if (nano === "unavailable" || nano === "timeout") return unavailable;
  if (nano.kind !== "proposal" || nano.source !== "on_device") return unavailable;
  const same = nano.proposal.amountMinor === live.amountMinor && nano.proposal.payeeId === live.payeeId;
  return { result: same ? "agree" : "mismatch", source: "on_device" };
}

export interface DeviceCheckDeps {
  contacts: Contact[];
  limitMinor: string;
  live: LiveProposal;
  deviceAvailable: boolean;
  engines: Pick<Engines, "onDevice" | "cloud" | "onDeviceBusy">;
  timeoutMs?: number;
}

/** Runs the transcript through understand() restricted to the device (policy on_device_only, no instant shortcut). */
export async function runDeviceCheck(said: string, d: DeviceCheckDeps): Promise<DeviceCheckResult> {
  if (!d.deviceAvailable || d.engines.onDeviceBusy?.()) return decideDeviceCheck(d.live, "unavailable");
  const cloudNever = async (): Promise<unknown> => {
    throw new Error("the device check never uses the cloud");
  };
  const out = await orAfter<Understood | "timeout">(
    understand(
      said,
      { contacts: d.contacts, limitMinor: d.limitMinor, policy: "on_device_only", deviceAvailable: true, instant: false },
      { onDevice: d.engines.onDevice, cloud: cloudNever, onDeviceBusy: d.engines.onDeviceBusy },
    ),
    d.timeoutMs ?? DEVICE_CHECK_MS,
    "timeout",
  );
  return decideDeviceCheck(d.live, out);
}
