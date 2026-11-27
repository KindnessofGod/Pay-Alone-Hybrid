import { gateway } from "@/lib/op";
import { appCheckGate, payerUrl, realRail, serverReady, verifyUser, weeklyCapMinor } from "@/lib/server/deps";
import { handle } from "@/lib/server/http";
import { startWalletConnect } from "@/lib/server/walletgrant";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!serverReady()) return Response.json({ ok: false, reason: "server_not_set_up" }, { status: 503 });
  return handle(
    req,
    verifyUser,
    async (userId) => {
      if (!realRail()) return { ok: false, reason: "server_not_set_up" };
      return startWalletConnect({
        store: getStore(),
        wallet: gateway("wallet"),
        payerUrl: payerUrl(),
        userId,
        origin: new URL(req.url).origin,
        capMinor: weeklyCapMinor(),
      });
    },
    appCheckGate(),
  );
}
