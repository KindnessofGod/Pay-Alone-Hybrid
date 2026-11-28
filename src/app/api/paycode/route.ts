import { handle } from "@/lib/server/http";
import { appCheckGate, serverReady, verifyUser } from "@/lib/server/deps";
import { getPayCode } from "@/lib/server/seller";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

/** The person's pay code (made on first call). It is not secret and not a PIN: it only lets a shop ask. */
export async function POST(req: Request) {
  if (!serverReady()) return Response.json({ ok: false, reason: "server_not_set_up" }, { status: 503 });
  return handle(req, verifyUser, async (userId) => ({ ok: true, code: await getPayCode(getStore(), userId) }), appCheckGate());
}
