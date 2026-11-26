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
  list<T>(collection: string): Promise<T[]>;
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
