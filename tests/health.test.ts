// @vitest-environment node
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "#/db/migrate";
import { checkReadiness } from "#/server/health.server";

const migrationsFolder = join(process.cwd(), "drizzle");

describe("readiness check", () => {
  describe("with an isolated database", () => {
    let client: PGlite;
    let db: ReturnType<typeof drizzle>;

    beforeEach(async () => {
      // Database provisioning is setup, not part of the readiness deadline.
      client = new PGlite();
      await client.waitReady;
      db = drizzle(client);
      await runMigrations(db, "pglite", migrationsFolder);
    }, 30_000);

    afterEach(async () => {
      await client?.close();
    });

    it("reports ready against a reachable, migrated database", async () => {
      const result = await checkReadiness(db, migrationsFolder);
      expect(result).toEqual({
        ready: true,
        checks: { database: "ok", migrations: "ok" },
      });
    });

    it("reports not ready when the schema is behind the journal", async () => {
      await db.execute(
        sql`DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations)`,
      );
      const result = await checkReadiness(db, migrationsFolder);
      expect(result.ready).toBe(false);
      expect(result.checks).toEqual({ database: "ok", migrations: "error" });
    });
  });

  it("reports not ready when the database query fails", async () => {
    const broken = {
      execute: () => Promise.reject(new Error("connection refused")),
    } as unknown as Parameters<typeof checkReadiness>[0];
    const result = await checkReadiness(broken, migrationsFolder);
    expect(result.ready).toBe(false);
    expect(result.checks.database).toBe("error");
  });
});
