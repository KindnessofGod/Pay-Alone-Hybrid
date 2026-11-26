import { describe, expect, it } from "vitest";
import { MemoryStore } from "./memory";

describe("store take()", () => {
  it("returns a document once and removes it", async () => {
    const s = new MemoryStore();
    await s.put("c", "a", { n: 1 });
    expect(await s.take("c", "a")).toEqual({ n: 1 });
    expect(await s.take("c", "a")).toBeNull();
    expect(await s.get("c", "a")).toBeNull();
  });
  it("two takes at the same moment: only one wins", async () => {
    const s = new MemoryStore();
    await s.put("c", "a", { n: 1 });
    const r = await Promise.all([s.take("c", "a"), s.take("c", "a")]);
    expect(r.filter(Boolean)).toHaveLength(1);
  });
});
