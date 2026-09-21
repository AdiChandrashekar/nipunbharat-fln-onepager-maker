/**
 * Dev-server plugin: the tool's only "backend". Reads/writes documents on disk and serves uploads.
 * Also runs the PDF/PNG exporters (server/exporters/, headless Chromium via Playwright).
 */
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { pending } from "./exporters/browser";
import { exportPdf } from "./exporters/pdf";
import { exportPng, zipFiles } from "./exporters/png";

const DOCS = path.resolve(__dirname, "../documents");
const UPLOADS = path.join(DOCS, "uploads");
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,120}$/i;
const EXPORTS = path.resolve(__dirname, "../exports");

/** ASCII file stem for downloads: document id plus date (titles are often Hindi). */
function stem(doc: { id?: string }): string {
  return `${(doc.id ?? "onepager").replace(/[^a-z0-9-]+/gi, "-")}-${new Date().toISOString().slice(0, 10)}`;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function onepagerFiles(): Plugin {
  return {
    name: "onepager-files",
    configureServer(server) {
      fs.mkdirSync(UPLOADS, { recursive: true });
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://x");
        try {
          // Render view fetches the document it should print: GET /api/render/<token>
          const rt = /^\/api\/render\/([^/]+)$/.exec(url.pathname);
          if (rt && req.method === "GET") {
            const doc = pending.get(decodeURIComponent(rt[1]));
            return doc ? send(res, 200, doc) : send(res, 404, { error: "unknown render token" });
          }
          // Export: POST /api/export?format=pdf|png&dpi=150|300&bleed=0|1, body = document JSON → file download.
          // A copy is kept in onepager/exports/ (git-ignored).
          if (url.pathname === "/api/export" && req.method === "POST") {
            const doc = JSON.parse((await readBody(req)).toString("utf-8"));
            const format = url.searchParams.get("format");
            const bleed = url.searchParams.get("bleed") === "1";
            const origin = `http://localhost:${server.config.server.port ?? 5178}`;
            fs.mkdirSync(EXPORTS, { recursive: true });
            let name: string, type: string, data: Buffer;
            if (format === "pdf") {
              data = await exportPdf(origin, doc, { bleed });
              name = `${stem(doc)}.pdf`;
              type = "application/pdf";
            } else if (format === "png") {
              const dpi = Math.min(600, Math.max(72, Number(url.searchParams.get("dpi") ?? 150)));
              const { files } = await exportPng(origin, doc, { bleed, dpi });
              if (files.length === 1) {
                data = files[0].data;
                name = `${stem(doc)}-${dpi}dpi.png`;
                type = "image/png";
              } else {
                data = zipFiles(files);
                name = `${stem(doc)}-${dpi}dpi.zip`;
                type = "application/zip";
              }
            } else return send(res, 400, { error: "format must be pdf or png" });
            fs.writeFileSync(path.join(EXPORTS, name), data);
            res.statusCode = 200;
            res.setHeader("Content-Type", type);
            res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
            res.setHeader("X-Export-Path", `onepager/exports/${name}`);
            return res.end(data);
          }
          // GET /api/documents → list; GET/PUT/DELETE /api/documents/<id>
          if (url.pathname === "/api/documents" && req.method === "GET") {
            const list = fs.readdirSync(DOCS).filter((f) => f.endsWith(".json")).map((f) => {
              const doc = JSON.parse(fs.readFileSync(path.join(DOCS, f), "utf-8"));
              return { id: doc.id, title: doc.title, updated: doc.meta?.updated, page: doc.page };
            });
            return send(res, 200, list);
          }
          const m = /^\/api\/documents\/([^/]+)$/.exec(url.pathname);
          if (m) {
            const id = decodeURIComponent(m[1]);
            if (!SAFE_ID.test(id)) return send(res, 400, { error: "bad id" });
            const file = path.join(DOCS, `${id}.json`);
            if (req.method === "GET") {
              if (!fs.existsSync(file)) return send(res, 404, { error: "not found" });
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              return res.end(fs.readFileSync(file));
            }
            if (req.method === "PUT") {
              const doc = JSON.parse((await readBody(req)).toString("utf-8"));
              if (doc.id !== id) return send(res, 400, { error: "id mismatch" });
              fs.writeFileSync(file, JSON.stringify(doc, null, 1), "utf-8");
              return send(res, 200, { ok: true });
            }
            if (req.method === "DELETE") {
              if (fs.existsSync(file)) fs.unlinkSync(file);
              return send(res, 200, { ok: true });
            }
          }
          // Upload an image: POST /api/uploads?name=<original name>, raw bytes in the body → { file }
          if (url.pathname === "/api/uploads" && req.method === "POST") {
            const orig = (url.searchParams.get("name") ?? "image").toLowerCase();
            const ext = path.extname(orig);
            if (![".png", ".jpg", ".jpeg", ".webp", ".svg"].includes(ext)) return send(res, 400, { error: "Use a PNG, JPEG, WebP or SVG image" });
            const body = await readBody(req);
            if (body.length > 15 * 1024 * 1024) return send(res, 413, { error: "Image is larger than 15 MB" });
            const base = path.basename(orig, ext).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "image";
            const name = `${Date.now().toString(36)}-${base}${ext}`;
            fs.writeFileSync(path.join(UPLOADS, name), body);
            return send(res, 200, { file: name });
          }
          // Uploaded images: GET /uploads/<file>
          const u = /^\/uploads\/([^/]+)$/.exec(url.pathname);
          if (u && req.method === "GET") {
            const name = decodeURIComponent(u[1]);
            const file = path.join(UPLOADS, name);
            if (!SAFE_ID.test(name) || !fs.existsSync(file)) return send(res, 404, { error: "not found" });
            const ext = path.extname(name).toLowerCase();
            res.setHeader("Content-Type", { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml" }[ext] ?? "application/octet-stream");
            return res.end(fs.readFileSync(file));
          }
        } catch (e) {
          return send(res, 500, { error: String(e) });
        }
        next();
      });
    },
  };
}
