"use server";
import { act } from "@/lib/actions";
import { requireUser, tenant } from "@/lib/auth";
import { assertCan } from "@/lib/permissions";
import { clearSample, loadSample } from "@/lib/services/sample";

export async function loadSampleAction() {
  const user = await requireUser();
  assertCan(user, "settings");
  await act("/app", async () => {
    await tenant(user, (tx) => loadSample(tx));
    return "/app?tour=1";
  });
}

export async function clearSampleAction() {
  const user = await requireUser();
  assertCan(user, "settings");
  await act("/app", async () => {
    await tenant(user, (tx) => clearSample(tx));
    return "/app/settings?tab=import";
  }, "Sample data cleared. Your own data is untouched. Bring it in below.");
}
