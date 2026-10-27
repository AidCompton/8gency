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
import { assessWorkload } from "../src/lib/domain/workload";
import { bookingProblems } from "../src/lib/domain/bookings";
import { channelName, findMentions, tokenize } from "../src/lib/domain/chat";
import { cardStatus, entryHours, localDate, suggestClient } from "../src/lib/domain/imports";
import { itemsFromModelText, parseScopeText, sanitiseItem } from "../src/lib/domain/scopeDraft";

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
  assert.equal(toCents("55 200,50"), 5520050, "en-ZA comma decimal");
  assert.equal(toCents("R12 500,5"), 1250050);
  assert.equal(toCents("12,500"), 1250000, "comma + 3 digits is a thousands separator");
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

test("summarise makes short titles from client messages", async () => {
  const { summarise } = await import("../src/lib/domain/text");
  assert.equal(
    summarise("Hey team, quick one: can you also do a version of this week's posts in isiZulu? Need it by tomorrow if possible 🙏"),
    "Hey team, quick one: can you also do a version of this…",
  );
  assert.equal(summarise("Swap the hero photo."), "Swap the hero photo.");
});

test("workload: who is taking on too much", () => {
  const base = { weeklyHours: 40, pastWeeks: [38, 40, 39, 40], thisWeek: 16, thisWeekWorkdays: 2, weekendHours: 0, bookedNext14: 60, overdueTasks: 0 };
  assert.equal(assessWorkload(base).status, "balanced");
  assert.deepEqual(assessWorkload(base).reasons, []);

  // Two of the last four weeks more than 10% over contract → overloaded, and it says why.
  const long = assessWorkload({ ...base, pastWeeks: [40, 41, 48, 52] });
  assert.equal(long.status, "overloaded");
  assert.equal(long.overWeeks, 2);
  assert.match(long.reasons[0], /Logged 48h and 52h in the last two weeks \(40h contracted\)/);

  // More open work due in the next fortnight than there are hours for.
  assert.equal(assessWorkload({ ...base, bookedNext14: 90 }).status, "stretched");
  assert.equal(assessWorkload({ ...base, bookedNext14: 110 }).status, "overloaded");

  // A hot start to this week: 30h by Tuesday.
  assert.equal(assessWorkload({ ...base, thisWeek: 30 }).status, "overloaded");

  // Weekend work and a pile of overdue tasks are warning signs on their own.
  const weekend = assessWorkload({ ...base, weekendHours: 6 });
  assert.equal(weekend.status, "stretched");
  assert.match(weekend.reasons.join(" "), /6h on weekends/);
  assert.equal(assessWorkload({ ...base, overdueTasks: 4 }).status, "stretched");

  // Little logged and little booked: light (room to take more on).
  assert.equal(assessWorkload({ ...base, pastWeeks: [10, 12, 8, 14], thisWeek: 2, bookedNext14: 10 }).status, "light");

  // No contracted hours: nothing to judge against.
  assert.equal(assessWorkload({ ...base, weeklyHours: 0 }).status, "balanced");
});

test("bookings: time, capacity, job budget and scope", () => {
  const limits = { today: "2026-10-26", dayCapacity: 8, sameDay: [{ start: "09:00", hours: 3, title: "Homepage" }], jobHoursLeft: 10, scopeHoursLeft: null, scopeName: "Website" };
  assert.deepEqual(bookingProblems({ date: "2026-10-27", start: "13:00", hours: 4 }, limits), []);
  assert.match(bookingProblems({ date: "2026-10-27", start: "11:00", hours: 2 }, limits).join(), /Clashes with “Homepage” \(09:00–12:00\)/);
  assert.match(bookingProblems({ date: "2026-10-27", start: "12:00", hours: 6 }, limits).join(), /Only 5h free that day/);
  assert.match(bookingProblems({ date: "2026-10-27", start: "12:00", hours: 5 }, { ...limits, jobHoursLeft: 2 }).join(), /Only 2h of the job's budget is left/);
  assert.match(bookingProblems({ date: "2026-10-27", start: "12:00", hours: 2 }, { ...limits, jobHoursLeft: null }).join(), /no hours budget/);
  assert.match(bookingProblems({ date: "2026-10-27", start: "12:00", hours: 2 }, { ...limits, scopeHoursLeft: 0 }).join(), /“Website” is used up/);
  assert.match(bookingProblems({ date: "2026-10-31", start: "12:00", hours: 2 }, limits).join(), /weekend/);
  assert.match(bookingProblems({ date: "2026-10-23", start: "12:00", hours: 2 }, limits).join(), /passed/);
  assert.match(bookingProblems({ date: "2026-10-27", start: "18:00", hours: 2 }, limits).join(), /between 07:00 and 19:00/);
  assert.match(bookingProblems({ date: "2026-10-27", start: "13:00", hours: 1.1 }, limits).join(), /quarter hours/);
});

test("chat: mentions, formatting and channel names", () => {
  const people = [{ id: "1", name: "Mia Botha" }, { id: "2", name: "Zanele Khumalo" }, { id: "3", name: "Mia Nel" }];
  assert.deepEqual(findMentions("Thanks @Zanele and @Mia Botha!", people), ["2", "1"]);
  assert.deepEqual(findMentions("@Mia can you check?", people), [], "two Mias: a first name alone is ambiguous");
  assert.deepEqual(findMentions("email me at a@b.com", people), []);
  assert.deepEqual(tokenize("**Launch** is _live_ at https://vela.example/launch. Nice one @Zanele `v2`", people), [
    { t: "bold", v: "Launch" }, { t: "text", v: " is " }, { t: "italic", v: "live" }, { t: "text", v: " at " }, { t: "link", v: "https://vela.example/launch" },
    { t: "text", v: ". Nice one " }, { t: "mention", v: "@Zanele", id: "2" }, { t: "text", v: " " }, { t: "code", v: "v2" },
  ]);
  assert.deepEqual(tokenize("<script>x</script>", people), [{ t: "text", v: "<script>x</script>" }]);
  assert.equal(channelName("  #Vela Launch 2026!! "), "vela-launch-2026");
});

test("imports: client matching, card status and entry hours", () => {
  const clients = [{ id: "v", name: "Vela Health (Pty) Ltd" }, { id: "k", name: "Karoo Outdoor Co" }, { id: "b", name: "Blue Crane Brewing" }];
  assert.equal(suggestClient("Vela Health launch", clients), "v");
  assert.equal(suggestClient("Website rebuild", clients, "karoo outdoor"), "k");
  assert.equal(suggestClient("Brand refresh", clients, "Unknown Client"), null);
  assert.equal(suggestClient("Blue", clients), null, "a partial word is not a client");
  assert.equal(cardStatus("In Progress", false), "in_progress");
  assert.equal(cardStatus("Client feedback", false), "waiting_client");
  assert.equal(cardStatus("Shipped", false), "done");
  assert.equal(cardStatus("Backlog", true), "done");
  assert.equal(cardStatus("Ideas", false), "todo");
  assert.equal(entryHours(5400), 1.5);
  assert.equal(entryHours(-1700000000), 0, "a running timer isn't time yet");
  assert.equal(localDate("2026-10-24T22:30:00Z", "Africa/Johannesburg"), "2026-10-25");
});

test("scope drafting: a quote's lines become scope items, with prices and boilerplate left out", () => {
  const quote = `Quotation 2026-014 for Vela Health
- 6 social statics (2 rounds of changes) R 18 000
- 1x Campaign video, 30 seconds  R 45 000
  Excludes: talent and music licences
• 40 hours of community management
Brand guidelines x 2
Includes: logo usage, colour, type
Subtotal R 63 000 excl VAT
VAT 15%
Payment terms: 30 days
Kind regards, Sam`;
  const items = parseScopeText(quote);
  assert.deepEqual(items.map((i) => [i.name, i.unit, i.quantity, i.rounds_allowed]), [
    ["social statics", "deliverable", 6, 2],
    ["Campaign video, 30 seconds", "deliverable", 1, 2],
    ["community management", "hours", 40, 0],
    ["Brand guidelines", "deliverable", 2, 2],
  ]);
  assert.equal(items[1].exclusions, "talent and music licences");
  assert.equal(items[3].inclusions, "logo usage, colour, type");
  assert.equal(sanitiseItem({ name: " ", unit: "hours" }), null);
  assert.deepEqual(sanitiseItem({ name: "Posters", unit: "hours", quantity: 5000, rounds_allowed: 99 }), { name: "Posters", unit: "hours", quantity: 1000, rounds_allowed: 0, inclusions: "", exclusions: "" });
  assert.equal(itemsFromModelText('Here you go:\n```json\n{"items":[{"name":"Website","unit":"deliverable","quantity":1,"rounds_allowed":3,"inclusions":"","exclusions":"Hosting"},{"name":""}]}\n```')?.length, 1);
  assert.equal(itemsFromModelText("I can't do that."), null);
});

test("leak calculator: adds the three leaks, clamps nonsense and recovers a third", async () => {
  const { estimateLeak } = await import("../src/lib/domain/leak");
  const r = estimateLeak({ people: 5, rate: 600, hoursPerWeek: 30, unbilledPct: 10, creepHoursPerWeek: 4, retainerOverHoursPerMonth: 10 });
  assert.equal(r.unbilled, 5 * 30 * 0.1 * 600 * 46);
  assert.equal(r.creep, 4 * 600 * 46);
  assert.equal(r.retainers, 10 * 600 * 12);
  assert.equal(r.total, r.unbilled + r.creep + r.retainers);
  assert.equal(r.recoverable, Math.round(r.total / 3));
  const weird = estimateLeak({ people: -3, rate: Number.NaN, hoursPerWeek: 1e9, unbilledPct: 500, creepHoursPerWeek: -1, retainerOverHoursPerMonth: 0 });
  assert.equal(weird.total, 0, "no people or no rate means nothing to estimate");
});
