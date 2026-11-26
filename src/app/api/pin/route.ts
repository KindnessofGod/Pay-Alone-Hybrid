import { handle } from "@/lib/server/http";
import { payDeps, serverReady, verifyUser } from "@/lib/server/deps";
import { setUserPin } from "@/lib/server/payflow";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!serverReady()) return Response.json({ ok: false, reason: "server_not_set_up" }, { status: 503 });
  return handle(req, verifyUser, (userId, body) => setUserPin(payDeps(req), userId, body));
}
