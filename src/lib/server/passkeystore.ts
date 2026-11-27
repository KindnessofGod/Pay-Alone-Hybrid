// Where passkeys live: one document per user holding a small list. Server side only.
import type { StoredPasskey } from "../passkey";
import type { Store } from "../store";

export interface PasskeyDoc {
  list: StoredPasskey[];
}

export async function storedPasskeys(store: Store, userId: string): Promise<StoredPasskey[]> {
  return (await store.get<PasskeyDoc>("passkeys", userId))?.list ?? [];
}

/** After a passkey approval: keep the signature counter the device reported, so an old signature cannot be reused. */
export async function saveCounter(store: Store, userId: string, passkeyId: string, newCounter: number): Promise<void> {
  await store.update<PasskeyDoc, void>("passkeys", userId, (cur) => {
    if (!cur) return { doc: null, result: undefined };
    return { doc: { list: cur.list.map((p) => (p.id === passkeyId && newCounter > p.counter ? { ...p, counter: newCounter } : p)) }, result: undefined };
  });
}
