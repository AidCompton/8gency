// A referral link: waitlist, then signup, then 60 days, then one free month (never more than six a year).
import "../scripts/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { adminQuery, closePools, withAdminTx } from "../src/lib/db";
import { createAgencyWithOwner } from "../src/lib/services/agency";
import { noteWaitlistReferral, qualifyReferrals, referralSummary } from "../src/lib/services/referrals";

const run = randomUUID().slice(0, 8);
let referrer: { agencyId: string; userId: string };
const made: string[] = [];
const signup = async (email: string, name: string) => {
  const a = await withAdminTx((c) => createAgencyWithOwner(c, { agencyName: name, agencyType: "creative", ownerName: "New Owner", email, passwordHash: "x" }));
  made.push(a.agencyId);
  await adminQuery("update referrals set status = 'signed_up', referred_agency_id = $2, signed_up_at = now() where lower(referred_email) = lower($1) and status = 'waiting'", [email, a.agencyId]);
  return a;
};

before(async () => {
  referrer = await withAdminTx((c) => createAgencyWithOwner(c, { agencyName: `Referrer ${run}`, agencyType: "creative", ownerName: "Rita Referrer", email: `rita-${run}@ref.example`, passwordHash: "x" }));
  made.push(referrer.agencyId);
});
after(async () => {
  for (const id of made) await adminQuery("delete from agencies where id = $1", [id]).catch(() => {});
  await closePools();
});

test("a referred agency earns the referrer one free month after 60 days, once", async () => {
  const { code } = await referralSummary(referrer.agencyId);
  assert.match(code, /^[A-Z0-9]{8}$/);
  await noteWaitlistReferral(`kay-${run}@ref.example`, `Kay Co ${run}`, `  ${code.toLowerCase()} `);
  await noteWaitlistReferral(`kay-${run}@ref.example`, `Kay Co ${run}`, code);
  await noteWaitlistReferral(`rita-${run}@ref.example`, "Self", code);
  await noteWaitlistReferral(`nobody-${run}@ref.example`, "Nobody", "NOSUCHCODE");
  let s = await referralSummary(referrer.agencyId);
  assert.deepEqual(s.rows.map((r) => r.status), ["waiting"], "one row: repeats, the agency's own email and unknown codes are ignored");

  await signup(`kay-${run}@ref.example`, `Kay Co ${run}`);
  assert.equal(await qualifyReferrals(), 0, "not before 60 days");
  await adminQuery("update referrals set signed_up_at = now() - interval '61 days' where lower(referred_email) = lower($1)", [`kay-${run}@ref.example`]);
  assert.equal(await qualifyReferrals(), 1);
  assert.equal(await qualifyReferrals(), 0, "never twice");
  s = await referralSummary(referrer.agencyId);
  assert.equal(s.earned, 1);
  assert.equal(s.rows[0].status, "qualified");
});

test("at most six free months a year", async () => {
  const { code } = await referralSummary(referrer.agencyId);
  for (let i = 0; i < 6; i++) {
    const email = `cap${i}-${run}@ref.example`;
    await noteWaitlistReferral(email, `Cap ${i} ${run}`, code);
    await signup(email, `Cap ${i} ${run}`);
    await adminQuery("update referrals set signed_up_at = now() - interval '61 days' where lower(referred_email) = lower($1)", [email]);
  }
  await qualifyReferrals();
  const s = await referralSummary(referrer.agencyId);
  assert.equal(s.earned, 6, "one earlier plus five more reach the cap of six");
  assert.equal(s.rows.filter((r) => r.status === "void").length, 1, "the seventh isn't paid");
});
