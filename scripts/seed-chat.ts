// Demo team chat for the seed: a few days of everyday conversation, kudos and
// reactions, a client group and a DM, so chat doesn't open on an empty room.
import { withTenant, type Tx } from "../src/lib/db";
import { createChannel, ensureDefaults, openDirect, sendMessage, toggleReaction } from "../src/lib/services/chat";

type People = Record<string, string>;
const NAMES: Record<string, string> = {
  owner: "Lerato Dlamini", pieter: "Pieter van Wyk", ayesha: "Ayesha Patel", sipho: "Sipho Ndlovu", jess: "Jess Naidoo",
  kabelo: "Kabelo Mahlangu", mia: "Mia Botha", ruan: "Ruan Smit", zanele: "Zanele Khumalo", tom: "Tom Fischer",
};

export async function seedChat(agencyId: string, people: People, velaId: string) {
  const as = <T>(who: string, fn: (tx: Tx) => Promise<T>) => withTenant({ agencyId, userId: people[who], actorLabel: NAMES[who] }, fn);
  const channel = (name: string) => as("owner", async (tx) => (await tx.one<{ id: string }>("select id from chat_channels where name = $1", [name]))!.id);
  /** Post, then set the clock back so the history reads like a normal few days. */
  const post = async (who: string, where: string, body: string, minutesAgo: number, opts: { kudos?: boolean; reactions?: [string, string[]][] } = {}) => {
    const id = await as(who, (tx) => sendMessage(tx, where, body, opts.kudos ? "kudos" : "message"));
    await as("owner", (tx) => tx.q("update chat_messages set created_at = now() - make_interval(mins => $2), updated_at = now() - make_interval(mins => $2) where id = $1", [id, minutesAgo]));
    for (const [emoji, by] of opts.reactions ?? []) for (const p of by) await as(p, (tx) => toggleReaction(tx, id, emoji));
  };

  await as("owner", (tx) => ensureDefaults(tx));
  const general = await channel("general");
  const wins = await channel("wins");
  const cooler = await channel("watercooler");
  const vela = await as("jess", (tx) =>
    createChannel(tx, { name: "vela-health", topic: "Vela: the launch, the guidelines and day-to-day", emoji: "🤝", category: "client", private: false, company_id: velaId, members: [people.sipho, people.kabelo, people.mia, people.ruan] }),
  );
  const day = 24 * 60;
  // The starter channels and the client group date from a few days back.
  await as("owner", (tx) => tx.q("update chat_messages set created_at = now() - interval '3 days', updated_at = now() - interval '3 days' where kind = 'system'"));

  await post("owner", general, "Morning all ☀️ Big week: the Vela launch goes live Thursday and Karoo's site is in final QA. If you're stretched, shout and we'll move things around.", 2 * day + 40, {
    reactions: [["👍", ["jess", "sipho", "kabelo", "zanele"]], ["🙌", ["mia", "tom"]]],
  });
  await post("pieter", general, "Gentle reminder: timesheets by Friday 4pm 🙏 Connect your calendar under Connectors and your client meetings fill themselves in.", day + 210, { reactions: [["✅", ["ruan", "mia"]]] });
  await post("sipho", general, "@Jess Vela approved the key visual in the first round! 🎉", day + 30, { reactions: [["🎉", ["owner", "jess", "kabelo", "mia"]]] });
  await post("jess", vela, "The 15s pre-roll cut-down is in Scope Guard as a change request. @Sipho can you nudge Priya for approval?", day + 20);
  await post("sipho", vela, "On it, sending it with today's status update.", day + 5, { reactions: [["👍", ["jess"]]] });
  await post("sipho", wins, "Kudos to @Kabelo Mahlangu and @Mia Botha: Vela signed off the poster series in one round. Priya called it \"exactly us\".", 22 * 60, {
    kudos: true,
    reactions: [["🎉", ["owner", "jess", "zanele", "tom"]], ["❤️", ["ruan"]], ["🔥", ["pieter"]]],
  });
  await post("tom", cooler, "Who's in for Friday lunch at the market? 🌮", 300, { reactions: [["🙌", ["ruan", "mia", "zanele"]]] });
  await post("ruan", cooler, "In. Also taking playlist submissions for the studio speaker 🎧", 280);
  await post("jess", wins, "Huge thanks @Zanele for rescuing the Karoo booking widget on Sunday. Legend 🙌", 95, { kudos: true, reactions: [["🙌", ["owner", "kabelo"]]] });
  const dm = await as("jess", (tx) => openDirect(tx, [people.owner]));
  await post("jess", dm, "Have you got 10 minutes after stand-up to talk Q4 capacity?", 45);

  // Everyone has caught up, except the owner, who has a little waiting for them.
  await as("owner", async (tx) => {
    await tx.q("update chat_members set last_read_seq = (select coalesce(max(seq), 0) from chat_messages m where m.channel_id = chat_members.channel_id)");
    await tx.q("update chat_members set last_read_seq = 0 where user_id = $1 and channel_id = any($2)", [people.owner, [wins, dm]]);
  });
}
