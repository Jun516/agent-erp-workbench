import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/** Same real-business regression locally and in the canonical isolated DB harness. */
describe("ERP business ledger", () => {
  it("preserves stock, approval, tenant, idempotency and concurrency invariants", () => {
    const port = process.env.TEST_DB_PORT;
    if (!process.env.TEST_DB_CONTAINER || !port) {
      throw new Error("Run via pnpm test:db: isolated TEST_DB_CONTAINER and TEST_DB_PORT required");
    }
    const output = execFileSync(process.execPath, ["scripts/erp-db-regression.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, ERP_TEST_DB_URL: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres` },
      encoding: "utf8",
      timeout: 90_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    expect(output).toContain("ERP DB: 56 passed");
    expect(output).toContain("negative control: disabling replenishment rule");
  }, 100_000);
});
