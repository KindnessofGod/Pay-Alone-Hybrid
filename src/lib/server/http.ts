// Every money API route goes through handle():
// - the caller must send a Firebase sign-in token; the handler gets the VERIFIED user id, never one from the body
// - errors are logged by name only and answered without details, because a body can hold a PIN
// - answers are never cached
export type Verify = (idToken: string) => Promise<string>;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function handle(req: Request, verify: Verify, fn: (userId: string, body: Record<string, unknown>) => Promise<unknown>): Promise<Response> {
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
    console.error("api error", e instanceof Error ? e.name : "unknown");
    return json(500, { ok: false, reason: "server_error" });
  }
}
