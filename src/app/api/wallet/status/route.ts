import { handle } from "@/lib/server/http";
import { appCheckGate, serverReady, verifyUser } from "@/lib/server/deps";
import { walletStatus } from "@/lib/server/walletgrant";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

/** The signed-in person's own wallet connection and weekly limit, for the home screen. No tokens. */
export async function POST(req: Request) {
  if (!serverReady()) return Response.json({ ok: false, reason: "server_not_set_up" }, { status: 503 });
  return handle(req, verifyUser, (userId) => walletStatus(getStore(), userId), appCheckGate());
}
