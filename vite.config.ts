import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    port: 5001,
    host: "0.0.0.0"
  },
  preview: {
    port: 5001,
    host: "0.0.0.0"
  }
});
