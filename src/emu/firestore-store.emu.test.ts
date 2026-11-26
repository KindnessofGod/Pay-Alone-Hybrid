// Runs only against the Firestore emulator: npm run test:emu
import { describe, expect, it } from "vitest";
import { FirestoreStore } from "../lib/store/firestore";

const s = new FirestoreStore();
const c = `t${Date.now()}`;

describe("FirestoreStore (emulator)", () => {
  it("put, get, list, delete", async () => {
    await s.put(c, "a|1", { n: 1, nested: { v: "x" } });
    expect(await s.get(c, "a|1")).toEqual({ n: 1, nested: { v: "x" } });
    expect(await s.list(c)).toEqual([{ n: 1, nested: { v: "x" } }]);
    await s.delete(c, "a|1");
    expect(await s.get(c, "a|1")).toBeNull();
  });
  it("take returns a document once, even when two takes race", async () => {
    await s.put(c, "b", { n: 2 });
    const r = await Promise.all([s.take(c, "b"), s.take(c, "b"), s.take(c, "b")]);
    expect(r.filter(Boolean)).toEqual([{ n: 2 }]);
    expect(await s.get(c, "b")).toBeNull();
  });
  it("update counts every one of ten changes sent at the same moment", async () => {
    await s.put(c, "n", { count: 0 });
    await Promise.all(Array.from({ length: 10 }, () => s.update<{ count: number }, void>(c, "n", (cur) => ({ doc: { count: (cur?.count ?? 0) + 1 }, result: undefined }))));
    expect(await s.get(c, "n")).toEqual({ count: 10 });
  });
  it("ids with slashes cannot reach another collection", async () => {
    await s.put(c, "x/y", { n: 3 });
    expect(await s.get(c, "x/y")).toEqual({ n: 3 });
  });
});
