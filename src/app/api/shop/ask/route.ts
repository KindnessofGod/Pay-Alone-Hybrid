import { handle } from "@/lib/server/http";
import { appCheckGate, sellerDeps, serverReady, verifyUser } from "@/lib/server/deps";
import { isDemoContext } from "@/lib/server/demo";
import { createRequest } from "@/lib/server/seller";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!serverReady()) return Response.json({ ok: false, reason: "server_not_set_up" }, { status: 503 });
  // `demo: true` is honoured only when the call comes from our own /demo page (demo.ts); anywhere else it is refused.
  const demoAllowed = isDemoContext(req.url, req.headers.get("referer"));
  return handle(
    req,
    verifyUser,
    async (userId, body) => (body.demo === true && !demoAllowed ? { ok: false, reason: "demo_not_allowed" } : createRequest(sellerDeps(), userId, body, { demo: body.demo === true })),
    appCheckGate(),
  );
}
