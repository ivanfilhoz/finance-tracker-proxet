// @vitest-environment node
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertSchemaUpToDate, runMigrations } from "#/db/migrate";

const migrationsFolder = join(process.cwd(), "drizzle");

describe("startup migrations", () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    // Cold WASM startup can exceed five seconds on shared CI runners.
    // Keep it separate from the migration test's default assertion deadline.
    client = new PGlite();
    await client.waitReady;
    db = drizzle(client);
  }, 30_000);

  afterEach(async () => {
    await client?.close();
  });

  it("applies all migrations to an empty database and is idempotent", async () => {
    await runMigrations(db, "pglite", migrationsFolder);

    const result = await db.execute(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const names = new Set((result.rows as Array<{ table_name: string }>).map((t) => t.table_name));
    for (const table of ["users", "accounts", "transactions", "receipts"]) {
      expect(names.has(table), table).toBe(true);
    }

    // Second run applies nothing and does not throw.
    const applied = async () => {
      const res = await db.execute(
        sql`SELECT count(*)::int AS c FROM drizzle.__drizzle_migrations`,
      );
      return (res.rows[0] as { c: number }).c;
    };
    const before = await applied();
    await runMigrations(db, "pglite", migrationsFolder);
    expect(await applied()).toBe(before);
  });

  it("assertSchemaUpToDate throws when migrations are missing", async () => {
    await runMigrations(db, "pglite", migrationsFolder);

    await db.execute(
      sql`DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations)`,
    );

    await expect(assertSchemaUpToDate(db, migrationsFolder)).rejects.toThrow(/Schema out of date/);
  });
});
