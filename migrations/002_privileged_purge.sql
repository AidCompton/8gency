-- Approvals and audit events stay immutable for the application role. Only a
-- role with BYPASSRLS (the admin connection) may delete them, which is what
-- deleting a whole agency on request (M27, POPIA/GDPR erasure) needs.
create or replace function forbid_mutation() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and (select rolbypassrls from pg_roles where rolname = current_user) then
    return old;
  end if;
  raise exception '% rows are immutable', tg_table_name;
end $$;
