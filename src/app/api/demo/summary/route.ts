import { handle } from "@/lib/server/http";
import { appCheckGate, payerUrl, realRail, serverReady, verifyUser, weeklyCapMinor } from "@/lib/server/deps";
import { loadDemoSummary } from "@/lib/server/demo";
import { normalizeWalletUrl } from "@/lib/op/real";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

/** The /demo wallet cards: sums of THIS person's own records (paid demo requests, receipts). No balance exists to read. */
export async function POST(req: Request) {
  if (!serverReady()) return Response.json({ ok: false, reason: "server_not_set_up" }, { status: 503 });
  return handle(
    req,
    verifyUser,
    async (userId) => {
      const real = realRail();
      return loadDemoSummary(getStore(), userId, Date.now(), {
        cap: { value: String(weeklyCapMinor()), assetCode: process.env.WEEKLY_CAP_ASSET ?? "USD", assetScale: 2 },
        shopWallet: real ? normalizeWalletUrl(process.env.RECEIVER_WALLET_ADDRESS_URL ?? "") || null : null,
        customerWallet: real ? payerUrl() || null : null,
        simulated: !real,
      });
    },
    appCheckGate(),
  );
}
