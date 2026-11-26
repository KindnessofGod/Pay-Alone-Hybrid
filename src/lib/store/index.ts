// Small document store. Everything the server remembers goes through this interface.
// Local runs use a JSON file. The deployed app will use Firestore (Admin SDK) behind the same interface.
// Ported from our earlier Pay Alone prototype (see DISCLOSURES.md); the Postgres store was dropped.
import { FileStore } from "./file";

export interface Store {
  get<T>(collection: string, id: string): Promise<T | null>;
  put<T>(collection: string, id: string, doc: T): Promise<void>;
  delete(collection: string, id: string): Promise<void>;
  /** Get a document and delete it in one step. Two takes of the same document: only one gets it. */
  take<T>(collection: string, id: string): Promise<T | null>;
  list<T>(collection: string): Promise<T[]>;
}

let store: Store | undefined;

export function getStore(): Store {
  if (!store) store = new FileStore();
  return store;
}
