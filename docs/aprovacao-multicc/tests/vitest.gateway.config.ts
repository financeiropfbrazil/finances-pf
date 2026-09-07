import { defineConfig } from "vitest/config";
export default defineConfig({ test: {
  environment: "node",
  include: ["docs/aprovacao-multicc/tests/produto-leitura-gateway.test.ts"],
} });
