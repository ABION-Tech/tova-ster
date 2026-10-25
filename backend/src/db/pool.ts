import { Pool } from "pg";

// Single shared pool. Every later stage's data access goes through this —
// no ad-hoc `new Pool()` calls scattered around the codebase.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

// An idle connection can drop when the database restarts or fails over
// (e.g. Railway maintenance). Without this handler pg re-throws the error and
// the whole server exits; with it, the broken client is discarded and the
// next query simply opens a fresh connection.
pool.on("error", (err) => {
  console.error("Database connection dropped; it will reconnect on the next query.", err.message);
});

export async function pingDb(): Promise<boolean> {
  const result = await pool.query("SELECT 1 as ok");
  return result.rows[0]?.ok === 1;
}
