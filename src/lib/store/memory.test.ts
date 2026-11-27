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

describe("store list() with a prefix, newest first and a limit", () => {
  async function filled() {
    const s = new MemoryStore();
    for (const id of ["u1|001|a", "u1|002|b", "u1|003|c", "u2|001|d", "u10|001|e"]) await s.put("c", id, { id });
    return s;
  }
  it("only ids that start with the prefix", async () => {
    const r = await (await filled()).list<{ id: string }>("c", { prefix: "u1|" });
    expect(r.map((x) => x.id)).toEqual(["u1|001|a", "u1|002|b", "u1|003|c"]);
  });
  it("newest first with a limit (ids sort by time)", async () => {
    const r = await (await filled()).list<{ id: string }>("c", { prefix: "u1|", newestFirst: true, limit: 2 });
    expect(r.map((x) => x.id)).toEqual(["u1|003|c", "u1|002|b"]);
  });
  it("no options lists everything, as before", async () => {
    expect(await (await filled()).list("c")).toHaveLength(5);
  });
});
