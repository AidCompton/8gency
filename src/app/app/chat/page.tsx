import { redirect } from "next/navigation";
import { requireUser, tenant } from "@/lib/auth";
import { ensureDefaults } from "@/lib/services/chat";

/** Chat opens on #general. */
export default async function ChatHome() {
  const user = await requireUser();
  const id = await tenant(user, async (tx) => {
    await ensureDefaults(tx);
    return (await tx.one<{ id: string }>("select id from chat_channels where is_default and name = 'general' and archived_at is null"))!.id;
  });
  redirect(`/app/chat/${id}`);
}
