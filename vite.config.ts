import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { onepagerFiles } from "./server/plugin";

export default defineConfig({
  plugins: [react(), onepagerFiles()],
  // TG crops (git-ignored) are served at /tg/<image_id>.png
  publicDir: "assets",
  server: {
    port: 5178,
    strictPort: true,
    // compendium.json and web/translations_hi.json live one level up (read-only).
    fs: { allow: [path.resolve(__dirname, "..")] },
  },
});
