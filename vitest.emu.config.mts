import { defineConfig } from "vitest/config";
import path from "path";

// Tests that need the Firebase emulators. Run with: npm run test:emu
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: { include: ["src/emu/**/*.emu.test.ts"], testTimeout: 20000, env: { MOCK_OP: "1", APPCHECK_ENFORCE: "0" } },
});
