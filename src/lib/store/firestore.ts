// Firestore behind the Store interface. Server side only (Admin SDK); the Firestore rules deny all
// browser access, so only this code can read or write these documents.
// Credentials: FIREBASE_SERVICE_ACCOUNT holds the service account JSON (set in Vercel, never in git).
// Under the emulator (FIRESTORE_EMULATOR_HOST) no credentials are needed.
import { adminApp } from "../server/admin";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import type { Store } from "./index";

/** Document ids may not contain "/" or be "." or "..": encode every id the same way. */
const docId = (id: string) => `k_${encodeURIComponent(id)}`;

export class FirestoreStore implements Store {
  private db: Firestore = getFirestore(adminApp());

  async get<T>(collection: string, id: string): Promise<T | null> {
    const s = await this.db.collection(collection).doc(docId(id)).get();
    return s.exists ? (s.data() as T) : null;
  }
  async put<T>(collection: string, id: string, doc: T): Promise<void> {
    await this.db.collection(collection).doc(docId(id)).set(JSON.parse(JSON.stringify(doc)));
  }
  async delete(collection: string, id: string): Promise<void> {
    await this.db.collection(collection).doc(docId(id)).delete();
  }
  async take<T>(collection: string, id: string): Promise<T | null> {
    const ref = this.db.collection(collection).doc(docId(id));
    return this.db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (!s.exists) return null;
      tx.delete(ref);
      return s.data() as T;
    });
  }
  async update<T, R>(collection: string, id: string, fn: (cur: T | null) => { doc: T | null; result: R }): Promise<R> {
    const ref = this.db.collection(collection).doc(docId(id));
    return this.db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const { doc, result } = fn(s.exists ? (s.data() as T) : null);
      if (doc === null) {
        if (s.exists) tx.delete(ref);
      } else tx.set(ref, JSON.parse(JSON.stringify(doc)));
      return result;
    });
  }
  async list<T>(collection: string): Promise<T[]> {
    return (await this.db.collection(collection).get()).docs.map((d) => d.data() as T);
  }
}
