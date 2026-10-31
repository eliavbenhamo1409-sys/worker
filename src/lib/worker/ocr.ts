/**
 * OCR for the worker app: the photographed delivery note is downscaled in the
 * browser and sent to /api/ocr, where Gemini reads it and returns its lines.
 * The receive flow shows those lines as "scanned" for the worker to confirm.
 *
 * Throws on failure (missing key, network, model error) so the UI can tell the
 * worker to type the lines by hand; an empty array means "nothing recognised".
 */

export type ScannedLine = {
  /** Product name exactly as written on the note. */
  externalName: string;
  /** Supplier's SKU, when printed on the note. */
  externalSku?: string | null;
  qty: number;
  /** "service" = work such as cutting or delivery; it never touches stock. */
  kind: "product" | "service";
};

const MAX_EDGE = 1600;

/** Shrink the photo to ≤1600px JPEG so the upload is fast and the model cheap. */
async function downscale(file: File): Promise<Blob> {
  if (typeof createImageBitmap !== "function") return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.type === "image/jpeg") return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    return blob ?? file;
  } catch {
    return file;
  }
}

export async function parseDeliveryNote(file: File): Promise<ScannedLine[]> {
  const body = new FormData();
  body.append("file", await downscale(file), "note.jpg");
  const res = await fetch("/api/ocr", { method: "POST", body });
  const json = (await res.json().catch(() => ({}))) as { lines?: ScannedLine[]; error?: string };
  if (!res.ok) throw new Error(json.error ?? "קריאת התעודה נכשלה");
  return json.lines ?? [];
}
