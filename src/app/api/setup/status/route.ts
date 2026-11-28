import { handle } from "@/lib/server/http";
import { appCheckGate, payDeps, serverReady, verifyUser } from "@/lib/server/deps";
import { setupStatus } from "@/lib/server/payflow";

export const runtime = "nodejs";

/** First-run setup: does this signed-in person already have a PIN and a fingerprint? Booleans only. */
export async function POST(req: Request) {
  if (!serverReady()) return Response.json({ ok: false, reason: "server_not_set_up" }, { status: 503 });
  return handle(req, verifyUser, (userId) => setupStatus(payDeps(req), userId), appCheckGate());
}
