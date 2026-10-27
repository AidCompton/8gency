// Creates the two database roles and the database. Run once per environment.
//   npm run db:setup            create roles + database if missing
//   npm run db:setup -- --reset drop and recreate the database
import { Client } from "pg";
import { requireEnv } from "./env";

const reset = process.argv.includes("--reset");

function parse(url: string) {
  const u = new URL(url);
  return { user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), db: u.pathname.slice(1) };
}

async function main() {
  const superClient = new Client({ connectionString: requireEnv("POSTGRES_SUPERUSER_URL") });
  await superClient.connect();
  const app = parse(requireEnv("DATABASE_URL"));
  const admin = parse(requireEnv("DATABASE_ADMIN_URL"));
  const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

  for (const [role, attrs] of [
    [admin, "LOGIN BYPASSRLS"],
    [app, "LOGIN NOBYPASSRLS"],
  ] as const) {
    const exists = await superClient.query("select 1 from pg_roles where rolname = $1", [role.user]);
    const verb = exists.rowCount ? "ALTER" : "CREATE";
    await superClient.query(`${verb} ROLE ${ident(role.user)} ${attrs} PASSWORD ${lit(role.password)}`);
    console.log(`${verb.toLowerCase()}d role ${role.user}`);
  }

  if (reset) {
    await superClient.query(`DROP DATABASE IF EXISTS ${ident(admin.db)} WITH (FORCE)`);
    console.log(`dropped database ${admin.db}`);
  }
  const db = await superClient.query("select 1 from pg_database where datname = $1", [admin.db]);
  if (!db.rowCount) {
    await superClient.query(`CREATE DATABASE ${ident(admin.db)} OWNER ${ident(admin.user)}`);
    console.log(`created database ${admin.db}`);
  }
  await superClient.query(`GRANT CONNECT ON DATABASE ${ident(admin.db)} TO ${ident(app.user)}`);
  await superClient.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
