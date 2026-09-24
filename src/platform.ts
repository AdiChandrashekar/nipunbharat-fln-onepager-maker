/**
 * Where documents live. Running locally (`npm run dev`) the dev-server plugin keeps them in documents/.
 * The web version (GitHub Pages, `npm run build:pages`) has no server: documents are kept in this
 * browser's storage and can be downloaded / opened as .json files; uploaded images are embedded in
 * the document as data URLs; export runs in the browser (see export/browserExport.ts).
 */
import type { OnePagerDocument } from "./model/types";

export const WEB = import.meta.env.MODE === "pages";

export interface DocSummary { id: string; title: string; updated?: string }

const KEY = "onepager-maker:doc:";

function localList(): DocSummary[] {
  const out: DocSummary[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k?.startsWith(KEY)) continue;
    try {
      const d = JSON.parse(localStorage.getItem(k)!) as OnePagerDocument;
      out.push({ id: d.id, title: d.title, updated: d.meta?.updated });
    } catch { /* skip unreadable entries */ }
  }
  return out;
}

export const docStore = {
  /** Human-readable place the document went, for the status message. */
  where: (id: string) => (WEB ? "this browser (use Download to keep a file)" : `documents/${id}.json`),

  async list(): Promise<DocSummary[]> {
    if (WEB) return localList();
    return (await fetch("/api/documents")).json();
  },

  async get(id: string): Promise<unknown> {
    if (WEB) {
      const s = localStorage.getItem(KEY + id);
      if (!s) throw new Error("not found");
      return JSON.parse(s);
    }
    return (await fetch(`/api/documents/${encodeURIComponent(id)}`)).json();
  },

  async put(doc: OnePagerDocument): Promise<void> {
    if (WEB) {
      try {
        localStorage.setItem(KEY + doc.id, JSON.stringify(doc));
      } catch {
        throw new Error("browser storage is full (large uploaded images?). Use Download to keep a file instead");
      }
      return;
    }
    const res = await fetch(`/api/documents/${encodeURIComponent(doc.id)}`, { method: "PUT", body: JSON.stringify(doc) });
    if (!res.ok) throw new Error((await res.json()).error);
  },

  async remove(id: string): Promise<void> {
    if (WEB) localStorage.removeItem(KEY + id);
    else await fetch(`/api/documents/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
};

/** Offer a blob as a download. */
export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** ASCII file stem for downloads: document id plus date (titles are often Hindi). Same as the server's. */
export function fileStem(doc: { id?: string }): string {
  return `${(doc.id ?? "onepager").replace(/[^a-z0-9-]+/gi, "-")}-${new Date().toISOString().slice(0, 10)}`;
}

/** Ask the user for a .json document file and parse it. */
export function pickJsonFile(): Promise<unknown | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      try { resolve(JSON.parse(await f.text())); } catch { reject(new Error(`${f.name} is not a One-Pager document`)); }
    };
    input.click();
  });
}
