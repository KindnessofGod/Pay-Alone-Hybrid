// Every money API route goes through handle():
// - the caller must send a Firebase sign-in token; the handler gets the VERIFIED user id, never one from the body
// - with App Check on, only our own web app can call (rule 14)
// - errors are logged by name only and answered without details, because a body can hold a PIN
// - answers are never cached
export type Verify = (idToken: string) => Promise<string>;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export type VerifyAppCheck = (appCheckToken: string) => Promise<void>;

/** appCheck: when given, the call must carry a valid App Check token (X-Firebase-AppCheck), or it is refused. */
export async function handle(
  req: Request,
  verify: Verify,
  fn: (userId: string, body: Record<string, unknown>) => Promise<unknown>,
  appCheck?: VerifyAppCheck,
): Promise<Response> {
  if (appCheck) {
    try {
      await appCheck(req.headers.get("x-firebase-appcheck") ?? "");
    } catch {
      return json(401, { ok: false, reason: "app_check" });
    }
  }
  const m = /^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "");
  let userId: string;
  try {
    if (!m) throw new Error("no token");
    userId = await verify(m[1]);
  } catch {
    return json(401, { ok: false, reason: "signed_out" });
  }
  let body: Record<string, unknown>;
  try {
    const b = await req.json();
    if (!b || typeof b !== "object" || Array.isArray(b)) throw new Error("not an object");
    body = b as Record<string, unknown>;
  } catch {
    return json(400, { ok: false, reason: "bad_request" });
  }
  try {
    return json(200, await fn(userId, body));
  } catch (e) {
    // Only our own setup errors are logged in full; they describe configuration, never a request.
    const setup = e instanceof Error && e.message.startsWith("FIREBASE_SERVICE_ACCOUNT") ? e.message : "";
    console.error("api error", e instanceof Error ? e.name : "unknown", setup);
    return json(500, { ok: false, reason: "server_error" });
  }
}
