import { describe, expect, it, vi } from "vitest";
import { chatReply, createRateGuard, PERSONA, SAFE_FALLBACK, safeReply, type ChatEngines, type ChatTurn } from "./chat";

const contacts = [
  { id: "c1", name: "Mama Ade" },
  { id: "c2", name: "Tunde" },
];
const base = { contacts, policy: "on_device_first" as const, deviceAvailable: true };
const fake = (dev: string | Error, cld: string | Error = "Cloud says hello."): ChatEngines & { dev: ReturnType<typeof vi.fn>; cld: ReturnType<typeof vi.fn> } => {
  const d = vi.fn(async (_p: string) => { if (dev instanceof Error) throw dev; return dev; });
  const c = vi.fn(async (_p: string) => { if (cld instanceof Error) throw cld; return cld; });
  return { onDevice: d, cloud: c, dev: d, cld: c };
};

describe("safeReply: cleaning", () => {
  it("passes a plain short answer", () => expect(safeReply("Pay Alone lets you pay by voice.")).toEqual({ text: "Pay Alone lets you pay by voice.", guarded: false }));
  it("strips markdown, bullets and links", () => {
    const r = safeReply("**Hello** there!\n- first thing\n- second `thing`\n# Title\nSee [this](about) now");
    expect(r.guarded).toBe(false);
    expect(r.text).not.toMatch(/[*#`\[\]()]|^- /m);
    expect(r.text).toContain("Hello there!");
  });
  it("strips emojis", () => {
    const r = safeReply("Hello 😀 friend 👍🏽!");
    expect(r.text).toBe("Hello friend!");
  });
  it("cuts to 3 sentences", () => {
    const r = safeReply("One is here. Two is here. Three is here. Four is here. Five is here.");
    expect(r.text).toBe("One is here. Two is here. Three is here.");
  });
  it("cuts to 300 chars at a word", () => {
    const r = safeReply(`${"word ".repeat(100)}end`);
    expect(r.text.length).toBeLessThanOrEqual(300);
    expect(r.text).not.toMatch(/\swor$/);
  });
  it("empty after cleaning gives the fallback", () => expect(safeReply("😀 ** **")).toEqual({ text: SAFE_FALLBACK, guarded: true }));
});

describe("safeReply: rejects", () => {
  it.each([
    "I have sent 5 thousand naira to Tunde.",
    "Your payment is done.",
    "The money was transferred successfully.",
    "Payment approved. Thank you.",
    "I paid Tunde for you.",
    "Done, the naira is on its way. It was sent.",
  ])("money moved: %s", (t) => expect(safeReply(t)).toEqual({ text: SAFE_FALLBACK, guarded: true }));
  it.each([
    "Please tell me your PIN.",
    "What is your password?",
    "Say your card number slowly.",
    "Your PIN is safe with me.",
    "Give me the one-time code.",
    "Read the cvv on the back.",
  ])("PIN or card: %s", (t) => expect(safeReply(t)).toEqual({ text: SAFE_FALLBACK, guarded: true }));
  it.each([
    "Your number is 4826.",
    "It is 4 8 2 6.",
    "Try four eight two six.",
    "Send 5,000 naira.",
    "Call 08012345678.",
  ])("digits: %s", (t) => expect(safeReply(t)).toEqual({ text: SAFE_FALLBACK, guarded: true }));
  it.each([
    "Your balance is low.",
    "Your balance is 2 thousand naira.",
    "You have five thousand naira left.",
    "You have 300 naira.",
  ])("balance: %s", (t) => expect(safeReply(t)).toEqual({ text: SAFE_FALLBACK, guarded: true }));
  it.each(["Visit https://example.com now.", "Go to www.pay.ng please.", "Open pay.com today."])("url: %s", (t) =>
    expect(safeReply(t)).toEqual({ text: SAFE_FALLBACK, guarded: true }));
  it("a bad sentence after the first three is still rejected", () =>
    expect(safeReply("One. Two. Three. Your payment is done.").guarded).toBe(true));
});

describe("safeReply: allows normal explanations", () => {
  it.each([
    "You approve each payment by typing your PIN on the keypad.",
    "I can't see your balance, but I can help you send money.",
    "Pay Alone never sends money without your approval.",
    "Fees are small. Ask me anything you like.",
    "Say who to pay and how much, for example, send 5000 naira to Tunde.".replace("5000", "five thousand"),
  ])("%s", (t) => expect(safeReply(t).guarded).toBe(false));
});

describe("rate guard", () => {
  it("allows N per window then blocks, and recovers", () => {
    let now = 0;
    const g = createRateGuard(3, 60_000, () => now);
    expect([g.take(), g.take(), g.take(), g.take()]).toEqual([true, true, true, false]);
    now = 61_000;
    expect(g.take()).toBe(true);
  });
});

describe("chatReply", () => {
  const hist: ChatTurn[] = [];
  it("tripwire first: no engine call, no history leak", async () => {
    const e = fake("hi");
    const r = await chatReply(hist, "my pin is 4826", base, e);
    expect(r.kind).toBe("secret_spoken");
    expect(e.dev).not.toHaveBeenCalled();
    expect(e.cld).not.toHaveBeenCalled();
  });
  it("on-device first, with persona and recent history only (last 6)", async () => {
    const e = fake("Fees on Pay Alone are small.");
    const long: ChatTurn[] = Array.from({ length: 10 }, (_, i) => ({ who: i % 2 ? "app" : "you", text: `turn number ${String.fromCharCode(97 + i)}` }));
    const r = await chatReply(long, "how are fees", base, e);
    expect(r).toMatchObject({ kind: "reply", source: "on_device", text: "Fees on Pay Alone are small.", guarded: false });
    expect(e.cld).not.toHaveBeenCalled();
    const p = e.dev.mock.calls[0][0] as string;
    expect(p).toContain(PERSONA);
    expect(p).toContain("turn number j");
    expect(p).toContain("turn number e");
    expect(p).not.toContain("turn number d");
    expect(p).toContain("how are fees");
  });
  it("falls back to cloud with REDACTED history and sentence", async () => {
    const e = fake(new Error("Gemini Nano did not answer in time"), "Sure, I can help with that.");
    const h: ChatTurn[] = [{ who: "you", text: "I owe Tunde 5000 naira" }, { who: "app", text: "Who would you like to pay? You can say Mama Ade or Tunde." }];
    const r = await chatReply(h, "my uncle Bola called me on 08012345678 about Mama Ade", base, e);
    expect(r).toMatchObject({ kind: "reply", source: "cloud", text: "Sure, I can help with that." });
    const p = (e.cld.mock.calls[0][0] as string).replace(PERSONA, "");
    expect(p).not.toMatch(/Tunde|Mama|Ade|Bola|5000|0801|2345/);
    expect(p).toContain("[CONTACT_1]");
    expect(p).toContain("[AMOUNT]");
    if (r.kind === "reply") {
      expect(r.sentToCloud).toBeDefined();
      expect(r.sentToCloud).not.toMatch(/Tunde|Mama|Bola|5000/);
      expect(r.skipped?.[0]).toMatch(/^on-device: /);
    }
  });
  it("on-device unavailable: skipped is recorded and cloud answers", async () => {
    const e = fake("x");
    const r = await chatReply(hist, "tell me a story", { ...base, deviceAvailable: false }, e);
    expect(e.dev).not.toHaveBeenCalled();
    expect(r).toMatchObject({ kind: "reply", source: "cloud" });
    if (r.kind === "reply") expect(r.skipped).toEqual(["on-device: Gemini Nano not available on this computer"]);
  });
  it("on_device_only never uses the cloud", async () => {
    const e = fake(new Error("boom"));
    const r = await chatReply(hist, "hello friend", { ...base, policy: "on_device_only" }, e);
    expect(r.kind).toBe("none");
    expect(e.cld).not.toHaveBeenCalled();
  });
  it("cloud_only skips on-device; ai_off calls nothing", async () => {
    const e = fake("x");
    expect((await chatReply(hist, "hello friend", { ...base, policy: "cloud_only" }, e)).kind).toBe("reply");
    expect(e.dev).not.toHaveBeenCalled();
    const e2 = fake("x");
    expect((await chatReply(hist, "hello friend", { ...base, policy: "ai_off" }, e2)).kind).toBe("none");
    expect(e2.dev).not.toHaveBeenCalled();
    expect(e2.cld).not.toHaveBeenCalled();
  });
  it("both fail: none, with both reasons, no sentence in them", async () => {
    const e = fake(new Error("bad Zebulon"), new Error("net down Zebulon"));
    const r = await chatReply(hist, "Zebulon is my friend", base, e);
    expect(r.kind).toBe("none");
    if (r.kind === "none") {
      expect(r.skipped.length).toBe(2);
      expect(JSON.stringify(r)).not.toMatch(/Zebulon/);
    }
  });
  it("an empty on-device answer falls through to cloud", async () => {
    const e = fake("   ", "Hello from the cloud.");
    const r = await chatReply(hist, "hello there friend", base, e);
    expect(r).toMatchObject({ kind: "reply", source: "cloud" });
  });
  it("an unsafe model answer is replaced by the safe line (no second model call)", async () => {
    const e = fake("Done! I sent 5000 naira to Tunde.");
    const r = await chatReply(hist, "pay him", base, e);
    expect(r).toMatchObject({ kind: "reply", source: "on_device", text: SAFE_FALLBACK, guarded: true });
    expect(e.cld).not.toHaveBeenCalled();
  });
  it("rate guard stops cloud calls, then returns none", async () => {
    const e = fake(new Error("no nano"), "Fine.");
    const rate = createRateGuard(2, 60_000, () => 0);
    const out = [];
    for (let i = 0; i < 4; i++) out.push(await chatReply(hist, "hello friend", { ...base, rate }, e));
    expect(e.cld).toHaveBeenCalledTimes(2);
    expect(out.map((r) => r.kind)).toEqual(["reply", "reply", "none", "none"]);
    const last = out[3];
    if (last.kind === "none") expect(last.skipped.join(" ")).toMatch(/online: too many/);
  });
});

describe("examples", () => {
  it("how does it work", async () => {
    const e = fake("You say who to pay and how much. I read it back. Then you type your PIN on the keypad.");
    const r = await chatReply([], "how does this app work", base, e);
    expect(r).toMatchObject({ source: "on_device", guarded: false });
  });
});
