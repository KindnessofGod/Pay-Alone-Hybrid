// Firestore rules: a browser, signed in or not, can read or write nothing. Only the server (Admin SDK) can.
import { describe, expect, it } from "vitest";
import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInAnonymously } from "firebase/auth";
import { connectFirestoreEmulator, doc, getDoc, getFirestore, setDoc, deleteDoc, collection, getDocs } from "firebase/firestore";
import { FirestoreStore } from "../lib/store/firestore";

const app = initializeApp({ projectId: "pay-alone-hybrid", apiKey: "emulator-only" }, "rules-test");
const db = getFirestore(app);
connectFirestoreEmulator(db, "127.0.0.1", 8085);
const auth = getAuth(app);
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });

describe("Firestore rules (emulator)", () => {
  it("a signed-in browser cannot read, list, write or delete any of our collections", async () => {
    const user = await signInAnonymously(auth);
    const server = new FirestoreStore();
    for (const col of ["pins", "pending", "challenges", "receipts"]) {
      await server.put(col, user.user.uid, { secret: "server-only" });
      await expect(getDoc(doc(db, col, user.user.uid))).rejects.toMatchObject({ code: "permission-denied" });
      await expect(getDocs(collection(db, col))).rejects.toMatchObject({ code: "permission-denied" });
      await expect(setDoc(doc(db, col, user.user.uid), { forged: true })).rejects.toMatchObject({ code: "permission-denied" });
      await expect(deleteDoc(doc(db, col, user.user.uid))).rejects.toMatchObject({ code: "permission-denied" });
    }
  });
});
