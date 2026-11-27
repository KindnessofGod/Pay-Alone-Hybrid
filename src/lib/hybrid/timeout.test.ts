import { describe, expect, it, vi } from "vitest";
import { orAfter, failAfter } from "./timeout";

describe("timeouts: a browser feature that never answers must not freeze the app", () => {
  it("orAfter gives the real answer when it comes in time", async () => {
    expect(await orAfter(Promise.resolve("real"), 50, "fallback")).toBe("real");
  });

  it("orAfter gives the fallback when the answer never comes", async () => {
    vi.useFakeTimers();
    const p = orAfter(new Promise<string>(() => {}), 5000, "fallback");
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toBe("fallback");
    vi.useRealTimers();
  });

  it("orAfter gives the fallback when the promise fails", async () => {
    expect(await orAfter(Promise.reject(new Error("x")), 50, "fallback")).toBe("fallback");
  });

  it("failAfter throws a named timeout so the caller can fall back and say why", async () => {
    vi.useFakeTimers();
    const p = failAfter(new Promise<string>(() => {}), 8000, "Gemini Nano");
    const check = expect(p).rejects.toThrow("Gemini Nano did not answer in time");
    await vi.advanceTimersByTimeAsync(8000);
    await check;
    vi.useRealTimers();
  });

  it("failAfter passes the real answer and the real error through", async () => {
    expect(await failAfter(Promise.resolve(1), 50, "x")).toBe(1);
    await expect(failAfter(Promise.reject(new Error("boom")), 50, "x")).rejects.toThrow("boom");
  });
});
