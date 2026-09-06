import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.SOVARA_API_URL ?? "http://127.0.0.1:8000",
        changeOrigin: false,
      },
    },
  },
  preview: { port: 4173 },
  test: {
    globals: true, // lets @testing-library/react auto-cleanup between tests
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
