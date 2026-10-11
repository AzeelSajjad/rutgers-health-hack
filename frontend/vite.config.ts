import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": { target: process.env.ENCOUNTER_BACKEND_URL || "http://localhost:3001" }, "/ws": { target: (process.env.ENCOUNTER_BACKEND_URL || "http://localhost:3001").replace(/^http/, "ws"), ws: true } },
  },
});
