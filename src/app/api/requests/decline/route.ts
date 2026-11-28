import { handle } from "@/lib/server/http";
import { appCheckGate, sellerDeps, serverReady, verifyUser } from "@/lib/server/deps";
import { declineRequest } from "@/lib/server/seller";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!serverReady()) return Response.json({ ok: false, reason: "server_not_set_up" }, { status: 503 });
  return handle(req, verifyUser, (userId, body) => declineRequest(sellerDeps(), userId, body.id), appCheckGate());
}
