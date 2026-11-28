// The /demo page's animation state machine. Pure. The money token travels ONLY after a paid event, and a paid
// event comes from the server's own status or receipt, never from a button press or a timer.
import type { Amount } from "../money";
import { bigAmount } from "./amountview";

export type DemoStage = "idle" | "asked" | "approving" | "moving" | "done" | "declined" | "expired";
export type DemoState =
  | { stage: "idle" }
  | { stage: Exclude<DemoStage, "idle">; amount: Amount; ref: string };
export type DemoEvent =
  | { type: "asked"; amount: Amount; ref: string }
  | { type: "approving" }
  | { type: "stopped" }
  | { type: "paid" }
  | { type: "moveEnd" }
  | { type: "declined" }
  | { type: "expired" }
  | { type: "reset" };

export const initialDemo: DemoState = { stage: "idle" };
/** How long the token takes to cross. The CSS animation uses the same number. */
export const MOVE_MS = 1800;

export function stepDemo(s: DemoState, e: DemoEvent): DemoState {
  if (e.type === "reset") return initialDemo;
  if (e.type === "asked") return { stage: "asked", amount: e.amount, ref: e.ref };
  if (s.stage === "idle") return s;
  const keep = (stage: Exclude<DemoStage, "idle">): DemoState => ({ stage, amount: s.amount, ref: s.ref });
  switch (e.type) {
    case "approving":
      return s.stage === "asked" ? keep("approving") : s;
    case "stopped":
      return s.stage === "approving" ? keep("asked") : s;
    case "paid":
      return s.stage === "asked" || s.stage === "approving" ? keep("moving") : s;
    case "moveEnd":
      return s.stage === "moving" ? keep("done") : s;
    case "declined":
      return s.stage === "asked" || s.stage === "approving" ? keep("declined") : s;
    case "expired":
      return s.stage === "asked" || s.stage === "approving" ? keep("expired") : s;
  }
}

export const tokenText = (a: Amount): string => `${bigAmount(a)} →`;
