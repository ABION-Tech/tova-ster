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

async function inviteMode(): Promise<boolean> {
  // npm run create-admin -- --invite --email=... --name="..." [--role=Owner]
  // Creates (or re-enables) the account without a password and prints a
  // one-time link (48 h) to choose one. Used for the first Owner on a server.
  if (!process.argv.includes("--invite")) return false;
  const get = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=");
  const email = get("email")?.trim().toLowerCase();
  const name = get("name")?.trim();
  const role = get("role") ?? "Owner";
  if (!email || !name || !["Owner", "Manager", "Support", "Packer"].includes(role)) {
    console.error('Usage: npm run create-admin -- --invite --email=you@example.com --name="Your Name" [--role=Owner]');
    process.exit(1);
  }
  const r = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, name, role, active) VALUES ($1, $2, $3, true)
     ON CONFLICT (lower(email)) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, active = true
     RETURNING id`,
    [email, name, role],
  );
  const { createInvite } = await import("../auth/team.js");
  // Also the way back in for a locked-out Owner: two-step sign-in is reset and set up again after the link.
  const { turnOff } = await import("../auth/totp.js");
  await turnOff(r.rows[0].id);
  const inv = await createInvite(r.rows[0].id, null, process.env.APP_URL ?? "http://localhost:3000");
  console.log(`Invite for ${email} (${role}), valid until ${inv.expiresAt.toISOString()}:\n${inv.link}`);
  return true;
}

async function run(): Promise<void> {
  if (await inviteMode()) return;
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
