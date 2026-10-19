import assert from "node:assert/strict";
import { test } from "node:test";
import { scoreBrief } from "../src/lib/domain/brief";
import { addMonths, endOfMonth, startOfWeek, todayIn, workingDays } from "../src/lib/domain/dates";
import { makeReferenceCode, parseReply } from "../src/lib/domain/inbound";
import { formatJobNumber, suggestClientCode } from "../src/lib/domain/jobNumber";
import { clientHealth, dso, projectMargin, utilisation } from "../src/lib/domain/metrics";
import { formatMoney, invoiceTotals, toCents } from "../src/lib/domain/money";
import { reconcileRetainer, retainerBurn } from "../src/lib/domain/retainer";
import { detectOutOfScope, findVagueScope, nextRoundNeedsChangeRequest, scopeMeter } from "../src/lib/domain/scope";

test("brief score rewards complete fields and rejects placeholders", () => {
  const empty = scoreBrief({});
  assert.equal(empty.score, 0);
  assert.equal(empty.missing.length, 9);

  const full = scoreBrief({
    objective: "Grow trial of the new lager among 25-34 year olds by 15%",
    audience: "Urban drinkers 25-34 who prefer craft",
    key_message: "Crafted for the long weekend",
    deliverables: "3 social videos, 6 statics",
    must_haves: "Responsible drinking line",
    budget: "R250k",
    deadline: "2026-11-30",
    approver_contact_id: "c1",
    success_measure: "Trial uplift via retail data",
  });
  assert.equal(full.score, 100);

  const tbc = scoreBrief({ objective: "TBC", budget: "tbc" });
  assert.equal(tbc.score, 0);
});

test("out-of-scope detection flags the classic phrases", () => {
  const r = detectOutOfScope("Hi! Quick one, can you also do a square version for Instagram by tomorrow?");
  assert.ok(r.likely);
  assert.ok(r.signals.includes("“quick one / small favour”"));
  assert.ok(r.signals.includes("rush timing"));
  assert.equal(detectOutOfScope("Thanks, the banner looks great.").likely, false);
});

test("vague scope wording is caught", () => {
  assert.equal(findVagueScope("Social media management as required").length, 2);
  assert.equal(findVagueScope("12 social posts per month, 2 rounds each").length, 0);
});

test("scope meter and rounds counter", () => {
  assert.deepEqual(scopeMeter({ quantity: 10, used: 12 }).state, "over");
  assert.equal(scopeMeter({ quantity: 10, used: 12 }).over, 2);
  assert.equal(scopeMeter({ quantity: 10, used: 9 }).state, "warn");
  assert.equal(nextRoundNeedsChangeRequest(1, 2), false);
  assert.equal(nextRoundNeedsChangeRequest(2, 2), true);
});

test("retainer burn alerts when ahead of time elapsed", () => {
  const mid = retainerBurn({ allocatedHours: 40, usedHours: 30, startsOn: "2026-10-01", endsOn: "2026-10-31", today: "2026-10-15", alertMargin: 0.1 });
  assert.ok(mid.alert, "75% burn at ~48% elapsed should alert");
  const onPace = retainerBurn({ allocatedHours: 40, usedHours: 18, startsOn: "2026-10-01", endsOn: "2026-10-31", today: "2026-10-15", alertMargin: 0.1 });
  assert.equal(onPace.alert, false);
});

test("retainer reconciliation applies rollover rules", () => {
  assert.deepEqual(reconcileRetainer({ allocatedHours: 40, usedHours: 46, rollover: "capped", rolloverCapHours: 8 }), {
    overageHours: 6, unusedHours: 0, rolloverOutHours: 0, forfeitedHours: 0,
  });
  assert.deepEqual(reconcileRetainer({ allocatedHours: 40, usedHours: 28, rollover: "capped", rolloverCapHours: 8 }), {
    overageHours: 0, unusedHours: 12, rolloverOutHours: 8, forfeitedHours: 4,
  });
  assert.equal(reconcileRetainer({ allocatedHours: 40, usedHours: 28, rollover: "none", rolloverCapHours: 8 }).rolloverOutHours, 0);
});

test("invoice totals use integer cents and round tax once", () => {
  const t = invoiceTotals([{ quantity: 1.5, unit_cents: 95000 }, { quantity: 1, unit_cents: 333 }], 0.15);
  assert.deepEqual(t, { subtotal_cents: 142833, tax_cents: 21425, total_cents: 164258 });
  assert.equal(toCents("R 12,500.50"), 1250050);
  assert.equal(formatMoney(1250050), "R12 500,50".replace(" ", formatMoney(1250050).charAt(3)));
});

test("job numbers and client codes", () => {
  assert.equal(formatJobNumber("{CLIENT}-{YYYY}-{SEQ}", { client: "bcb", year: 2026, seq: 7 }), "BCB-2026-0007");
  assert.equal(suggestClientCode("Blue Crane Brewing (Pty) Ltd"), "BCB");
  assert.equal(suggestClientCode("Vela"), "VELA");
});

test("metrics", () => {
  assert.equal(utilisation(28, 40), 0.7);
  assert.equal(utilisation(5, 0), null);
  assert.equal(projectMargin(100_000, 50_000, 10_000), 0.4);
  assert.equal(dso(50_000, 150_000, 90), 30);
  const h = clientHealth({ onTimeRate: 1, overservicingRate: 0, avgDaysLate: 0, avgApprovalDays: null, satisfaction: 5 });
  assert.equal(h.score, 100);
  assert.equal(clientHealth({ onTimeRate: null, overservicingRate: null, avgDaysLate: null, avgApprovalDays: null, satisfaction: null }).score, null);
});

test("dates", () => {
  assert.equal(startOfWeek("2026-10-18"), "2026-10-12"); // Sunday → Monday before
  assert.equal(startOfWeek("2026-10-19"), "2026-10-19");
  assert.equal(endOfMonth("2026-02-10"), "2026-02-28");
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(workingDays("2026-10-19", "2026-10-25"), 5);
  assert.equal(todayIn("Africa/Johannesburg", new Date("2026-10-19T23:30:00Z")), "2026-10-20");
});

test("reference codes always contain a digit and a letter", () => {
  let i = 0;
  const seq = [new Uint8Array([0, 0, 0, 0, 0, 0]), new Uint8Array([0, 30, 1, 2, 3, 4])];
  assert.equal(makeReferenceCode(() => seq[i++]), "A8BCDE");
});

test("email and WhatsApp replies are parsed into decisions", () => {
  assert.deepEqual(parseReply("Approved! 7K2QXM"), { code: "7K2QXM", decision: "approved", body: "!" });
  const changes = parseReply("Changes: make the logo bigger please\nRef 7K2QXM\n\nOn Mon, Oct 19, Studio wrote:\n> old");
  assert.equal(changes.decision, "changes_requested");
  assert.equal(changes.code, "7K2QXM");
  assert.match(changes.body, /logo bigger/);
  assert.equal(parseReply("👍").decision, "approved");
});
