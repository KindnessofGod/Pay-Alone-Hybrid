// "Recent customers" on the shop page: pay codes this browser asked before. Codes only, never names or amounts.
const MAX = 5;

export const digitsOf = (v: string): string => v.replace(/\D/g, "");

export function addRecent(list: string[], code: string): string[] {
  const d = digitsOf(code);
  if (d.length !== 6) return list;
  return [d, ...list.filter((c) => c !== d)].slice(0, MAX);
}

export function parseRecents(text: string | null): string[] {
  if (!text) return [];
  try {
    const v: unknown = JSON.parse(text);
    return Array.isArray(v) ? v.filter((c): c is string => typeof c === "string" && /^\d{6}$/.test(c)).slice(0, MAX) : [];
  } catch {
    return [];
  }
}
