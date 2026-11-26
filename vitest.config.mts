import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: { include: ["src/**/*.test.ts"], exclude: ["src/emu/**", "node_modules/**"], env: { MOCK_OP: "1" } },
});
