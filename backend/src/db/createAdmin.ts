import { pool } from "./pool.js";
import { hashPassword } from "../auth/passwords.js";

/**
 * Admin accounts are never created through a public endpoint — the PRD's
 * "no super-admin layer" still means admin access is provisioned
 * out-of-band, not self-served. Run this once per environment to create
 * the first (or an additional) admin:
 *
 *   npm run create-admin -- --email=owner@client.com --password=... --name="Jane Doe"
 *
 * Safe to re-run: an existing email just gets its name/password updated
 * rather than erroring, since re-running with a corrected password is the
 * common case (typo on first run).
 */

function parseArgs(): { email: string; password: string; name: string } {
  const args = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) args.set(match[1], match[2]);
  }

  const email = args.get("email");
  const password = args.get("password");
  const name = args.get("name");

  if (!email || !password || !name) {
    console.error(
      'Usage: npm run create-admin -- --email=you@example.com --password=... --name="Your Name"',
    );
    process.exit(1);
  }
  if (password.length < 12) {
    console.error("Admin passwords must be at least 12 characters — this account can touch every order.");
    process.exit(1);
  }

  return { email, password, name };
}

async function run(): Promise<void> {
  const { email, password, name } = parseArgs();
  const passwordHash = await hashPassword(password);

  await pool.query(
    `INSERT INTO admin_users (email, password_hash, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (lower(email)) DO UPDATE SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name`,
    [email, passwordHash, name],
  );

  console.log(`Admin account ready: ${email}`);
}

run()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    pool.end().finally(() => process.exit(1));
  });
