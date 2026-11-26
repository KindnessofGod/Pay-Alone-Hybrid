// In-memory store for tests. Every method body runs without awaiting, so each call is atomic.
import type { Store } from "./index";

export class MemoryStore implements Store {
  private data = new Map<string, Map<string, unknown>>();
  private col(c: string) {
    let m = this.data.get(c);
    if (!m) this.data.set(c, (m = new Map()));
    return m;
  }
  async get<T>(c: string, id: string) {
    const v = this.col(c).get(id);
    return v === undefined ? null : (structuredClone(v) as T);
  }
  async put<T>(c: string, id: string, doc: T) {
    this.col(c).set(id, structuredClone(doc));
  }
  async delete(c: string, id: string) {
    this.col(c).delete(id);
  }
  async take<T>(c: string, id: string) {
    const v = this.col(c).get(id);
    this.col(c).delete(id);
    return v === undefined ? null : (v as T);
  }
  async list<T>(c: string) {
    return [...this.col(c).values()].map((v) => structuredClone(v) as T);
  }
  /** Everything stored, for tests that check nothing secret was kept. */
  dump() {
    return Object.fromEntries([...this.data].map(([c, m]) => [c, Object.fromEntries(m)]));
  }
}
