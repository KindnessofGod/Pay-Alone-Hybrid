import { handle } from "@/lib/server/http";
import { appCheckGate, sellerDeps, serverReady, verifyUser } from "@/lib/server/deps";
import { shopStatus } from "@/lib/server/seller";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!serverReady()) return Response.json({ ok: false, reason: "server_not_set_up" }, { status: 503 });
  return handle(req, verifyUser, (userId, body) => shopStatus(sellerDeps(), userId, body.id), appCheckGate());
}
