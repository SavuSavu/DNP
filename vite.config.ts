import { defineConfig } from "vitest/config";
export default defineConfig({
  base: "/DNP/",
  test: { include: ["tests/**/*.test.ts"] },
});
