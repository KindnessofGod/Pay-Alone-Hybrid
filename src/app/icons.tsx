// Icons copied from the original Pay Alone app (src/components/ui.tsx). Decorative: always aria-hidden.
export type IconName = "shop" | "person" | "shield" | "finger" | "check" | "cross" | "clock" | "speaker" | "mic" | "back" | "stop" | "list" | "gear" | "home" | "code" | "lock";

const PATHS: Record<IconName, string> = {
  shop: "M3 9l1.5-5h15L21 9M3 9h18M3 9v11h18V9M8 20v-6h8v6",
  person: "M12 12a4 4 0 100-8 4 4 0 000 8zm-7 9a7 7 0 0114 0",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3zm-3 9l2 2 4-4",
  finger: "M7 11a5 5 0 0110 0v2M12 11v6M9 13v3a3 3 0 002 3M15 13v2a6 6 0 01-1 3M5 9a7 7 0 0114 0M4.5 15a9 9 0 001 3",
  check: "M5 12.5l4.5 4.5L19 7.5",
  cross: "M6 6l12 12M18 6L6 18",
  clock: "M12 21a9 9 0 100-18 9 9 0 000 18zm0-13v5l3 2",
  mic: "M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3zm-6-3a6 6 0 0012 0M12 18v3",
  speaker: "M4 9v6h4l5 4V5L8 9H4zm12-1a5 5 0 010 8m2.5-10.5a8.5 8.5 0 010 13",
  back: "M15 5l-7 7 7 7",
  stop: "M12 21a9 9 0 100-18 9 9 0 000 18zM8 8l8 8",
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  home: "M4 11.5L12 5l8 6.5V20h-5.5v-5.5h-5V20H4z",
  gear: "M12 15a3 3 0 100-6 3 3 0 000 6zm7.4-3a7.4 7.4 0 00-.1-1.3l2-1.6-2-3.4-2.4 1a7.5 7.5 0 00-2.2-1.3L14.4 2h-4l-.4 2.5a7.5 7.5 0 00-2.2 1.3l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 000 2.6l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 002.2 1.3l.4 2.5h4l.4-2.5a7.5 7.5 0 002.2-1.3l2.4 1 2-3.4-2-1.6c.1-.4.1-.9.1-1.3z",
  code: "M4 5h4M4 5v4M20 5h-4M20 5v4M4 19h4M4 19v-4M20 19h-4M20 19v-4M9 12h6",
  lock: "M7 11V8a5 5 0 0110 0v3M6 11h12v9H6zM12 15v2",
};

export function Icon({ name, size = 24, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}

const TINTS = ["#c3e88f", "#bfe6f5", "#f3dfe9", "#e4e1fb", "#fde7c8", "#d7f0e6"];
/** A round avatar from the person's initials. The tint is picked from the name, so it stays the same each time. */
export function Avatar({ name, size = 56, self = false }: { name: string; size?: number; self?: boolean }) {
  let h = 0;
  for (const c of name.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  return (
    <span className="avatar" aria-hidden="true" style={{ width: size, height: size, background: self ? "#fff" : TINTS[h % TINTS.length], fontSize: Math.round(size * 0.36) }}>
      {initials || "?"}
    </span>
  );
}
