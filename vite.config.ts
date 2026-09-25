import { defineConfig } from "vite";

// Tauri expects a fixed port and must see Rust compile errors in the terminal.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "es2022",
    // A desktop app loads from disk; one bundle is fine.
    chunkSizeWarningLimit: 2000,
  },
});
