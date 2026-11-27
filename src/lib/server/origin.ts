// The app's own origin, used for the passkey relying party and the wallet finish URI.
// Never trust the request's Host: only an allowlisted origin is used, otherwise the first entry.
const DEFAULT_ORIGINS = ["https://usepayalone.tech", "https://pay-alone-hybrid.vercel.app", "http://localhost:3000"];

function originOf(s: string): string | null {
  try {
    const u = new URL(s.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

export function allowedOrigins(env: Record<string, string | undefined> = process.env): string[] {
  const raw = env.APP_ORIGINS?.trim();
  const list = (raw ? raw.split(",") : DEFAULT_ORIGINS).map(originOf).filter((o): o is string => !!o);
  return list.length ? list : DEFAULT_ORIGINS;
}

export function appOrigin(reqUrl: string, env: Record<string, string | undefined> = process.env): string {
  const list = allowedOrigins(env);
  const o = originOf(reqUrl);
  return o && list.includes(o) ? o : list[0];
}
