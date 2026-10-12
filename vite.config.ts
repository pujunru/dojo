import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// A static site: the content build writes JSON under public/content/, and the
// app fetches it at runtime. No server.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
});
