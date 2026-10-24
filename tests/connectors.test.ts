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
import { addContact, createAgencyWithOwner, createCompany } from "../src/lib/services/agency";
import { saveAutomation } from "../src/lib/services/automations";
import { createInvoice, readyToBill, sendInvoice } from "../src/lib/services/billing";
import { queueMessage } from "../src/lib/services/core";
import { createJob, lockScope, setJobStatus } from "../src/lib/services/jobs";
import { timesheetSuggestions } from "../src/lib/services/time";
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
