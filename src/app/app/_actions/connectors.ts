"use server";
import { act, str } from "@/lib/actions";
import { requireUser, tenant } from "@/lib/auth";
import { CONNECTORS } from "@/lib/domain/connectors";
import { UserError } from "@/lib/services/core";

/** "We want this": records (or withdraws) the agency's interest in a connector, to prioritise the roadmap. */
export async function toggleConnectorRequestAction(fd: FormData) {
  const user = await requireUser();
  const key = str(fd, "connector");
  await act("/app/connectors", () =>
    tenant(user, async (tx) => {
      const c = CONNECTORS.find((x) => x.key === key);
      if (!c) throw new UserError("Unknown connector.");
      const removed = await tx.q("delete from connector_requests where connector = $1 returning connector", [key]);
      if (!removed.length) {
        await tx.q("insert into connector_requests (agency_id, connector, user_id) values ($1,$2,$3)", [tx.agencyId, key, user.id]);
        await tx.audit("connector.requested", "connector", null, undefined, { connector: c.name });
      }
      return `/app/connectors#${key}`;
    }),
  );
}
