import { handle } from "@/lib/server/http";
import { appCheckGate, sellerDeps, serverReady, verifyUser } from "@/lib/server/deps";
import { pendingFor } from "@/lib/server/seller";

export const runtime = "nodejs";

/** The signed-in person's open payment requests from shops. Polled every few seconds (there are no webhooks). */
export async function POST(req: Request) {
  if (!serverReady()) return Response.json({ ok: false, reason: "server_not_set_up" }, { status: 503 });
  return handle(req, verifyUser, async (userId) => ({ ok: true, requests: await pendingFor(sellerDeps(), userId) }), appCheckGate());
}
