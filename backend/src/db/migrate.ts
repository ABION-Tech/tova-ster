import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

// Deliberately not a third-party migration framework: this is ~40 lines on
// top of `pg`, which the app already depends on. That keeps the migration
// path itself portable — moving Postgres hosts never means finding out a
// migration tool doesn't work on the new one.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../migrations");

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const result = await pool.query<{ filename: string }>(
    "SELECT filename FROM schema_migrations",
  );
  return new Set(result.rows.map((row) => row.filename));
}

async function run(): Promise<void> {
  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();

  const allFiles = await readdir(MIGRATIONS_DIR);
  const pending = allFiles
    .filter((f) => f.endsWith(".sql"))
    .sort() // filenames are zero-padded (0001_..., 0002_...), so lexical sort is execution order
    .filter((f) => !applied.has(f));

  if (pending.length === 0) {
    console.log("No pending migrations. Database is up to date.");
    return;
  }

  for (const filename of pending) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, filename), "utf-8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [filename]);
      await client.query("COMMIT");
      console.log(`Applied: ${filename}`);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`Failed applying ${filename}:`);
      throw err;
    } finally {
      client.release();
    }
  }

  console.log(`Applied ${pending.length} migration(s).`);
}

run()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    pool.end().finally(() => process.exit(1));
  });
