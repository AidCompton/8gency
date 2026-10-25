"use server";
import { act, str } from "@/lib/actions";
import { requireUser, tenant } from "@/lib/auth";
import { TEMPLATES, type FlowDef } from "@/lib/domain/automations";
import { assertCan } from "@/lib/permissions";
import { deleteAutomation, runAutomations, saveAutomation, setAutomationEnabled } from "@/lib/services/automations";
import { UserError } from "@/lib/services/core";

async function admin() {
  const user = await requireUser();
  assertCan(user, "automations");
  return user;
}

/** Builder save: the flow arrives as JSON from the canvas. */
export async function saveAutomationAction(fd: FormData) {
  const user = await admin();
  const id = str(fd, "id") || null;
  await act(id ? `/app/automations/${id}` : "/app/automations/new", () =>
    tenant(user, async (tx) => {
      let flow: FlowDef;
      try {
        flow = JSON.parse(str(fd, "flow"));
      } catch {
        throw new UserError("The automation couldn't be read. Reload and try again.");
      }
      const saved = await saveAutomation(tx, id, { name: str(fd, "name"), description: str(fd, "description"), enabled: str(fd, "enabled") === "true", flow, template_key: str(fd, "template_key") || null });
      return `/app/automations/${saved}`;
    }),
  "Automation saved.");
}

export async function toggleAutomationAction(fd: FormData) {
  const user = await admin();
  const id = str(fd, "id");
  const enabled = str(fd, "enabled") === "true";
  await act(str(fd, "back").startsWith("/app/automations") ? str(fd, "back") : "/app/automations", () => tenant(user, (tx) => setAutomationEnabled(tx, id, enabled)), enabled ? "Automation switched on." : "Automation switched off.");
}

export async function deleteAutomationAction(fd: FormData) {
  const user = await admin();
  await act("/app/automations", async () => {
    await tenant(user, (tx) => deleteAutomation(tx, str(fd, "id")));
    return "/app/automations";
  }, "Automation deleted.");
}

/** Start a custom automation from a template, switched off so it can be reviewed first. */
export async function useTemplateAction(fd: FormData) {
  const user = await admin();
  await act("/app/automations?tab=templates", () =>
    tenant(user, async (tx) => {
      const t = TEMPLATES.find((x) => x.key === str(fd, "key"));
      if (!t) throw new UserError("That template isn't available.");
      const id = await saveAutomation(tx, null, { name: t.name, description: t.description, enabled: false, flow: t.flow, template_key: t.key });
      return `/app/automations/${id}`;
    }),
  "Template added. Review the steps, then switch it on.");
}

export async function runAutomationsNowAction() {
  const user = await admin();
  await act("/app/automations", () => tenant(user, async (tx) => void (await runAutomations(tx))), "Automations ran.");
}
