import type { Tx } from "../db";
import { CATEGORIES, channelName, DEFAULT_CHANNELS, findMentions, type Person } from "../domain/chat";
import { firstName } from "../domain/text";
import { notify, UserError } from "./core";

// Team chat. Public channels are open to everyone in the agency; private
// groups and direct messages only to their members. Messages carry a
// sequence number so open conversations can poll for what's new.

export interface ChatChannel {
  id: string;
  kind: "channel" | "dm";
  name: string;
  topic: string;
  emoji: string;
  category: string;
  private: boolean;
  company_id: string | null;
  company_name: string | null;
  is_default: boolean;
  created_by: string | null;
  member: boolean;
  members: number;
  unread: number;
  /** For DMs: the other people in it. */
  people: { id: string; name: string }[];
}

export interface ChatMessage {
  id: string;
  seq: number;
  user_id: string | null;
  user_name: string | null;
  kind: "message" | "kudos" | "system";
  body: string;
  mentions: string[];
  edited: boolean;
  deleted: boolean;
  created_at: string;
  reactions: { emoji: string; count: number; mine: boolean; names: string[] }[];
}

const MAX_BODY = 4000;

export const chatPeople = (tx: Tx) =>
  tx.q<Person & { title: string; online: boolean }>(
    "select id, name, title, coalesce(last_seen_at > now() - interval '5 minutes', false) as online from users where active order by name",
  );

/** Create the starter channels the first time anyone opens chat, and make sure everyone is in them. */
export async function ensureDefaults(tx: Tx) {
  for (const d of DEFAULT_CHANNELS) {
    const c = await tx.one<{ id: string }>(
      `insert into chat_channels (agency_id, name, emoji, category, topic, is_default) values ($1,$2,$3,$4,$5,true)
       on conflict (agency_id, lower(name)) where kind = 'channel' and archived_at is null do nothing returning id`,
      [tx.agencyId, d.name, d.emoji, d.category, d.topic],
    );
    if (c) {
      await tx.q("insert into chat_members (channel_id, user_id, agency_id) select $1, id, agency_id from users where active", [c.id]);
      if (d.name === "general") await systemMessage(tx, c.id, "Welcome to #general 👋 This is where the whole team talks. Say hi!");
    }
  }
  // New starters join the starter channels (and catch up from now, not from the beginning).
  await tx.q(
    `insert into chat_members (channel_id, user_id, agency_id, last_read_seq)
     select c.id, u.id, u.agency_id, coalesce((select max(seq) from chat_messages m where m.channel_id = c.id), 0)
       from chat_channels c join users u on u.active
      where c.is_default and c.archived_at is null and u.created_at > c.created_at
     on conflict do nothing`,
  );
}

async function systemMessage(tx: Tx, channelId: string, body: string) {
  await tx.q("insert into chat_messages (agency_id, channel_id, user_id, kind, body) values ($1,$2,$3,'system',$4)", [tx.agencyId, channelId, tx.userId, body]);
}

const CHANNEL_SQL = `
  select c.id, c.kind, c.name, c.topic, c.emoji, c.category, c.private, c.company_id, co.name as company_name, c.is_default, c.created_by,
         (me.user_id is not null) as member,
         (select count(*)::int from chat_members x where x.channel_id = c.id) as members,
         case when me.user_id is null then 0 else
           (select count(*)::int from chat_messages m where m.channel_id = c.id and m.seq > me.last_read_seq and m.deleted_at is null and m.user_id is distinct from $1 and m.kind <> 'system') end as unread,
         case when c.kind = 'dm' then coalesce((select json_agg(json_build_object('id', u.id, 'name', u.name) order by u.name)
                                                  from chat_members x join users u on u.id = x.user_id where x.channel_id = c.id and x.user_id <> $1), '[]') else '[]' end as people
    from chat_channels c
    left join chat_members me on me.channel_id = c.id and me.user_id = $1
    left join companies co on co.id = c.company_id
   where c.archived_at is null`;

/** Everything in someone's sidebar: channels they're in and their direct messages. */
export function sidebar(tx: Tx, userId: string) {
  return tx.q<ChatChannel>(`${CHANNEL_SQL} and me.user_id is not null order by c.kind, c.name`, [userId]);
}

/** Public channels to browse and join. */
export function browseChannels(tx: Tx, userId: string) {
  return tx.q<ChatChannel>(`${CHANNEL_SQL} and c.kind = 'channel' and not c.private order by c.name`, [userId]);
}

/** A channel the person may read: public channels, or ones they're a member of. */
export async function channelFor(tx: Tx, channelId: string, userId: string) {
  const c = await tx.one<ChatChannel>(`${CHANNEL_SQL} and c.id = $2`, [userId, channelId]);
  if (!c || (!c.member && (c.private || c.kind === "dm"))) throw new UserError("That conversation doesn't exist or is private.");
  return c;
}

export async function messages(tx: Tx, channelId: string, userId: string, o: { afterSeq?: number; beforeSeq?: number; since?: string; limit?: number } = {}) {
  const rows = await tx.q<Omit<ChatMessage, "reactions" | "edited" | "deleted"> & { edited_at: Date | null; deleted_at: Date | null }>(
    `select * from (
       select m.id, m.seq, m.user_id, u.name as user_name, m.kind, case when m.deleted_at is null then m.body else '' end as body, m.mentions,
              m.edited_at, m.deleted_at, m.created_at
         from chat_messages m left join users u on u.id = m.user_id
        where m.channel_id = $1
          and ($2::bigint is null or m.seq > $2 or ($4::timestamptz is not null and m.updated_at > $4))
          and ($3::bigint is null or m.seq < $3)
        order by m.seq desc limit $5) x
     order by seq`,
    [channelId, o.afterSeq ?? null, o.beforeSeq ?? null, o.since ?? null, o.limit ?? 60],
  );
  const reactions = rows.length
    ? await tx.q<{ message_id: string; emoji: string; user_id: string; name: string }>(
        "select r.message_id, r.emoji, r.user_id, u.name from chat_reactions r join users u on u.id = r.user_id where r.message_id = any($1) order by r.emoji",
        [rows.map((r) => r.id)],
      )
    : [];
  return rows.map(({ edited_at, deleted_at, ...m }): ChatMessage => {
    const mine = reactions.filter((r) => r.message_id === m.id);
    const emojis = [...new Set(mine.map((r) => r.emoji))];
    return {
      ...m,
      seq: Number(m.seq),
      created_at: new Date(m.created_at).toISOString(),
      edited: Boolean(edited_at),
      deleted: Boolean(deleted_at),
      reactions: emojis.map((e) => {
        const who = mine.filter((r) => r.emoji === e);
        return { emoji: e, count: who.length, mine: who.some((r) => r.user_id === userId), names: who.map((r) => r.name) };
      }),
    };
  });
}

export async function markRead(tx: Tx, channelId: string, userId: string, seq: number) {
  await tx.q("update chat_members set last_read_seq = greatest(last_read_seq, $3) where channel_id = $1 and user_id = $2", [channelId, userId, seq]);
}

export async function unreadTotal(tx: Tx, userId: string) {
  return (await tx.one<{ n: number }>(
    `select count(*)::int as n from chat_members me join chat_channels c on c.id = me.channel_id and c.archived_at is null
       join chat_messages m on m.channel_id = me.channel_id and m.seq > me.last_read_seq and m.deleted_at is null and m.user_id is distinct from me.user_id and m.kind <> 'system'
      where me.user_id = $1`,
    [userId],
  ))!.n;
}

/** Note someone is around (at most once a minute), for the green dots. */
export async function touchPresence(tx: Tx, userId: string) {
  await tx.q("update users set last_seen_at = now() where id = $1 and (last_seen_at is null or last_seen_at < now() - interval '1 minute')", [userId]);
}

const join = (tx: Tx, channelId: string, userIds: string[]) =>
  tx.q(
    `insert into chat_members (channel_id, user_id, agency_id, last_read_seq)
     select $1, u.id, u.agency_id, coalesce((select max(seq) from chat_messages where channel_id = $1), 0) from users u where u.id = any($2) and u.active
     on conflict do nothing`,
    [channelId, userIds],
  );

export async function sendMessage(tx: Tx, channelId: string, body: string, kind: "message" | "kudos" = "message") {
  const me = tx.userId!;
  const text = body.trim();
  if (!text) throw new UserError("Write a message first.");
  if (text.length > MAX_BODY) throw new UserError(`Keep messages under ${MAX_BODY} characters.`);
  const c = await channelFor(tx, channelId, me);
  if (!c.member) await join(tx, channelId, [me]);
  const people = await chatPeople(tx);
  const mentions = findMentions(text, people).filter((id) => id !== me);
  if (kind === "kudos" && !mentions.length) throw new UserError("Kudos needs someone to thank: @mention them.");
  const m = await tx.one<{ id: string; seq: number }>(
    "insert into chat_messages (agency_id, channel_id, user_id, kind, body, mentions) values ($1,$2,$3,$4,$5,$6) returning id, seq",
    [tx.agencyId, channelId, me, kind, text, mentions],
  );
  await markRead(tx, channelId, me, Number(m!.seq));

  const where = c.kind === "dm" ? "a message" : `#${c.name}`;
  const href = `/app/chat/${channelId}`;
  const snippet = text.length > 140 ? `${text.slice(0, 140)}…` : text;
  // Only tell people who can actually open the conversation.
  const readers = new Set((await tx.q<{ user_id: string }>("select user_id from chat_members where channel_id = $1", [channelId])).map((r) => r.user_id));
  const canRead = (id: string) => !c.private && c.kind === "channel" ? true : readers.has(id);
  const notifyIds = c.kind === "dm" ? [...readers].filter((id) => id !== me) : mentions.filter(canRead);
  await notify(tx, notifyIds, {
    kind: kind === "kudos" ? "kudos" : "chat",
    title: kind === "kudos" ? `${tx.actorLabel} gave you kudos 🎉` : c.kind === "dm" ? `${firstName(tx.actorLabel)} sent you ${where}` : `${firstName(tx.actorLabel)} mentioned you in ${where}`,
    body: snippet,
    href,
    dedupe: `chat:${m!.id}`,
  });
  return m!.id;
}

async function ownMessage(tx: Tx, messageId: string, managerOk = false, isManager = false) {
  const m = await tx.one<{ user_id: string | null; channel_id: string; kind: string; deleted_at: Date | null }>("select user_id, channel_id, kind, deleted_at from chat_messages where id = $1", [messageId]);
  if (!m || m.deleted_at) throw new UserError("That message no longer exists.");
  await channelFor(tx, m.channel_id, tx.userId!);
  if (m.kind === "system" || (m.user_id !== tx.userId && !(managerOk && isManager))) throw new UserError("You can only change your own messages.");
  return m;
}

export async function editMessage(tx: Tx, messageId: string, body: string) {
  const text = body.trim();
  if (!text) throw new UserError("A message can't be empty. Delete it instead.");
  if (text.length > MAX_BODY) throw new UserError(`Keep messages under ${MAX_BODY} characters.`);
  await ownMessage(tx, messageId);
  const mentions = findMentions(text, await chatPeople(tx)).filter((id) => id !== tx.userId);
  await tx.q("update chat_messages set body = $2, mentions = $3, edited_at = now(), updated_at = now() where id = $1", [messageId, text, mentions]);
}

/** Authors delete their own messages; owners and ops can remove anyone's. */
export async function deleteMessage(tx: Tx, messageId: string, isManager: boolean) {
  await ownMessage(tx, messageId, true, isManager);
  await tx.q("update chat_messages set deleted_at = now(), updated_at = now() where id = $1", [messageId]);
  await tx.q("delete from chat_reactions where message_id = $1", [messageId]);
}

export async function toggleReaction(tx: Tx, messageId: string, emoji: string) {
  if (!emoji || emoji.length > 16) throw new UserError("Pick an emoji.");
  const m = await tx.one<{ channel_id: string; deleted_at: Date | null }>("select channel_id, deleted_at from chat_messages where id = $1", [messageId]);
  if (!m || m.deleted_at) throw new UserError("That message no longer exists.");
  await channelFor(tx, m.channel_id, tx.userId!);
  const removed = await tx.q("delete from chat_reactions where message_id = $1 and user_id = $2 and emoji = $3 returning 1", [messageId, tx.userId, emoji]);
  if (!removed.length) await tx.q("insert into chat_reactions (message_id, user_id, agency_id, emoji) values ($1,$2,$3,$4)", [messageId, tx.userId, tx.agencyId, emoji]);
  await tx.q("update chat_messages set updated_at = now() where id = $1", [messageId]);
}

export async function createChannel(
  tx: Tx,
  input: { name: string; topic?: string; emoji?: string; category: string; private: boolean; company_id?: string | null; members?: string[] },
) {
  const name = channelName(input.name);
  if (name.length < 2) throw new UserError("Give the group a name (2+ letters).");
  if (!CATEGORIES.some((c) => c.key === input.category)) throw new UserError("Choose what kind of group it is.");
  if (await tx.one("select 1 from chat_channels where kind = 'channel' and archived_at is null and lower(name) = $1", [name])) throw new UserError(`#${name} already exists. Join it, or pick another name.`);
  const c = await tx.one<{ id: string }>(
    "insert into chat_channels (agency_id, name, topic, emoji, category, private, company_id, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id",
    [tx.agencyId, name, (input.topic ?? "").trim().slice(0, 250), input.emoji || "💬", input.category, input.private, input.company_id || null, tx.userId],
  );
  await join(tx, c!.id, [tx.userId!, ...(input.members ?? [])]);
  await systemMessage(tx, c!.id, `${tx.actorLabel} created #${name}${input.topic ? `: ${input.topic.trim()}` : ""}. Say hi 👋`);
  await tx.audit("chat.channel_created", "chat_channel", c!.id, undefined, { name, private: input.private, category: input.category });
  return c!.id;
}

/** Find or start a direct conversation with one or more people. */
export async function openDirect(tx: Tx, others: string[]) {
  const me = tx.userId!;
  const ids = [...new Set([me, ...others])].sort();
  if (ids.length < 2) throw new UserError("Choose who to message.");
  if (ids.length > 9) throw new UserError("Group messages are for up to 8 people. Make a group channel for more.");
  const valid = await tx.q<{ id: string }>("select id from users where id = any($1) and active", [ids]);
  if (valid.length !== ids.length) throw new UserError("Someone in that list isn't on the team any more.");
  const key = ids.join(",");
  const existing = await tx.one<{ id: string }>("select id from chat_channels where dm_key = $1", [key]);
  if (existing) return existing.id;
  const c = await tx.one<{ id: string }>("insert into chat_channels (agency_id, kind, private, dm_key, emoji, created_by) values ($1,'dm',true,$2,'💬',$3) returning id", [tx.agencyId, key, me]);
  await join(tx, c!.id, ids);
  return c!.id;
}

export async function joinChannel(tx: Tx, channelId: string) {
  const c = await channelFor(tx, channelId, tx.userId!);
  if (c.kind !== "channel") throw new UserError("That's a private conversation.");
  await join(tx, channelId, [tx.userId!]);
}

export async function leaveChannel(tx: Tx, channelId: string) {
  const c = await channelFor(tx, channelId, tx.userId!);
  if (c.kind === "dm") throw new UserError("Direct messages can't be left.");
  if (c.is_default && c.name === "general") throw new UserError("Everyone stays in #general, so announcements reach the whole team.");
  await tx.q("delete from chat_members where channel_id = $1 and user_id = $2", [channelId, tx.userId]);
}

export async function addMembers(tx: Tx, channelId: string, userIds: string[]) {
  const c = await channelFor(tx, channelId, tx.userId!);
  if (!c.member) throw new UserError("Join the group first.");
  if (c.kind === "dm") throw new UserError("Start a new group message to add people.");
  const before = new Set((await tx.q<{ user_id: string }>("select user_id from chat_members where channel_id = $1", [channelId])).map((r) => r.user_id));
  await join(tx, channelId, userIds);
  const added = await tx.q<{ name: string }>("select name from users where id = any($1) order by name", [userIds.filter((id) => !before.has(id))]);
  if (added.length) await systemMessage(tx, channelId, `${tx.actorLabel} added ${added.map((a) => a.name).join(", ")}.`);
}

/** Members change the topic and emoji; the creator or a manager can rename, change privacy or archive. */
export async function updateChannel(
  tx: Tx,
  channelId: string,
  isManager: boolean,
  input: { name?: string; topic?: string; emoji?: string; private?: boolean; archive?: boolean },
) {
  const c = await channelFor(tx, channelId, tx.userId!);
  if (!c.member || c.kind === "dm") throw new UserError("Only members can change a group.");
  const admin = isManager || c.created_by === tx.userId;
  if ((input.name !== undefined || input.private !== undefined || input.archive) && !admin) throw new UserError("Only whoever created the group, or a manager, can rename, change privacy or archive it.");
  if (c.is_default && (input.name !== undefined || input.private || input.archive)) throw new UserError("Starter channels can't be renamed, made private or archived.");
  if (input.archive) {
    await tx.q("update chat_channels set archived_at = now() where id = $1", [channelId]);
    await tx.audit("chat.channel_archived", "chat_channel", channelId, undefined, { name: c.name });
    return;
  }
  const name = input.name !== undefined ? channelName(input.name) : c.name;
  if (name.length < 2) throw new UserError("Give the group a name (2+ letters).");
  if (name !== c.name && (await tx.one("select 1 from chat_channels where kind = 'channel' and archived_at is null and lower(name) = $1", [name]))) throw new UserError(`#${name} already exists.`);
  await tx.q("update chat_channels set name = $2, topic = $3, emoji = $4, private = $5 where id = $1", [
    channelId, name, (input.topic ?? c.topic).trim().slice(0, 250), input.emoji || c.emoji, input.private ?? c.private,
  ]);
  if (input.topic !== undefined && input.topic.trim() !== c.topic) await systemMessage(tx, channelId, `${tx.actorLabel} set the topic: ${input.topic.trim() || "(none)"}`);
}

/** Messages anyone could find: public channels, plus conversations they're in. Plain text match, newest first. */
export async function searchMessages(tx: Tx, userId: string, query: string) {
  const q = query.trim();
  if (q.length < 2) return [];
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return tx.q<{ id: string; channel_id: string; channel: string; kind: string; emoji: string; user_name: string | null; body: string; created_at: Date }>(
    `select m.id, m.channel_id, case when c.kind = 'dm' then 'Direct message' else '#' || c.name end as channel, c.kind, c.emoji, u.name as user_name, m.body, m.created_at
       from chat_messages m join chat_channels c on c.id = m.channel_id and c.archived_at is null left join users u on u.id = m.user_id
      where m.deleted_at is null and m.kind <> 'system' and m.body ilike $2
        and ((c.kind = 'channel' and not c.private) or exists (select 1 from chat_members cm where cm.channel_id = c.id and cm.user_id = $1))
      order by m.created_at desc limit 50`,
    [userId, like],
  );
}

/** The group for a client: made the first time someone opens it, with the people who work on that client's jobs. */
export async function ensureClientChannel(tx: Tx, companyId: string): Promise<string> {
  const company = await tx.one<{ name: string; account_manager_id: string | null }>("select name, account_manager_id from companies where id = $1", [companyId]);
  if (!company) throw new UserError("Client not found.");
  const existing = await tx.one<{ id: string }>("select id from chat_channels where company_id = $1 and kind = 'channel' and archived_at is null order by created_at limit 1", [companyId]);
  if (existing) {
    await join(tx, existing.id, [tx.userId!]);
    return existing.id;
  }
  const people = await tx.q<{ id: string }>(
    "select distinct u.id from users u where u.active and (u.id = $2 or u.id in (select owner_id from jobs where company_id = $1 and status <> 'closed') or u.id in (select account_manager_id from jobs where company_id = $1 and status <> 'closed'))",
    [companyId, company.account_manager_id],
  );
  const base = channelName(company.name) || "client";
  let name = base;
  for (let i = 2; await tx.one("select 1 from chat_channels where kind = 'channel' and archived_at is null and lower(name) = $1", [name]); i++) name = `${base}-${i}`;
  return createChannel(tx, { name, topic: `Everything for ${company.name}`, emoji: "🤝", category: "client", private: false, company_id: companyId, members: people.map((p) => p.id) });
}

/** Messages that @mention the person in conversations they're part of, and haven't read yet. */
export async function unreadMentions(tx: Tx, userId: string) {
  return (await tx.one<{ n: number }>(
    `select count(*)::int as n from chat_messages m
       join chat_members cm on cm.channel_id = m.channel_id and cm.user_id = $1
       join chat_channels c on c.id = m.channel_id and c.archived_at is null
      where $1 = any(m.mentions) and m.seq > cm.last_read_seq and m.deleted_at is null and m.user_id is distinct from $1`,
    [userId],
  ))!.n;
}

export interface HomeMessage {
  id: string;
  channel_id: string;
  channel: string;
  emoji: string;
  kind: string;
  author: string | null;
  body: string;
  at: string;
  unread: boolean;
}

export interface ChatHomeData {
  channels: ChatChannel[];
  /** Conversations with something unread, most unread first, each with its latest message. */
  catchUp: { channel: ChatChannel; last: HomeMessage | null }[];
  mentions: HomeMessage[];
  kudos: HomeMessage[];
  /** The conversations someone was most recently active in, for "jump back in". */
  recent: { channel: ChatChannel; last: HomeMessage | null }[];
  suggestions: ChatChannel[];
  mentionCount: number;
}

const MSG_SELECT = `m.id, m.channel_id, case when c.kind = 'dm' then 'Direct message' else '#' || c.name end as channel, c.emoji, m.kind, u.name as author, m.body, m.created_at::text as at`;

/** Everything on the chat Home page, in a few queries. */
export async function chatHome(tx: Tx, userId: string): Promise<ChatHomeData> {
  const channels = await sidebar(tx, userId);
  const ids = channels.map((c) => c.id);
  const lastRows = ids.length
    ? await tx.q<HomeMessage>(
        `select distinct on (m.channel_id) ${MSG_SELECT}, false as unread
           from chat_messages m join chat_channels c on c.id = m.channel_id left join users u on u.id = m.user_id
          where m.channel_id = any($1) and m.deleted_at is null and m.kind <> 'system' order by m.channel_id, m.seq desc`,
        [ids],
      )
    : [];
  const last = new Map(lastRows.map((r) => [r.channel_id, r]));
  const byRecent = [...channels].sort((a, b) => (last.get(b.id)?.at ?? "").localeCompare(last.get(a.id)?.at ?? ""));
  const readable = `((c.kind = 'channel' and not c.private) or exists (select 1 from chat_members x where x.channel_id = c.id and x.user_id = $1))`;
  const mentions = await tx.q<HomeMessage>(
    `select ${MSG_SELECT}, coalesce(cm.last_read_seq < m.seq, false) as unread
       from chat_messages m join chat_channels c on c.id = m.channel_id and c.archived_at is null left join users u on u.id = m.user_id
       left join chat_members cm on cm.channel_id = m.channel_id and cm.user_id = $1
      where $1 = any(m.mentions) and m.deleted_at is null and m.user_id is distinct from $1 and ${readable} and m.created_at > now() - interval '30 days'
      order by m.created_at desc limit 8`,
    [userId],
  );
  const kudos = await tx.q<HomeMessage>(
    `select ${MSG_SELECT}, false as unread
       from chat_messages m join chat_channels c on c.id = m.channel_id and c.archived_at is null left join users u on u.id = m.user_id
      where m.kind = 'kudos' and m.deleted_at is null and ${readable} and m.created_at > now() - interval '45 days'
      order by m.created_at desc limit 4`,
    [userId],
  );
  return {
    channels,
    catchUp: channels.filter((c) => c.unread > 0).sort((a, b) => b.unread - a.unread).map((channel) => ({ channel, last: last.get(channel.id) ?? null })),
    mentions,
    kudos,
    recent: byRecent.filter((c) => last.has(c.id)).slice(0, 6).map((channel) => ({ channel, last: last.get(channel.id) ?? null })),
    suggestions: (await browseChannels(tx, userId)).filter((c) => !c.member).slice(0, 5),
    mentionCount: await unreadMentions(tx, userId),
  };
}
