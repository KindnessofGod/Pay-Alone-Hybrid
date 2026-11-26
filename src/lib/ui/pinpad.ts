// The on-screen PIN pad. The PIN lives only in this component's state until it is sent, and a
// screen reader hears how many digits were typed, never the digits.
const WORDS = ["no digits", "one digit", "two digits", "three digits", "four digits", "five digits", "six digits"];

export function pinPress(pin: string, key: string): string {
  if (key === "back") return pin.slice(0, -1);
  if (key === "clear") return "";
  if (/^\d$/.test(key) && pin.length < 6) return pin + key;
  return pin;
}

export function pinAnnouncement(pin: string): string {
  return `${WORDS[Math.min(pin.length, 6)]} typed`;
}
