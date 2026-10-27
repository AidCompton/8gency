// Usage counts hold numbers and feature names, never content, and count a person once a day.
import "../scripts/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { adminQuery, closePools, withAdminTx } from "../src/lib/db";
import { createAgencyWithOwner } from "../src/lib/services/agency";
import { recordActive, recordUse } from "../src/lib/usage";

const run = randomUUID().slice(0, 8);
let A: { agencyId: string; userId: string };
before(async () => {
  A = await withAdminTx((c) => createAgencyWithOwner(c, { agencyName: `Usage ${run}`, agencyType: "creative", ownerName: "Uma Owner", email: `uma-${run}@usage.example`, passwordHash: "x" }));
});
after(async () => {
  await adminQuery("delete from agencies where id = $1", [A.agencyId]).catch(() => {});
  await closePools();
});

test("a use is counted against the page's feature, and a person is active once a day", async () => {
  await recordUse(A.agencyId, "/app/jobs/9f1c?tab=scope&ok=Saved");
  await recordUse(A.agencyId, "/app/jobs");
  await recordUse(A.agencyId, "/app/time?day=2026-10-27");
  await recordActive(A.agencyId, A.userId);
  await recordActive(A.agencyId, A.userId);
  const uses = await adminQuery<{ feature: string; n: number }>("select feature, n from usage_days where agency_id = $1 order by feature", [A.agencyId]);
  assert.deepEqual(uses, [{ feature: "jobs", n: 2 }, { feature: "time", n: 1 }], "feature names and counts only: no ids, no query strings");
  assert.equal((await adminQuery("select 1 from active_days where agency_id = $1", [A.agencyId])).length, 1);
});
