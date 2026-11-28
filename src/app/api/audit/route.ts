import { handle } from "@/lib/server/http";
import { appCheckGate, serverReady, verifyUser } from "@/lib/server/deps";
import { recordClientBatch, recordClientEvent } from "@/lib/server/clientaudit";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

/** Browser-reported steps: a small fixed list only (clientaudit.ts), one event or a batch {events: [...]} of up to 50. */
export async function POST(req: Request) {
  if (!serverReady()) return Response.json({ ok: false, reason: "server_not_set_up" }, { status: 503 });
  return handle(req, verifyUser, (userId, body) => ("events" in body ? recordClientBatch(getStore(), userId, body) : recordClientEvent(getStore(), userId, body)), appCheckGate());
}
