// Small document store. Everything the server remembers goes through this interface.
// Local runs use a JSON file. The deployed app uses Firestore (Admin SDK) behind the same interface.
// Ported from our earlier Pay Alone prototype (see DISCLOSURES.md); the Postgres store was dropped.
import { FileStore } from "./file";
import { FirestoreStore } from "./firestore";

export interface Store {
  get<T>(collection: string, id: string): Promise<T | null>;
  put<T>(collection: string, id: string, doc: T): Promise<void>;
  delete(collection: string, id: string): Promise<void>;
  /** Get a document and delete it in one step. Two takes of the same document: only one gets it. */
  take<T>(collection: string, id: string): Promise<T | null>;
  /**
   * Read, change and write one document as one step, so two updates at the same moment cannot both
   * start from the same old value. fn must not have side effects: Firestore may run it more than once.
   */
  update<T, R>(collection: string, id: string, fn: (cur: T | null) => { doc: T | null; result: R }): Promise<R>;
  /**
   * All documents of a collection, or with options: only ids starting with prefix, newest first (ids
   * sort by their time part, so newest = largest id) and at most limit documents.
   */
  list<T>(collection: string, opts?: ListOptions): Promise<T[]>;
}

export interface ListOptions {
  prefix?: string;
  newestFirst?: boolean;
  limit?: number;
}

/** The same rule for the memory and file stores. */
export function pickEntries<T>(entries: [string, unknown][], opts?: ListOptions): T[] {
  if (!opts) return entries.map(([, v]) => v as T);
  let e = entries.filter(([id]) => !opts.prefix || id.startsWith(opts.prefix));
  if (opts.newestFirst || opts.limit !== undefined) e = e.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (opts.newestFirst) e.reverse();
  if (opts.limit !== undefined) e = e.slice(0, opts.limit);
  return e.map(([, v]) => v as T);
}

let store: Store | undefined;

type Env = Record<string, string | undefined>;

export function storeKind(env: Env = process.env): "firestore" | "file" | "none" {
  if (env.FIREBASE_SERVICE_ACCOUNT || env.FIRESTORE_EMULATOR_HOST) return "firestore";
  return env.VERCEL ? "none" : "file";
}

export function getStore(): Store {
  if (store) return store;
  const kind = storeKind();
  if (kind === "none") throw new Error("No database: set FIREBASE_SERVICE_ACCOUNT in Vercel.");
  store = kind === "firestore" ? new FirestoreStore() : new FileStore();
  return store;
}
