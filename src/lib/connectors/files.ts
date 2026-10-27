import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Tx } from "../db";
import { UserError } from "../services/core";
import { UPLOAD_ROOT } from "../services/review";
import { activeConnection, api, upsertObject, type Conn } from "./connections";
import type { ProviderKey } from "./providers";

// Proof straight from where the work lives: a Drive, Dropbox or Figma link
// becomes a new version. Approved finals are filed back in the client's folder.

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Fetched {
  name: string;
  type: string;
  bytes: Buffer;
}

export function linkProvider(url: string): { provider: ProviderKey; id: string; node?: string } | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "");
  if (host === "drive.google.com" || host === "docs.google.com") {
    const id = u.pathname.match(/\/d\/([\w-]{10,})/)?.[1] ?? u.searchParams.get("id");
    return id ? { provider: "google_drive", id } : null;
  }
  if (host.endsWith("dropbox.com")) return { provider: "dropbox", id: u.toString() };
  if (host.endsWith("figma.com")) {
    const id = u.pathname.match(/\/(?:file|design|proto)\/([\w]+)/)?.[1];
    return id ? { provider: "figma", id, node: u.searchParams.get("node-id")?.replace("-", ":") ?? undefined } : null;
  }
  return null;
}

const NAMES: Partial<Record<ProviderKey, string>> = { google_drive: "Google Drive", dropbox: "Dropbox", figma: "Figma" };

export async function fetchFromLink(tx: Tx, url: string): Promise<Fetched> {
  const link = linkProvider(url);
  if (!link) throw new UserError("Paste a Google Drive, Dropbox or Figma link.");
  const conn = await activeConnection(tx, link.provider);
  if (!conn) throw new UserError(`Connect ${NAMES[link.provider]} first (Connectors).`);
  const bytes = async (res: Response) => Buffer.from(await res.arrayBuffer());

  if (link.provider === "google_drive") {
    const f = await api(tx, conn, `https://www.googleapis.com/drive/v3/files/${link.id}?fields=name,mimeType&supportsAllDrives=true`);
    // Google Docs, Sheets and Slides have no file of their own: export them as PDF.
    if (String(f.mimeType).startsWith("application/vnd.google-apps.")) {
      const res = await api<Response>(tx, conn, `https://www.googleapis.com/drive/v3/files/${link.id}/export?mimeType=application/pdf`, { raw: true });
      return { name: `${f.name}.pdf`, type: "application/pdf", bytes: await bytes(res) };
    }
    const res = await api<Response>(tx, conn, `https://www.googleapis.com/drive/v3/files/${link.id}?alt=media&supportsAllDrives=true`, { raw: true });
    return { name: f.name, type: f.mimeType, bytes: await bytes(res) };
  }

  if (link.provider === "dropbox") {
    const res = await api<Response>(tx, conn, "https://content.dropboxapi.com/2/sharing/get_shared_link_file", {
      method: "POST",
      raw: true,
      headers: { "dropbox-api-arg": JSON.stringify({ url: link.id }), accept: "*/*" },
    });
    const meta = JSON.parse(res.headers.get("dropbox-api-result") ?? "{}");
    return { name: meta.name ?? "dropbox-file", type: res.headers.get("content-type") ?? "application/octet-stream", bytes: await bytes(res) };
  }

  if (!link.node) throw new UserError("Copy the link to a frame in Figma (right-click the frame › Copy link), so we know what to proof.");
  const nodes = await api(tx, conn, `https://api.figma.com/v1/files/${link.id}/nodes?ids=${encodeURIComponent(link.node)}&depth=1`);
  const frame = nodes.nodes?.[link.node]?.document?.name ?? "Frame";
  const img = await api(tx, conn, `https://api.figma.com/v1/images/${link.id}?ids=${encodeURIComponent(link.node)}&format=png&scale=2`);
  const src = img.images?.[link.node];
  if (!src) throw new UserError("Figma couldn't render that frame.");
  const res = await fetch(src);
  if (!res.ok) throw new UserError("Couldn't download the rendered frame from Figma.");
  return { name: `${nodes.name ?? "Figma"} – ${frame}.png`.replace(/[\\/]/g, "-"), type: "image/png", bytes: await bytes(res) };
}

/** A Drive folder link or ID, or a Dropbox path, as entered against a client. */
export function folderId(provider: ProviderKey, input: string) {
  const v = input.trim();
  if (provider === "google_drive") return v.match(/folders\/([\w-]{10,})/)?.[1] ?? v.match(/^[\w-]{10,}$/)?.[0] ?? null;
  return v ? `/${v.replace(/^\/+|\/+$/g, "")}` : null;
}

/** File the approved version of each deliverable (approved since connecting) in its client's mapped folder. */
export async function fileFinals(tx: Tx, conn: Conn) {
  const rows = await tx.q<{ deliverable_id: string; name: string; file_name: string; file_path: string; mime: string; folder: string; job_number: string }>(
    `select d.id as deliverable_id, d.name, v.file_name, v.file_path, v.mime, m.external_id as folder, j.number as job_number
       from deliverables d join jobs j on j.id = d.job_id
       join connection_mappings m on m.connection_id = $1 and m.company_id = j.company_id
       join lateral (select * from versions v where v.deliverable_id = d.id order by number desc limit 1) v on true
      where d.status = 'approved' and d.approved_at >= $2
        and not exists (select 1 from external_objects o where o.connection_id = $1 and o.kind = 'final' and o.external_id = d.id::text)
      limit 20`,
    [conn.id, conn.created_at],
  );
  for (const r of rows) {
    const body = await readFile(join(UPLOAD_ROOT, r.file_path));
    const name = `${r.job_number} ${r.name} – ${r.file_name}`.replace(/[\\/:*?"<>|]/g, "-");
    let id: string;
    if (conn.provider === "google_drive") {
      const boundary = `8g${Date.now()}`;
      const multipart = Buffer.concat([
        Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [r.folder] })}\r\n--${boundary}\r\ncontent-type: ${r.mime}\r\n\r\n`),
        body,
        Buffer.from(`\r\n--${boundary}--`),
      ]);
      const f = await api(tx, conn, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id", {
        method: "POST",
        headers: { "content-type": `multipart/related; boundary=${boundary}` },
        body: multipart,
      });
      id = f.id;
    } else {
      const f = await api(tx, conn, "https://content.dropboxapi.com/2/files/upload", {
        method: "POST",
        headers: { "content-type": "application/octet-stream", "dropbox-api-arg": JSON.stringify({ path: `${r.folder}/${name}`.replace(/[^\x20-\x7e]/g, "-"), mode: "add", autorename: true }) },
        body,
      });
      id = f.id;
    }
    await upsertObject(tx, conn, { kind: "final", externalId: r.deliverable_id, payload: { file: id, name }, matchedType: "deliverable", matchedId: r.deliverable_id });
  }
  return `${rows.length} approved finals filed`;
}
