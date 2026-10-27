// Invite an agency to 8gency (sign-up is closed). Sends the invitation email
// when a mail provider is set up, and always prints the link so you can send it yourself.
//   npm run invite -- pat@agency.co.za "Pat Pilot"
import "./env";
import { closePools } from "../src/lib/db";
import { createAgencyInvite } from "../src/lib/services/accountAuth";

const [email, name = ""] = process.argv.slice(2);
if (!email) {
  console.error('Usage: npm run invite -- email@agency.co.za "Their Name"');
  process.exit(1);
}
createAgencyInvite(email, name)
  .then((link) => console.log(`Invitation for ${email} (valid 14 days):\n${link}`))
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => closePools());
