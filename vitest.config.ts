import { defineConfig } from "vitest/config";
import path from "path";

// Tests unitaires. Alias @/ resolu vers ./src pour matcher tsconfig: certains
// tests importent des modules via @/ (ex: @/lib/locales, @/lib/scrapers).
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
