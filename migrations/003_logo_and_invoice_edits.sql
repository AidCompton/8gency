-- Agency logo: shown in the app sidebar, on the client hub and on invoices.
-- Stored in the row (small images only, capped in the app at 512 KB) so it
-- follows tenant RLS and backups with no extra file store.
alter table agencies
  add column logo bytea,
  add column logo_mime text not null default '',
  add column logo_updated_at timestamptz;

alter table agencies add constraint agencies_logo_mime check (logo_mime in ('', 'image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'));
alter table agencies add constraint agencies_logo_size check (logo is null or octet_length(logo) <= 524288);
