import { handle } from "@/lib/server/http";
import { payDeps, serverReady, verifyUser } from "@/lib/server/deps";
import { startPayment } from "@/lib/server/payflow";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!serverReady()) return Response.json({ ok: false, reason: "server_not_set_up" }, { status: 503 });
  return handle(req, verifyUser, (userId, body) => startPayment(payDeps(req), userId, body));
}
