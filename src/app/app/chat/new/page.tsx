import { LockSimple, UsersThree } from "@phosphor-icons/react/ssr";
import { SubmitButton } from "@/components/SubmitButton";
import { Avatar, Card, Field, PageHeader, buttonClass } from "@/components/ui";
import { createChannelAction, openDirectAction } from "../../_actions/chat";
import { requireUser, tenant, requireModule } from "@/lib/auth";
import { CATEGORIES, CHANNEL_EMOJI } from "@/lib/domain/chat";

export const metadata = { title: "New group" };

function People({ people, name }: { people: { id: string; name: string; title: string }[]; name: string }) {
  return (
    <ul className="grid max-h-72 gap-1 overflow-y-auto rounded-lg border border-line p-1.5 sm:grid-cols-2">
      {people.map((p) => (
        <li key={p.id}>
          <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-surface-2 has-[:checked]:bg-brand/10 pointer-coarse:py-2.5">
            <input type="checkbox" name={name} value={p.id} />
            <Avatar name={p.name} size="sm" />
            <span className="min-w-0 text-sm"><span className="block truncate font-medium">{p.name}</span><span className="block truncate text-xs text-ink-3">{p.title}</span></span>
          </label>
        </li>
      ))}
    </ul>
  );
}

export default async function NewChatPage() {
  const user = await requireUser();
  requireModule(user, "chat");
  const data = await tenant(user, async (tx) => ({
    people: await tx.q<{ id: string; name: string; title: string }>("select id, name, title from users where active and id <> $1 order by name", [user.id]),
    clients: await tx.q<{ id: string; name: string }>("select id, name from companies where kind = 'client' and status <> 'former' order by name"),
  }));
  return (
    <>
      <PageHeader back={{ href: "/app/chat", label: "Chat" }} title="Start something" subtitle="A group for a team, a client, an event or anything worth talking about. Or just message someone." />
      <div className="grid max-w-5xl items-start gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card title={<span className="flex items-center gap-2"><UsersThree aria-hidden size={18} /> New group</span>}>
          <form action={createChannelAction} className="space-y-4">
            <Field label="Name" hint="Lowercase with hyphens, e.g. vela-launch or friday-lunch.">
              <input name="name" required maxLength={40} placeholder="vela-launch" />
            </Field>
            <fieldset>
              <legend className="mb-1.5 text-[13px] font-medium text-ink-2">What&apos;s it for?</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {CATEGORIES.map((c, i) => (
                  <label key={c.key} className="cursor-pointer rounded-lg border border-line p-2.5 text-sm transition-colors hover:border-ink-3/50 has-[:checked]:border-brand has-[:checked]:bg-brand/5">
                    <input type="radio" name="category" value={c.key} defaultChecked={c.key === "project"} className="sr-only" />
                    <span className="block font-medium">{c.label}</span>
                    <span className="block text-xs text-ink-3">{c.hint}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-1.5 text-[13px] font-medium text-ink-2">Emoji</legend>
              <div className="flex flex-wrap gap-1">
                {CHANNEL_EMOJI.map((e, i) => (
                  <label key={e} className="cursor-pointer">
                    <input type="radio" name="emoji" value={e} defaultChecked={i === 0} className="peer sr-only" />
                    <span className="grid h-9 w-9 place-items-center rounded-lg text-lg transition-colors hover:bg-surface-2 peer-checked:bg-brand/15 peer-checked:ring-1 peer-checked:ring-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand">{e}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <Field label="Topic (optional)"><input name="topic" maxLength={250} placeholder="Everything for the Vela launch on 12 Nov" /></Field>
            <Field label="Client (optional)" hint="Links the group to the client's page.">
              <select name="company_id" defaultValue=""><option value="">None</option>{data.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            </Field>
            <div>
              <div className="mb-1.5 text-[13px] font-medium text-ink-2">Add people</div>
              <People people={data.people} name="members" />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="private" className="mt-0.5" />
              <span><span className="inline-flex items-center gap-1 font-medium"><LockSimple aria-hidden size={14} /> Private</span><span className="block text-xs text-ink-3">Only the people in it can see it. Public groups can be found and joined by anyone.</span></span>
            </label>
            <SubmitButton className={buttonClass("primary")}>Create group</SubmitButton>
          </form>
        </Card>
        <Card id="direct" title="Message someone" className="scroll-mt-24">
          <form action={openDirectAction} className="space-y-3">
            <p className="text-sm text-ink-2">Pick one person for a private chat, or a few for a small group message.</p>
            <People people={data.people} name="people" />
            <SubmitButton className={buttonClass("secondary")}>Start chatting</SubmitButton>
          </form>
        </Card>
      </div>
    </>
  );
}
