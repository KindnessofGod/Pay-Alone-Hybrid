import { gateway } from "@/lib/op";
import { realRail, serverReady } from "@/lib/server/deps";
import { appOrigin } from "@/lib/server/origin";
import { finishWalletConnect } from "@/lib/server/walletgrant";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

/** The wallet's consent page sends the browser here. The one-time state is what ties it to the person. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  let ok = false;
  try {
    if (serverReady() && realRail()) {
      ok = (
        await finishWalletConnect({
          store: getStore(),
          wallet: gateway("wallet"),
          state: u.searchParams.get("state") ?? "",
          interactRef: u.searchParams.get("interact_ref") ?? "",
          hash: u.searchParams.get("hash") ?? "",
        })
      ).ok;
    }
  } catch (e) {
    console.error("wallet callback error", e instanceof Error ? e.name : "unknown"); // name only, never details
  }
  return new Response(null, { status: 303, headers: { location: `${appOrigin(req.url)}/?wallet=${ok ? "connected" : "failed"}`, "cache-control": "no-store" } });
}
