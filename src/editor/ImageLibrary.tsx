import { useRef, useState } from "react";
import { imagesForBucket, imagesForCompetency, imagesForRoutine, imagesForStrategy, libraryImages, strategyById } from "../data/compendium";
import type { Binding } from "../model/types";
import { WEB } from "../platform";
import { imageUrl } from "../render/styles";

export interface PickedImage {
  image_ref: string;
  natural_px: [number, number];
  alt: string;
}

/** Natural pixel size of an uploaded file (the model records it so exporters needn't load the image). */
function naturalSize(url: string): Promise<[number, number]> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve([img.naturalWidth || 1000, img.naturalHeight || 1000]);
    img.onerror = reject;
    img.src = url;
  });
}

export async function uploadImage(file: File): Promise<PickedImage> {
  if (WEB) {
    // No server: embed the image in the document as a data URL.
    if (!/\.(png|jpe?g|webp|svg)$/i.test(file.name)) throw new Error("Use a PNG, JPEG, WebP or SVG image");
    if (file.size > 3 * 1024 * 1024) throw new Error("Image is larger than 3 MB; make it smaller first (it is stored inside the document)");
    const data = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.onerror = () => rej(r.error);
      r.readAsDataURL(file);
    });
    return { image_ref: data, natural_px: await naturalSize(data), alt: file.name };
  }
  const res = await fetch(`/api/uploads?name=${encodeURIComponent(file.name)}`, { method: "POST", body: file });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "Upload failed");
  const natural = await naturalSize(`/uploads/${body.file}`);
  return { image_ref: `upload:${body.file}`, natural_px: natural, alt: file.name };
}

/** Library filtered by the element's binding: its strategy's images first, then its competencies', then all. */
export function ImageLibrary({ binding, lang, onPick, onClose }: {
  binding?: Binding; lang: "hi" | "en" | "bi"; onPick: (p: PickedImage) => void; onClose: () => void;
}) {
  const [all, setAll] = useState(false);
  const [error, setError] = useState<string>();
  const file = useRef<HTMLInputElement>(null);
  const suggested = new Set<string>();
  if (binding?.strategy_id) {
    imagesForStrategy(binding.strategy_id).forEach((i) => suggested.add(i));
    strategyById.get(binding.strategy_id)?.competency_ids.forEach((c) => imagesForCompetency(c).forEach((i) => suggested.add(i)));
  }
  if (binding?.routine_id) imagesForRoutine(binding.routine_id).forEach((i) => suggested.add(i));
  if (binding?.competency_id) imagesForCompetency(binding.competency_id).forEach((i) => suggested.add(i));
  if (binding?.bucket_id) imagesForBucket(binding.bucket_id).forEach((i) => suggested.add(i));
  const showAll = all || suggested.size === 0;
  const list = showAll ? libraryImages : libraryImages.filter((i) => suggested.has(i.image_id)).sort((a, b) => [...suggested].indexOf(a.image_id) - [...suggested].indexOf(b.image_id));

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Choose an image" onClick={(e) => e.stopPropagation()}>
        <header>
          <strong>Choose an image</strong>
          <div className="seg small">
            <button aria-pressed={!showAll} disabled={suggested.size === 0} onClick={() => setAll(false)}>Suggested ({suggested.size})</button>
            <button aria-pressed={showAll} onClick={() => setAll(true)}>All TG images ({libraryImages.length})</button>
          </div>
          <button onClick={() => file.current?.click()}>Upload my own…</button>
          <input ref={file} type="file" accept=".png,.jpg,.jpeg,.webp,.svg" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try { onPick(await uploadImage(f)); } catch (err) { setError(String((err as Error).message)); }
          }} />
          <button className="x" onClick={onClose} aria-label="Close">×</button>
        </header>
        {error && <p className="limit-msg warn">{error}</p>}
        {!libraryImages.length && <p className="hint">The Sandarshika illustrations are not included in the web version. Use <b>Upload my own…</b> to add an image.</p>}
        <div className="lib-grid">
          {list.map((im) => (
            <button key={im.image_id} className="lib-item" onClick={() => onPick({ image_ref: `tg:${im.image_id}`, natural_px: [im.width_px, im.height_px], alt: lang === "en" ? im.caption_en : im.caption_hi })}>
              <img src={imageUrl(`tg:${im.image_id}`)} alt={im.caption_en} loading="lazy" />
              <span>{lang === "en" ? im.caption_en : im.caption_hi}<small>p.{im.source.printed_page} · {im.kind}</small></span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
