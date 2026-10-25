import { adminQuery } from "@/lib/db";

/** For the host's health check and the status page: is the app up and can it reach the database? Says nothing else. */
export async function GET() {
  try {
    await adminQuery("select 1");
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
