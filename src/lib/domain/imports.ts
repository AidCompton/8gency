// Matching rules for pulling work in from other tools (Toggl, Trello): which
// client a project belongs to, what a card's list means, how long an entry was.
// Pure, so they're tested without any network.

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(pty|ltd|limited|inc|cc|co|company|the|and)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The existing client that a project or board name most likely belongs to, or null. */
export function suggestClient(label: string, clients: { id: string; name: string }[], hint = ""): string | null {
  for (const text of [hint, label]) {
    const t = norm(text);
    if (!t) continue;
    const exact = clients.find((c) => norm(c.name) === t);
    if (exact) return exact.id;
  }
  const t = norm(`${hint} ${label}`);
  // A client whose whole name appears in the label ("Vela Health launch" -> Vela Health), longest name first.
  const hit = [...clients].filter((c) => norm(c.name).length >= 3).sort((a, b) => norm(b.name).length - norm(a.name).length).find((c) => ` ${t} `.includes(` ${norm(c.name)} `));
  return hit?.id ?? null;
}

export type CardStatus = "todo" | "in_progress" | "blocked" | "waiting_client" | "done";

/** What a Trello card's list says about progress. A completed due date always means done. */
export function cardStatus(listName: string, dueComplete: boolean): CardStatus {
  if (dueComplete) return "done";
  const l = listName.toLowerCase();
  if (/\b(done|complete|completed|delivered|live|launched|published|shipped|approved|finished|archive)\b/.test(l)) return "done";
  if (/\b(blocked|on hold|stuck|waiting on us)\b/.test(l)) return "blocked";
  if (/\b(client|waiting|feedback|review|approval)\b/.test(l)) return "waiting_client";
  if (/\b(doing|in progress|progress|wip|working|started|build|design|dev)\b/.test(l)) return "in_progress";
  return "todo";
}

/** Seconds to hours at two decimals; running timers (negative seconds) and zero are not time. */
export function entryHours(seconds: number): number {
  return seconds > 0 ? Math.round(seconds / 36) / 100 : 0;
}

/** The calendar date of an instant in the agency's time zone, so late-evening work stays on its day. */
export function localDate(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone });
}
