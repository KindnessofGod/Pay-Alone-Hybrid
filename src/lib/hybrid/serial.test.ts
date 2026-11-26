import { describe, expect, it } from "vitest";
import { oneAtATime } from "./serial";

describe("oneAtATime: Chrome destroys the previous Nano session when a new one starts", () => {
  it("runs overlapping calls one after another, never together", async () => {
    let running = 0;
    let maxRunning = 0;
    const f = oneAtATime(async (x: number) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 10));
      running--;
      return x * 2;
    });
    expect(await Promise.all([f(1), f(2), f(3)])).toEqual([2, 4, 6]);
    expect(maxRunning).toBe(1);
  });
  it("a failed call does not block the next one", async () => {
    const f = oneAtATime(async (x: number) => {
      if (x === 1) throw new Error("boom");
      return x;
    });
    const [a, b] = await Promise.allSettled([f(1), f(2)]);
    expect(a.status).toBe("rejected");
    expect(b).toEqual({ status: "fulfilled", value: 2 });
  });
});
