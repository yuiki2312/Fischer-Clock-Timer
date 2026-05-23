import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves the app under /Fischer-Clock-Timer/, but Vercel serves it
// at the root domain. Vercel sets the VERCEL env var during the build, so use the
// root base there to keep asset URLs valid (otherwise the page renders blank).
export default defineConfig({
  base: process.env.VERCEL ? "/" : "/Fischer-Clock-Timer/",
  plugins: [react()],
});
