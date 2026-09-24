import fs from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import imageLibrary from "./data/image_library.json";
import { onepagerFiles } from "./server/plugin";

/**
 * Web build: copy the TG crops the image library lists (not the contact sheets) into docs/tg/.
 * Stops the build if any is missing, so a rebuild without the crops can't silently drop them from the site.
 */
function publishTgImages(): Plugin {
  return {
    name: "publish-tg-images",
    apply: "build",
    closeBundle() {
      const src = path.resolve(__dirname, "assets/tg");
      const out = path.resolve(__dirname, "docs/tg");
      const ids = (imageLibrary as { images: { image_id: string }[] }).images.map((i) => i.image_id);
      const missing = ids.filter((id) => !fs.existsSync(path.join(src, `${id}.png`)));
      if (missing.length) throw new Error(`TG crops missing in assets/tg (run \`npm run images\` first): ${missing.join(", ")}`);
      fs.mkdirSync(out, { recursive: true });
      for (const id of ids) fs.copyFileSync(path.join(src, `${id}.png`), path.join(out, `${id}.png`));
    },
  };
}

// `npm run build:pages` (mode "pages") builds the web version into docs/ for GitHub Pages:
// no server, relative paths, and the TG crops in docs/tg/.
export default defineConfig(({ mode }) => ({
  plugins: [react(), onepagerFiles(), ...(mode === "pages" ? [publishTgImages()] : [])],
  base: mode === "pages" ? "./" : "/",
  // TG crops (git-ignored) are served at /tg/<image_id>.png
  publicDir: mode === "pages" ? false : "assets",
  build: mode === "pages" ? { outDir: "docs", emptyOutDir: true } : undefined,
  server: {
    port: 5178,
    strictPort: true,
  },
}));
