import process from "node:process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Front chama /api/* → o proxy encaminha para o back-end na porta 4000.
// Se o back-end estiver noutra porta, ajuste o target abaixo.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: process.env.API_TARGET || "http://127.0.0.1:4000",
        changeOrigin: true,
      },
    },
  },
});
