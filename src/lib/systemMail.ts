import { adminQuery } from "./db";
import { UserError } from "./services/core";

/**
 * 8gency's own email: password resets, team invites, the waitlist invitation.
 * Never used for an agency's clients. Those go out from the agency's own mailbox.
 * Set RESEND_API_KEY and SYSTEM_MAIL_FROM (an address on a domain you've verified
 * with Resend). Without them, outside production the message is kept in the
 * system_mail table so it can be read in development and tests.
 */
export async function sendSystemMail(m: { to: string; subject: string; text: string }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.SYSTEM_MAIL_FROM;
  if (key && from) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.text }),
    });
    if (!res.ok) throw new UserError("We couldn't send that email just now. Try again in a minute.");
    return;
  }
  if (process.env.NODE_ENV === "production") throw new UserError("Account email isn't set up on this server yet.");
  await adminQuery("insert into system_mail (to_address, subject, body) values ($1,$2,$3)", [m.to, m.subject, m.text]);
}
