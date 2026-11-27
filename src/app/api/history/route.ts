import { handle } from "@/lib/server/http";
import { appCheckGate, serverReady, verifyUser } from "@/lib/server/deps";
import { loadHistory } from "@/lib/server/history";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

/** POST (so the sign-in token is in a header, never a URL): the signed-in person's own receipts and activity. */
export async function POST(req: Request) {
  if (!serverReady()) return Response.json({ ok: false, reason: "server_not_set_up" }, { status: 503 });
  return handle(req, verifyUser, (userId) => loadHistory(getStore(), userId), appCheckGate());
}
