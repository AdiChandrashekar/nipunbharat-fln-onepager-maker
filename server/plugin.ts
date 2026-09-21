/**
 * Dev-server plugin: the tool's only "backend". Reads/writes documents on disk and serves uploads.
 * (Phase 5 adds the Playwright export endpoints here.)
 */
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

const DOCS = path.resolve(__dirname, "../documents");
const UPLOADS = path.join(DOCS, "uploads");
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,120}$/i;

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
