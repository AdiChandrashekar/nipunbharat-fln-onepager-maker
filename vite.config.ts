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
  },
});
