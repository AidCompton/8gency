// Applies migrations/*.sql in order as the admin role, then grants the app role
// table privileges. RLS policies (not grants) do the tenant isolation.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { requireEnv } from "./env";

async function main() {
  const client = new Client({ connectionString: requireEnv("DATABASE_ADMIN_URL") });
  await client.connect();
  const appUser = decodeURIComponent(new URL(requireEnv("DATABASE_URL")).username);

  await client.query(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
  const applied = new Set((await client.query("select name from schema_migrations")).rows.map((r) => r.name));
  const files = readdirSync("migrations").filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join("migrations", file), "utf8");
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
      console.log(`applied ${file}`);
    } catch (e) {
      await client.query("rollback");
      throw new Error(`Migration ${file} failed: ${(e as Error).message}`);
    }
  }

  await client.query(`grant usage on schema public to "${appUser}"`);
  await client.query(`grant select, insert, update, delete on all tables in schema public to "${appUser}"`);
  await client.query(`grant usage, select on all sequences in schema public to "${appUser}"`);
  await client.query(`revoke all on schema_migrations from "${appUser}"`);
  await client.end();
  console.log("migrations up to date");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
