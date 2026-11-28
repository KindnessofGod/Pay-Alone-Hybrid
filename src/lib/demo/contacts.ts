// SIMULATED test contacts until the saved-contacts screen exists. Shared by the page and the server,
// so the server re-checks the payee against the same list the person sees.
export const DEMO_CONTACTS = [
  { id: "c1", name: "Mama Ade" },
  { id: "c2", name: "Tunde" },
  { id: "c3", name: "Chidi Okafor" },
] as const;

/** How the live voice should say each saved name (plain letters, stress in capitals). A new contact can carry one too. */
export const CONTACT_PRONUNCIATION: Record<string, string> = {
  Tunde: "TOON-day",
  "Mama Ade": "MAH-mah AH-day",
  "Chidi Okafor": "CHEE-dee oh-KAH-for",
};
