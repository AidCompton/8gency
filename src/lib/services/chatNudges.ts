import { adminQuery } from "../db";
import { firstName } from "../domain/text";
import { sendSystemMail } from "../systemMail";
import { appUrl } from "./core";

/**
 * Email people about chat messages that @mention or message them and that they
 * still haven't read, once, ten minutes after they were sent. From 8gency (it's
 * account email, not client email). Skips anyone who opted out, anyone who has
 * read the message in the meantime, and agencies with chat switched off.
 * Run from the scheduler.
 */
export async function sendChatNudges() {
  const due = await adminQuery<{ id: string; user_id: string; name: string; email: string; title: string; body: string; href: string }>(
    `select n.id, n.user_id, u.name, u.email, n.title, n.body, n.href
       from notifications n
       join users u on u.id = n.user_id and u.active and u.chat_nudges and not u.is_sample
       join agencies a on a.id = n.agency_id and coalesce(a.modules->>'chat', 'true') <> 'false'
       join chat_messages m on n.dedupe_key = 'chat:' || m.id::text and m.deleted_at is null
       join chat_members cm on cm.channel_id = m.channel_id and cm.user_id = n.user_id and cm.last_read_seq < m.seq
      where n.kind in ('chat', 'kudos') and n.emailed_at is null and n.created_at < now() - interval '10 minutes' and n.created_at > now() - interval '2 days'
      order by n.created_at`,
  );
  const byPerson = new Map<string, typeof due>();
  for (const d of due) byPerson.set(d.user_id, [...(byPerson.get(d.user_id) ?? []), d]);
  let sent = 0;
  for (const [userId, items] of byPerson) {
    const p = items[0];
    const lines = items.slice(0, 5).map((i) => `• ${i.title}\n  ${i.body}\n  ${appUrl(i.href)}`);
    try {
      await sendSystemMail({
        to: p.email,
        subject: items.length === 1 ? items[0].title.replace(/ 🎉$/, "") : `${items.length} unread messages on 8gency`,
        text: `Hi ${firstName(p.name)},\n\nYou have ${items.length === 1 ? "a message" : `${items.length} messages`} waiting:\n\n${lines.join("\n\n")}${items.length > 5 ? `\n\n…and ${items.length - 5} more.` : ""}\n\nTo stop these emails, turn them off on your account page: ${appUrl("/app/account")}\n\n8gency`,
      });
    } catch (e) {
      console.error(`chat nudge to ${userId} failed`, (e as Error).message);
      continue; // try again next run
    }
    await adminQuery("update notifications set emailed_at = now() where id = any($1)", [items.map((i) => i.id)]);
    sent++;
  }
  return sent;
}
