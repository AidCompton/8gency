// Team chat: channel types, emoji, @mentions and message formatting.
// Pure, so the browser renders exactly what the server stores.

export const CATEGORIES = [
  { key: "team", label: "Team", hint: "Everyone, all the time" },
  { key: "department", label: "Departments", hint: "Design, web, accounts…" },
  { key: "client", label: "Clients", hint: "One per client account" },
  { key: "project", label: "Projects", hint: "A launch, a pitch, a campaign" },
  { key: "event", label: "Events", hint: "Shoots, offsites, the year-end party" },
  { key: "social", label: "Social", hint: "Lunch, pets, playlists" },
] as const;
export type Category = (typeof CATEGORIES)[number]["key"];

export const CHANNEL_EMOJI = ["💬", "📣", "🎉", "☕", "🎨", "💻", "✍️", "📈", "🤝", "🚀", "📸", "🎬", "🗓️", "🍕", "🐶", "🎧", "🌍", "💡", "🔥", "🏆"];
export const REACTIONS = ["👍", "🎉", "❤️", "😂", "🙌", "🔥", "👀", "✅"];

/** The channels every agency starts with. */
export const DEFAULT_CHANNELS = [
  { name: "general", emoji: "📣", category: "team", topic: "Announcements, questions and everything in between." },
  { name: "wins", emoji: "🏆", category: "team", topic: "Approvals, launches, happy clients and kudos. Celebrate each other." },
  { name: "watercooler", emoji: "☕", category: "social", topic: "Weekends, lunch spots, playlists and pets." },
] as const;

/** What a conversation is called: the channel name, or the other people in a direct message. */
export const channelTitle = (c: { kind: string; name: string; people: { name: string }[] }) => (c.kind === "dm" ? c.people.map((p) => p.name).join(", ") || "Just you" : c.name);

/** Channel names: short, lowercase, hyphenated. */
export function channelName(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/^#/, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export interface Person {
  id: string;
  name: string;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "@Mia Botha" or "@Mia": the longest name wins, so two Mias can still be told apart by surname. */
function mentionPattern(people: Person[]) {
  const names = people.flatMap((p) => [p.name, p.name.split(" ")[0]]).filter(Boolean);
  const unique = [...new Set(names)].sort((a, b) => b.length - a.length);
  return unique.length ? new RegExp(`@(${unique.map(escape).join("|")})(?![\\p{L}\\p{N}])`, "giu") : null;
}

function personFor(name: string, people: Person[]) {
  const n = name.toLowerCase();
  const full = people.filter((p) => p.name.toLowerCase() === n);
  if (full.length) return full[0];
  const first = people.filter((p) => p.name.split(" ")[0].toLowerCase() === n);
  return first.length === 1 ? first[0] : null;
}

export function findMentions(body: string, people: Person[]): string[] {
  const re = mentionPattern(people);
  if (!re) return [];
  const ids = new Set<string>();
  for (const m of body.matchAll(re)) {
    const p = personFor(m[1], people);
    if (p) ids.add(p.id);
  }
  return [...ids];
}

export type Token =
  | { t: "text" | "bold" | "italic" | "code"; v: string }
  | { t: "link"; v: string }
  | { t: "mention"; v: string; id: string };

/** Split a message into formatted pieces: **bold**, _italic_, `code`, links and @mentions. Never HTML. */
export function tokenize(body: string, people: Person[]): Token[] {
  const mention = mentionPattern(people);
  const parts = new RegExp(`(\\*\\*[^*\\n]+\\*\\*|\\b_[^_\\n]+_\\b|\`[^\`\\n]+\`|https?:\\/\\/[^\\s<]+[^\\s<.,;:!?)\\]'"]${mention ? `|${mention.source}` : ""})`, "giu");
  const out: Token[] = [];
  let last = 0;
  for (const m of body.matchAll(parts)) {
    const s = m[0];
    const at = m.index ?? 0;
    if (at > last) out.push({ t: "text", v: body.slice(last, at) });
    if (s.startsWith("**")) out.push({ t: "bold", v: s.slice(2, -2) });
    else if (s.startsWith("_")) out.push({ t: "italic", v: s.slice(1, -1) });
    else if (s.startsWith("`")) out.push({ t: "code", v: s.slice(1, -1) });
    else if (s.startsWith("http")) out.push({ t: "link", v: s });
    else {
      const p = personFor(s.slice(1), people);
      out.push(p ? { t: "mention", v: s, id: p.id } : { t: "text", v: s });
    }
    last = at + s.length;
  }
  if (last < body.length) out.push({ t: "text", v: body.slice(last) });
  return out;
}
