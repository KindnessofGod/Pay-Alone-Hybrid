import { handle } from "@/lib/server/http";
import { appCheckGate, payDeps, serverReady, verifyUser } from "@/lib/server/deps";
import { passkeyRegister } from "@/lib/server/passkeyflow";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!serverReady()) return Response.json({ ok: false, reason: "server_not_set_up" }, { status: 503 });
  return handle(req, verifyUser, (userId, body) => passkeyRegister(payDeps(req), userId, body), appCheckGate());
}
