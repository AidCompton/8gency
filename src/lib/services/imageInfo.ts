/** A picture's size and a tiny blurred preview of it (a data URL of about 300 bytes), or null if it can't be read. */
export async function imageInfo(bytes: Uint8Array): Promise<{ width: number; height: number; placeholder: string } | null> {
  try {
    // sharp comes with Next; if it isn't installed the picture just has no placeholder.
    const sharp = (await import("sharp")).default;
    const meta = await sharp(bytes, { failOn: "none" }).metadata();
    if (!meta.width || !meta.height) return null;
    const turned = (meta.orientation ?? 1) >= 5; // phone photos are often stored rotated
    const tiny = await sharp(bytes, { failOn: "none" }).rotate().resize(24, 24, { fit: "inside" }).blur(1).jpeg({ quality: 40 }).toBuffer();
    return { width: turned ? meta.height : meta.width, height: turned ? meta.width : meta.height, placeholder: `data:image/jpeg;base64,${tiny.toString("base64")}` };
  } catch {
    return null;
  }
}
