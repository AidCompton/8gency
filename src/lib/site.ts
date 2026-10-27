// Who we are, for the public pages (privacy policy, terms, footer). Set these in the environment once the company
// exists; until then the pages say registration is in progress rather than inventing details.
const domain = process.env.SITE_DOMAIN || "8gency.co.za";

export const SITE = {
  name: "8gency",
  domain,
  url: process.env.SITE_URL || `https://${domain}`,
  legalName: process.env.SITE_LEGAL_NAME || "8gency (company registration in progress)",
  registration: process.env.SITE_REGISTRATION || "",
  address: process.env.SITE_ADDRESS || "",
  infoOfficer: process.env.SITE_INFO_OFFICER || "",
  email: { hello: `hello@${domain}`, support: `support@${domain}`, privacy: `privacy@${domain}`, security: `security@${domain}` },
  /** The last time the privacy policy or terms changed in substance. */
  legalUpdated: "27 October 2026",
};
