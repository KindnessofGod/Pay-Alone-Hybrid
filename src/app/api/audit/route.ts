import { handle } from "@/lib/server/http";
import { appCheckGate, serverReady, verifyUser } from "@/lib/server/deps";
import { recordClientEvent } from "@/lib/server/clientaudit";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

/** Browser-reported steps: a small fixed list only (clientaudit.ts). */
export async function POST(req: Request) {
  if (!serverReady()) return Response.json({ ok: false, reason: "server_not_set_up" }, { status: 503 });
  return handle(req, verifyUser, (userId, body) => recordClientEvent(getStore(), userId, body), appCheckGate());
}
