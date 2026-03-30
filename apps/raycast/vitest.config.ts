import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@raycast/api": path.resolve(__dirname, "__tests__/__mocks__/raycast-api.ts"),
    },
  },
  test: {
    globals: true,
    environment: "node",
  },
});
