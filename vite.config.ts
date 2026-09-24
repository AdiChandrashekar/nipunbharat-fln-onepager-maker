import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { onepagerFiles } from "./server/plugin";

// `npm run build:pages` (mode "pages") builds the web version into docs/ for GitHub Pages:
// no server, relative paths, and no TG crops (assets/ is not copied).
export default defineConfig(({ mode }) => ({
  plugins: [react(), onepagerFiles()],
  base: mode === "pages" ? "./" : "/",
  // TG crops (git-ignored) are served at /tg/<image_id>.png
  publicDir: mode === "pages" ? false : "assets",
  build: mode === "pages" ? { outDir: "docs", emptyOutDir: true } : undefined,
  server: {
    port: 5178,
    strictPort: true,
  },
}));
