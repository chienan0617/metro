import { defineConfig } from "vite";

export default defineConfig({
  // 相對路徑：build 產物可直接放在任何子目錄（例如 GitHub Pages 的 /metro/）播放。
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
