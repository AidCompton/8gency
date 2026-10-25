// Connectors end to end against Postgres, with every provider API stubbed at
// fetch: tokens, Outbox delivery, automations, calendar → timesheets,
// accounting, ad spend, payments, WhatsApp and HubSpot.
import "../scripts/env";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { adminQuery, closePools, withAdminTx, withTenant, type Tx } from "../src/lib/db";
import { addDays, todayIn } from "../src/lib/domain/dates";
import { clientResults } from "../src/lib/connectors/ads";
import { authorizeUrl, saveConnection } from "../src/lib/connectors/connections";
import { provider } from "../src/lib/connectors/providers";
import { deliverOutbox, mimeMessage } from "../src/lib/connectors/delivery";
import { linkProvider } from "../src/lib/connectors/files";
import { parseWhatsapp, verifyWhatsapp } from "../src/lib/connectors/messaging";
import { handlePaymentWebhook, payfastSignature } from "../src/lib/connectors/payments";
import { syncConnection } from "../src/lib/connectors/sync";
import { applyToggl, mapTogglProject, matchTogglPerson } from "../src/lib/connectors/toggl";
import { mapTrelloBoard } from "../src/lib/connectors/trello";
import { addContact, createAgencyWithOwner, createCompany } from "../src/lib/services/agency";
import { saveAutomation } from "../src/lib/services/automations";
import { createInvoice, readyToBill, sendInvoice } from "../src/lib/services/billing";
import { queueMessage } from "../src/lib/services/core";
import { createJob, lockScope, setJobStatus } from "../src/lib/services/jobs";
import { timesheetSuggestions } from "../src/lib/services/time";
import { draftScope, saveScopeDraft } from "../src/lib/services/scopeDraft";
import { seal, sign, unseal, verify } from "../src/lib/vault";

const run = randomUUID().slice(0, 8);
let A: { agencyId: string; userId: string };
const asA = <T>(fn: (tx: Tx) => Promise<T>) => withTenant({ agencyId: A.agencyId, userId: A.userId, actorLabel: "Test Owner" }, fn);
const today = todayIn("Africa/Johannesburg");

/** Replace fetch with canned provider responses; returns the calls made. */
function stub(routes: [RegExp, (url: string, init: RequestInit) => unknown][]) {
  const real = globalThis.fetch;
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const r = routes.find(([re]) => re.test(url));
    if (!r) return new Response(`no stub for ${url}`, { status: 599 });
    const out = await r[1](url, init);
    return out instanceof Response ? out : Response.json(out);
  }) as typeof fetch;
  return { calls, restore: () => void (globalThis.fetch = real) };
}

async function client(tx: Tx, name: string, domain: string) {
  const companyId = await createCompany(tx, { name: `${name} ${run}` });
  await addContact(tx, { company_id: companyId, name: "Jane Approver", email: `jane@${domain}`, phone: "+27 82 555 0101", role: "approver" });
  await addContact(tx, { company_id: companyId, name: "Bill Payer", email: `accounts@${domain}`, role: "billing" });
  const jobId = await createJob(tx, { company_id: companyId, name: "Launch", template_key: "campaign", fee_cents: 20_000_00 });
  await tx.q("update briefs set objective='Grow sign-ups by 20%', audience='Young professionals', key_message='Simple', deliverables='Posters', must_haves='Logo', budget='R20k', success_measure='Sign-ups' where job_id=$1", [jobId]);
  await tx.q("update briefs set approver_contact_id = (select id from contacts where company_id = $2 and role = 'approver' limit 1) where job_id = $1", [jobId, companyId]);
  await lockScope(tx, jobId);
  await setJobStatus(tx, jobId, "in_progress");
  return { companyId, jobId };
}

/** Issue the job's deposit invoice. */
async function sentInvoice(tx: Tx, companyId: string) {
  const inv = await createInvoice(tx, companyId, (await readyToBill(tx, companyId)).map((i) => i.key));
  await sendInvoice(tx, inv);
  return (await tx.one<{ id: string; number: string; total_cents: number }>("select id, number, total_cents from invoices where id = $1", [inv]))!;
}

before(async () => {
  A = await withAdminTx((c) => createAgencyWithOwner(c, { agencyName: `Connectors ${run}`, agencyType: "creative", ownerName: "Test Owner", email: `conn-${run}@test.example`, passwordHash: "x" }));
});

after(async () => {
  await adminQuery("delete from agencies where id = $1", [A.agencyId]).catch(() => {});
  await closePools();
});

describe("vault", () => {
  test("secrets are encrypted at rest and tamper-evident; signed state expires", () => {
    const blob = seal({ access_token: "secret-token" });
    assert.ok(!blob.toString("utf8").includes("secret-token"));
    assert.deepEqual(unseal(blob), { access_token: "secret-token" });
    blob[blob.length - 1] ^= 1;
    assert.throws(() => unseal(blob));
    const s = sign({ a: 1 });
    assert.equal(verify<{ a: number }>(s)?.a, 1);
    assert.equal(verify(`${s}x`), null);
    assert.equal(verify(sign({ a: 1 }, -1)), null);
  });
});

describe("sign-in", () => {
  test("each OAuth provider gets its client id, the shared callback, its scopes and the signed state", () => {
    process.env.SLACK_CLIENT_ID = "slack-client";
    const u = new URL(authorizeUrl(provider("slack")!, "STATE"));
    assert.equal(u.origin + u.pathname, "https://slack.com/oauth/v2/authorize");
    assert.equal(u.searchParams.get("client_id"), "slack-client");
    assert.equal(u.searchParams.get("redirect_uri"), `${process.env.APP_URL}/api/connectors/oauth/callback`);
    assert.equal(u.searchParams.get("scope"), "chat:write,chat:write.public,channels:read,groups:read");
    assert.equal(u.searchParams.get("state"), "STATE");
    const g = new URL(authorizeUrl(provider("google_calendar")!, "S"));
    assert.equal(g.searchParams.get("access_type"), "offline");
    assert.match(g.searchParams.get("scope")!, /calendar\.events$/);
  });
});

describe("outbox delivery", () => {
  test("email goes out through Gmail; channels that aren't connected wait", async () => {
    await asA(async (tx) => {
      await saveConnection(tx, { provider: "gmail", userId: null, label: "studio@agency.example", secret: { access_token: "g1", refresh_token: "r1" }, expiresIn: 3600 });
      await queueMessage(tx, { channel: "email", toName: "Jane Ndlovu", to: "jane@client.example", subject: "Your proofs ✓", body: "Hello Jane" });
      await queueMessage(tx, { channel: "whatsapp", toName: "Jane", to: "+27825550101", body: "Hi" });
    });
    const s = stub([[/gmail\.googleapis\.com/, () => ({ id: "gm-1" })]]);
    try {
      assert.equal(await deliverOutbox(A.agencyId), 1);
    } finally {
      s.restore();
    }
    const raw = Buffer.from(JSON.parse(String(s.calls[0].init.body)).raw, "base64url").toString();
    assert.match(raw, /^To: Jane Ndlovu <jane@client\.example>/);
    assert.match(raw, /Subject: =\?UTF-8\?B\?/);
    assert.equal(new Headers(s.calls[0].init.headers).get("authorization"), "Bearer g1");
    const rows = await asA((tx) => tx.q<{ channel: string; status: string; via: string | null; provider_message_id: string | null }>("select channel, status, via, provider_message_id from outbox_messages order by channel"));
    assert.deepEqual(rows.map((r) => [r.channel, r.status, r.via, r.provider_message_id]), [["email", "sent", "gmail", "gm-1"], ["whatsapp", "queued", null, null]]);
  });

  test("expiring tokens refresh; revoked access flags the connection and tells the owner", async () => {
    await asA(async (tx) => {
      await tx.q("update connections set token_expires_at = now() - interval '1 minute' where provider = 'gmail'");
      await queueMessage(tx, { channel: "email", toName: "Jane", to: "jane@client.example", subject: "Again", body: "Hi" });
    });
    let s = stub([
      [/oauth2\.googleapis\.com\/token/, () => ({ access_token: "g2", expires_in: 3600 })],
      [/gmail\.googleapis\.com/, (_u, init) => (new Headers(init.headers).get("authorization") === "Bearer g2" ? { id: "gm-2" } : new Response("", { status: 401 }))],
    ]);
    try {
      assert.equal(await deliverOutbox(A.agencyId), 1);
    } finally {
      s.restore();
    }
    await asA((tx) => queueMessage(tx, { channel: "email", toName: "Jane", to: "jane@client.example", subject: "Third", body: "Hi" }));
    s = stub([
      [/oauth2\.googleapis\.com\/token/, () => ({ access_token: "g3", expires_in: 3600 })],
      [/gmail\.googleapis\.com/, () => new Response("", { status: 401 })],
    ]);
    try {
      assert.equal(await deliverOutbox(A.agencyId), 0);
    } finally {
      s.restore();
    }
    await asA(async (tx) => {
      assert.equal((await tx.one<{ status: string }>("select status from connections where provider = 'gmail'"))!.status, "needs_reauth");
      assert.ok(await tx.one("select 1 from notifications where user_id = $1 and title = 'Reconnect Gmail'", [A.userId]));
      assert.equal((await tx.one<{ status: string }>("select status from outbox_messages where subject = 'Third'"))!.status, "queued");
    });
  });
});

describe("automations through connectors", () => {
  test("a Slack step posts in the client's mapped channel", async () => {
    const { companyId } = await asA(async (tx) => {
      const c = await client(tx, "Slackers", "slackers.example");
      const conn = await saveConnection(tx, { provider: "slack", userId: null, label: "Studio", secret: { access_token: "xoxb-1" } });
      await tx.q("insert into connection_mappings (agency_id, connection_id, external_id, external_label, company_id) values ($1,$2,'C123','#slackers',$3)", [A.agencyId, conn, c.companyId]);
      await saveAutomation(tx, null, {
        name: "New job to Slack",
        description: "",
        enabled: true,
        flow: { trigger: { type: "job.created", config: {} }, filters: [], actions: [{ type: "slack_message", config: { channel: "client", message: "New job: {{job}}" } }] },
      });
      await createJob(tx, { company_id: c.companyId, name: "Second job", template_key: "blank" });
      return c;
    });
    const s = stub([[/slack\.com\/api\/chat\.postMessage/, () => ({ ok: true, ts: "171.1" })]]);
    try {
      assert.ok((await deliverOutbox(A.agencyId)) >= 1);
    } finally {
      s.restore();
    }
    const body = JSON.parse(String(s.calls[0].init.body));
    assert.equal(body.channel, "C123");
    assert.match(body.text, /New job: .*Second job/);
    assert.match(body.text, /Open in 8gency/);
    void companyId;
  });
});

describe("calendar to timesheets", () => {
  test("a client meeting becomes a suggestion on the client's job", async () => {
    const yesterday = addDays(today, -1);
    const { jobId, conn } = await asA(async (tx) => {
      const c = await client(tx, "Meetco", "meetco.example");
      const conn = await saveConnection(tx, { provider: "google_calendar", userId: A.userId, label: "me@agency.example", secret: { access_token: "c1" }, expiresIn: 3600 });
      return { ...c, conn };
    });
    const s = stub([
      [
        /calendar\/v3\/calendars\/primary\/events/,
        () => ({
          items: [
            { id: "ev1", summary: "Weekly check-in", start: { dateTime: `${yesterday}T09:00:00+02:00` }, end: { dateTime: `${yesterday}T09:45:00+02:00` }, attendees: [{ email: "someone@meetco.example" }, { email: "me@agency.example", self: true }] },
            { id: "ev2", summary: "Lunch", start: { date: yesterday }, end: { date: yesterday } },
          ],
        }),
      ],
    ]);
    try {
      const r = await syncConnection(A.agencyId, conn);
      assert.ok(r.ok, r.summary);
    } finally {
      s.restore();
    }
    const sug = await asA((tx) => timesheetSuggestions(tx, A.userId, yesterday));
    const m = sug.find((x) => x.job_id === jobId);
    assert.ok(m, "meeting suggested on the client's job");
    assert.equal(m!.hours, 0.75);
    assert.match(m!.reason, /45-min meeting: Weekly check-in \(Google Calendar\)/);
    assert.equal(m!.notes, "Weekly check-in");
  });
});

describe("accounting", () => {
  test("issued invoices go to Xero once, and a payment there settles the invoice here", async () => {
    const { conn, inv } = await asA(async (tx) => {
      const conn = await saveConnection(tx, { provider: "xero", userId: null, label: "Studio (Pty) Ltd", externalId: "tenant-1", secret: { access_token: "x1" }, expiresIn: 1800 });
      const c = await client(tx, "Xeroco", "xeroco.example");
      return { conn, inv: await sentInvoice(tx, c.companyId) };
    });
    const pushes: unknown[] = [];
    const s = stub([
      [/api\.xro\/2\.0\/Invoices\?IDs=/, () => ({ Invoices: [{ InvoiceID: "XI-1", Total: 100, AmountPaid: 100, Status: "PAID" }] })],
      [/api\.xro\/2\.0\/Invoices$/, (_u, init) => (pushes.push(JSON.parse(String(init.body))), { Invoices: [{ InvoiceID: "XI-1", Total: 100 }] })],
    ]);
    try {
      assert.ok((await syncConnection(A.agencyId, conn)).ok);
      assert.ok((await syncConnection(A.agencyId, conn)).ok);
    } finally {
      s.restore();
    }
    assert.equal(pushes.length, 1, "pushed once");
    const sent = (pushes[0] as { Invoices: { InvoiceNumber: string; Contact: { Name: string }; LineItems: unknown[] }[] }).Invoices[0];
    assert.equal(sent.InvoiceNumber, inv.number);
    assert.match(sent.Contact.Name, /^Xeroco/);
    assert.ok(sent.LineItems.length > 0);
    const after = await asA((tx) => tx.one<{ status: string; paid_cents: number }>("select status, paid_cents from invoices where id = $1", [inv.id]));
    assert.deepEqual(after, { status: "paid", paid_cents: inv.total_cents });
  });
});

describe("ad spend", () => {
  test("daily spend becomes one cost per day on the job, updates in place, alerts over budget and feeds status reports", async () => {
    const { conn, jobId, companyId } = await asA(async (tx) => {
      const c = await client(tx, "Adco", "adco.example");
      const conn = await saveConnection(tx, { provider: "meta_ads", userId: null, label: "Media Buyer", secret: { access_token: "m1" }, expiresIn: 86400 * 50 });
      await tx.q("insert into connection_mappings (agency_id, connection_id, external_id, external_label, company_id, job_id, settings) values ($1,$2,'act_9','Adco Main',$3,$4,$5)", [
        A.agencyId, conn, c.companyId, c.jobId, JSON.stringify({ markup: 0.1, monthly_budget: 50 }),
      ]);
      return { conn, ...c };
    });
    let spend = "60.50";
    const s = stub([
      [/graph\.facebook\.com\/.*\/act_9\/insights/, () => ({
        data: [
          { date_start: today, spend, clicks: "10", impressions: "1000", actions: [{ action_type: "lead", value: "2" }], account_currency: "ZAR" },
          { date_start: addDays(today, -1), spend: "0", clicks: "0", impressions: "0", account_currency: "ZAR" },
        ],
      })],
    ]);
    try {
      assert.ok((await syncConnection(A.agencyId, conn)).ok);
      spend = "70.00";
      assert.ok((await syncConnection(A.agencyId, conn)).ok);
    } finally {
      s.restore();
    }
    await asA(async (tx) => {
      const costs = await tx.q<{ amount_cents: number; markup: number; rebillable: boolean; source: string }>("select amount_cents, markup::float, rebillable, source from costs where job_id = $1", [jobId]);
      assert.deepEqual(costs, [{ amount_cents: 7000, markup: 0.1, rebillable: true, source: "meta_ads" }]);
      assert.ok(await tx.one("select 1 from notifications where title = 'Adco Main is over its monthly budget'"));
      const r = await clientResults(tx, companyId, today);
      assert.deepEqual(r.ads.map((a) => [a.platform, Number(a.spend), a.clicks, a.conversions]), [["Meta Ads", 7000, 10, 2]]);
    });
  });
});

describe("payments", () => {
  test("a signed Stripe webhook pays the invoice once; forged ones are refused", async () => {
    const inv = await asA(async (tx) => {
      await saveConnection(tx, { provider: "stripe", userId: null, label: "Studio", secret: { secret_key: "sk_test_1", webhook_secret: "whsec_1" } });
      const c = await client(tx, "Payco", "payco.example");
      return sentInvoice(tx, c.companyId);
    });
    const event = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_1", payment_status: "paid", amount_total: inv.total_cents, currency: "zar", metadata: { agency_id: A.agencyId, invoice_id: inv.id } } } });
    const t = Math.floor(Date.now() / 1000);
    const headers = (secret: string) => new Headers({ "stripe-signature": `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${event}`).digest("hex")}` });
    await asA(async (tx) => {
      assert.equal((await handlePaymentWebhook(tx, "stripe", { raw: event, headers: headers("wrong") })).status, 400);
      assert.equal((await handlePaymentWebhook(tx, "stripe", { raw: event, headers: headers("whsec_1") })).body, "recorded");
      assert.equal((await handlePaymentWebhook(tx, "stripe", { raw: event, headers: headers("whsec_1") })).body, "already recorded");
      assert.equal((await tx.one<{ status: string }>("select status from invoices where id = $1", [inv.id]))!.status, "paid");
    });
  });

  test("PayFast signatures match their documented encoding", () => {
    const sig = payfastSignature([["merchant_id", "10000100"], ["merchant_key", "46f0cd694581a"], ["amount", "100.00"], ["item_name", "Invoice #1 (test)"], ["email_address", ""]], "jt7NOE43FZPn");
    // Expected value from Python's quote_plus, which encodes like PHP's urlencode (PayFast's reference).
    assert.equal(sig, "96ff694e5be54b47e70755341ade36c1");
  });
});

describe("whatsapp and links", () => {
  test("webhooks are verified with the app secret and parsed into replies and failures", async () => {
    await asA(async (tx) => {
      await saveConnection(tx, { provider: "whatsapp", userId: null, label: "Studio", secret: { access_token: "w", phone_number_id: "1", app_secret: "app-s" } });
      const conn = (await tx.one<{ id: string }>("select id from connections where provider = 'whatsapp'"))!;
      const raw = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: "27825550101", text: { body: "APPROVE AB12" } }], statuses: [{ id: "wamid.1", status: "failed", errors: [{ title: "Number not on WhatsApp" }] }] } }] }] });
      const sig = `sha256=${createHmac("sha256", "app-s").update(raw).digest("hex")}`;
      const c = { id: conn.id } as Parameters<typeof verifyWhatsapp>[1];
      assert.equal(await verifyWhatsapp(tx, c, raw, sig), true);
      assert.equal(await verifyWhatsapp(tx, c, raw, "sha256=00"), false);
      assert.deepEqual(parseWhatsapp(JSON.parse(raw)), { messages: [{ from: "+27825550101", text: "APPROVE AB12" }], failed: [{ id: "wamid.1", error: "Number not on WhatsApp" }] });
    });
  });

  test("proof links are recognised by provider", () => {
    assert.deepEqual(linkProvider("https://drive.google.com/file/d/1AbCdEfGhIjKlMn/view?usp=sharing"), { provider: "google_drive", id: "1AbCdEfGhIjKlMn" });
    assert.deepEqual(linkProvider("https://www.figma.com/design/AbC123/Launch?node-id=12-34"), { provider: "figma", id: "AbC123", node: "12:34" });
    assert.equal(linkProvider("https://www.dropbox.com/scl/fi/x/file.pdf?dl=0")?.provider, "dropbox");
    assert.equal(linkProvider("not a link"), null);
    assert.match(mimeMessage({ toName: "", to: "a@b.example", subject: "Hi", body: "x" }), /^To: a@b\.example\r\nSubject: Hi\r\n/);
  });
});

describe("crm", () => {
  test("a closed-won HubSpot deal becomes a client with contacts and a job, once", async () => {
    const conn = await asA((tx) => saveConnection(tx, { provider: "hubspot", userId: null, label: "studio.hubspot", secret: { access_token: "h1" }, expiresIn: 1800 }));
    const s = stub([
      [/deals\/search/, () => ({ results: [{ id: "D1", properties: { dealname: `Won Co rebrand ${run}`, amount: "45000", closedate: `${today}T10:00:00Z`, hs_lastmodifieddate: new Date().toISOString() } }] })],
      [/deals\/D1\/associations\/companies/, () => ({ results: [{ toObjectId: 77 }] })],
      [/deals\/D1\/associations\/contacts/, () => ({ results: [{ toObjectId: 5 }] })],
      [/objects\/companies\/77/, () => ({ properties: { name: `Won Co ${run}` } })],
      [/contacts\/batch\/read/, () => ({ results: [{ properties: { firstname: "Sam", lastname: "Lee", email: "sam@wonco.example" } }] })],
    ]);
    try {
      assert.ok((await syncConnection(A.agencyId, conn)).ok);
      assert.ok((await syncConnection(A.agencyId, conn)).ok);
    } finally {
      s.restore();
    }
    await asA(async (tx) => {
      const jobs = await tx.q<{ name: string; fee_cents: number; company: string; contact: string; role: string }>(
        `select j.name, j.fee_cents, co.name as company, c.name as contact, c.role from jobs j join companies co on co.id = j.company_id join contacts c on c.company_id = co.id where co.name = $1`,
        [`Won Co ${run}`],
      );
      assert.deepEqual(jobs, [{ name: `Won Co rebrand ${run}`, fee_cents: 45_000_00, company: `Won Co ${run}`, contact: "Sam Lee", role: "approver" }]);
    });
  });
});

describe("pulling from Toggl and Trello", () => {
  const conn = (provider: string) => asA((tx) => tx.one<Parameters<typeof mapTogglProject>[1]>("select * from connections where provider = $1", [provider]));

  test("Toggl: read everything, add time only for mapped projects and matched people, follow edits and deletions", async () => {
    const mia = await asA(async (tx) => (await tx.one<{ id: string }>("insert into users (agency_id, email, name, password_hash, role, title) values ($1, $2, 'Mia Pulled', 'x', 'staff', 'Designer') returning id", [A.agencyId, `mia-${run}@pull.example`]))!.id);
    await asA((tx) => saveConnection(tx, { provider: "toggl", userId: null, label: "Toggl", secret: { api_token: "tok-1" } }));
    let seconds = 5400;
    let includeSecond = true;
    const routes: Parameters<typeof stub>[0] = [
      [/\/api\/v9\/me$/, () => ({ email: "owner@pull.example", fullname: "Owner", default_workspace_id: 77 })],
      [/workspaces\/77\/clients/, () => [{ id: 1, name: `Pulled Client ${run}` }]],
      [/workspaces\/77\/projects/, () => [{ id: 10, name: "Brand guidelines", client_id: 1, active: true, billable: true }, { id: 11, name: "Pitch", client_id: null, active: true, billable: false }]],
      [/workspaces\/77\/workspace_users/, () => [{ uid: 500, name: "Mia Pulled", email: `MIA-${run}@pull.example` }, { uid: 501, name: "Stranger", email: `stranger-${run}@pull.example` }]],
      [/reports\/api\/v3\/workspace\/77\/search\/time_entries/, () => [
        { user_id: 500, project_id: 10, billable: true, description: "Typography", time_entries: [{ id: 9001, seconds, start: `${today}T08:00:00+02:00`, stop: `${today}T09:30:00+02:00` }] },
        ...(includeSecond ? [{ user_id: 501, project_id: 10, billable: true, description: "Colour", time_entries: [{ id: 9002, seconds: 3600, start: `${today}T10:00:00+02:00` }, { id: 9003, seconds: -1700000000, start: `${today}T11:00:00+02:00` }] }] : []),
      ]],
    ];
    const run1 = stub(routes);
    try {
      const id = (await conn("toggl"))!.id;
      const r = await syncConnection(A.agencyId, id);
      assert.ok(r.ok, r.summary);
      assert.equal(new Headers(run1.calls[0].init.headers).get("authorization"), `Basic ${Buffer.from("tok-1:api_token").toString("base64")}`);
    } finally {
      run1.restore();
    }
    await asA(async (tx) => {
      const n = async (kind: string) => (await tx.one<{ n: number }>("select count(*)::int as n from external_objects where kind = $1", [kind]))!.n;
      assert.deepEqual([await n("toggl_project"), await n("toggl_entry"), await n("toggl_user")], [2, 2, 2], "projects, two real entries (the running timer is skipped), two people");
      assert.equal((await tx.one<{ n: number }>("select count(*)::int as n from time_entries where source = 'import' and notes in ('Typography','Colour')"))!.n, 0, "nothing is added until a project is mapped");
      const matched = await tx.one<{ matched_id: string }>("select matched_id from external_objects where kind = 'toggl_user' and external_id = '500'");
      assert.equal(matched!.matched_id, mia, "matched by email, ignoring case");
    });

    // The owner maps the project: a job awaiting scope under a new client, and Mia's time lands on it.
    const c = (await conn("toggl"))!;
    const jobId = await asA(async (tx) => {
      const id = await mapTogglProject(tx, c, "10", {});
      await applyToggl(tx, c);
      return id;
    });
    await asA(async (tx) => {
      const job = await tx.one<{ status: string; scope_locked_at: Date | null; name: string; client: string }>("select j.status, j.scope_locked_at, j.name, co.name as client from jobs j join companies co on co.id = j.company_id where j.id = $1", [jobId]);
      assert.deepEqual([job!.status, job!.scope_locked_at, job!.name, job!.client], ["in_progress", null, "Brand guidelines", `Pulled Client ${run}`]);
      assert.equal((await tx.one<{ n: number }>("select count(*)::int as n from scope_items where job_id = $1", [jobId]))!.n, 0, "it is waiting for its scope");
      const te = await tx.q<{ user_id: string; hours: number; source: string; category: string }>("select user_id, hours::float, source, category from time_entries where job_id = $1", [jobId]);
      assert.deepEqual(te, [{ user_id: mia, hours: 1.5, source: "import", category: "billable" }], "only the matched person; Stranger waits");
      await matchTogglPerson(tx, c, "501", mia);
      assert.equal((await applyToggl(tx, c)).created, 1);
    });

    // Next day: Mia's entry was edited and the other deleted in Toggl.
    seconds = 7200;
    includeSecond = false;
    const run2 = stub(routes);
    try {
      assert.ok((await syncConnection(A.agencyId, c.id)).ok);
      assert.ok((await syncConnection(A.agencyId, c.id)).ok, "a repeat sync changes nothing");
    } finally {
      run2.restore();
    }
    await asA(async (tx) => {
      const te = await tx.q<{ hours: number }>("select hours::float from time_entries where job_id = $1 order by hours", [jobId]);
      assert.deepEqual(te, [{ hours: 2 }], "edited entry updated, deleted entry removed, nothing duplicated");
    });
  });

  test("Trello: a board becomes a job awaiting scope and its cards become tasks that follow the lists", async () => {
    await asA((tx) => saveConnection(tx, { provider: "trello", userId: null, label: "Trello", secret: { api_key: "key-1", token: "tok-2" } }));
    let list = "Doing";
    const routes: Parameters<typeof stub>[0] = [
      [/members\/me\/boards/, () => [{ id: "b1", name: `Karoo Board ${run}`, url: "https://trello.com/b/b1" }]],
      [/boards\/b1\/lists/, () => [{ id: "l1", name: "Backlog" }, { id: "l2", name: list }]],
      [/boards\/b1\/cards\/open/, () => [
        { id: "c1", name: "Homepage design", desc: "Hero and nav", due: `${today}T10:00:00.000Z`, dueComplete: false, idList: "l2", idMembers: ["m1"] },
        { id: "c2", name: "Sitemap", desc: "", due: null, dueComplete: false, idList: "l1", idMembers: [] },
      ]],
      [/boards\/b1\/members/, () => [{ id: "m1", fullName: "Mia Pulled" }]],
    ];
    const first = stub(routes);
    const c = (await conn("trello"))!;
    try {
      assert.ok((await syncConnection(A.agencyId, c.id)).ok);
      assert.match(first.calls[0].init.headers ? JSON.stringify(first.calls[0].init.headers) : "", /oauth_consumer_key=\\"key-1\\"/, "credentials travel in a header, not the address");
      assert.ok(first.calls.every((x) => !x.url.includes("tok-2")));
      assert.equal((await asA((tx) => tx.q("select 1 from tasks where title = 'Homepage design'"))).length, 0, "nothing until the board is mapped");
      const jobId = await asA((tx) => mapTrelloBoard(tx, c, "b1", { newClientName: `Karoo Client ${run}`, jobName: "Karoo website" }));
      assert.ok((await syncConnection(A.agencyId, c.id)).ok);
      const tasks = await asA((tx) => tx.q<{ title: string; status: string; due_date: string | null; assignee: string | null }>("select t.title, t.status, t.due_date::text, u.name as assignee from tasks t left join users u on u.id = t.assignee_id where t.job_id = $1 order by t.title", [jobId]));
      assert.deepEqual(tasks, [
        { title: "Homepage design", status: "in_progress", due_date: today, assignee: "Mia Pulled" },
        { title: "Sitemap", status: "todo", due_date: null, assignee: null },
      ]);
      list = "Client feedback";
      assert.ok((await syncConnection(A.agencyId, c.id)).ok);
      const after = await asA((tx) => tx.q<{ title: string; status: string }>("select title, status from tasks where job_id = $1 order by title", [jobId]));
      assert.deepEqual(after.map((t) => t.status), ["waiting_client", "todo"]);
      assert.equal(after.length, 2, "no duplicate tasks on repeat syncs");
    } finally {
      first.restore();
    }
  });
});

describe("drafting scope from a quote", () => {
  test("rules when AI is off, Claude when it's on, never saved without review, never on a locked job", async () => {
    const { jobId, companyId } = await asA(async (tx) => {
      const c = await createCompany(tx, { name: `Scope Client ${run}` });
      return { companyId: c, jobId: await createJob(tx, { company_id: c, name: "Drafted job", template_key: "blank" }) };
    });
    const quote = "6 social statics (2 rounds)\n1 campaign video\n40 hours of community management\nVAT 15%";

    // Off by default: rules.
    await adminQuery("update agencies set ai_enabled = false where id = $1", [A.agencyId]);
    const rules = await asA((tx) => draftScope(tx, jobId, quote));
    assert.equal(rules.generatedBy, "rules");
    assert.match(rules.note ?? "", /Turn on 8gent AI/);
    assert.deepEqual(rules.items.map((i) => [i.name, i.quantity, i.unit]), [["social statics", 6, "deliverable"], ["campaign video", 1, "deliverable"], ["community management", 40, "hours"]]);
    assert.equal((await asA((tx) => tx.q("select 1 from scope_items where job_id = $1", [jobId]))).length, 0, "drafting alone saves nothing");

    // On, with a key: the text goes to Claude.
    await adminQuery("update agencies set ai_enabled = true where id = $1", [A.agencyId]);
    process.env.ANTHROPIC_API_KEY = "test-key";
    const reply = '{"items":[{"name":"Social statics","unit":"deliverable","quantity":6,"rounds_allowed":2,"inclusions":"1:1 and 9:16","exclusions":""},{"name":"Community management","unit":"hours","quantity":40,"rounds_allowed":0,"inclusions":"","exclusions":"Paid media"}]}';
    const ai = stub([[/api\.anthropic\.com\/v1\/messages/, () => ({ id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text: reply }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } })]]);
    let drafted;
    try {
      drafted = await asA((tx) => draftScope(tx, jobId, quote));
    } finally {
      ai.restore();
    }
    assert.equal(drafted.generatedBy, "ai");
    assert.deepEqual(drafted.items.map((i) => [i.name, i.quantity, i.exclusions]), [["Social statics", 6, ""], ["Community management", 40, "Paid media"]]);
    assert.match(String(ai.calls[0].init.body), /40 hours of community management/);

    // If the AI is down, the rules reader still gives a draft.
    const down = stub([[/api\.anthropic\.com/, () => new Response("{}", { status: 500 })]]);
    try {
      const fallback = await asA((tx) => draftScope(tx, jobId, quote));
      assert.equal(fallback.generatedBy, "rules");
      assert.match(fallback.note ?? "", /couldn't read that/);
    } finally {
      down.restore();
      delete process.env.ANTHROPIC_API_KEY;
    }

    // Saving the reviewed lines, then locking stops further drafting.
    await asA((tx) => saveScopeDraft(tx, jobId, drafted.items));
    assert.equal((await asA((tx) => tx.q("select 1 from scope_items where job_id = $1", [jobId]))).length, 2);
    await asA((tx) => tx.q("update jobs set scope_locked_at = now() where id = $1", [jobId]));
    await assert.rejects(asA((tx) => draftScope(tx, jobId, quote)), /locked/);
    await assert.rejects(asA((tx) => draftScope(tx, jobId, "ab")), /Paste the text/);
    void companyId;
  });
});
