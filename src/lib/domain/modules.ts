// Which parts of 8gency an agency uses. Anything not set takes the default.
// Pure, so the menu, the pages and the settings form agree.

export type ModuleKey = "chat" | "bookings" | "team" | "automations";

export const MODULES: { key: ModuleKey; label: string; hint: string }[] = [
  { key: "chat", label: "Chat", hint: "Team groups, direct messages and kudos." },
  { key: "bookings", label: "Book time", hint: "Anyone can book design and web time on a job." },
  { key: "team", label: "Team workload", hint: "Everyone's time by task, and who is taking on too much." },
  { key: "automations", label: "Automations", hint: "When something happens, notify people, message the client or create a task." },
];

export interface ModuleSettings {
  chat: boolean;
  bookings: boolean;
  team: boolean;
  automations: boolean;
  /** loose: a booking needs a job and a time. strict: it must also fit the job's hours budget and a scope item. */
  booking_mode: "loose" | "strict";
}

export const DEFAULT_MODULES: ModuleSettings = { chat: true, bookings: true, team: true, automations: true, booking_mode: "loose" };

export function modulesOf(raw: unknown): ModuleSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const on = (k: ModuleKey) => (typeof r[k] === "boolean" ? (r[k] as boolean) : DEFAULT_MODULES[k]);
  return { chat: on("chat"), bookings: on("bookings"), team: on("team"), automations: on("automations"), booking_mode: r.booking_mode === "strict" ? "strict" : "loose" };
}
