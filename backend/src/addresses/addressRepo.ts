import { pool } from "../db/pool.js";

export interface AddressRecord {
  id: string;
  user_id: string;
  label: string | null;
  full_name: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  country: string;
  postal_code: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface AddressInput {
  label?: string;
  fullName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state?: string | null;
  country?: string;
  postalCode: string;
  isDefault?: boolean;
}

export async function listAddressesForUser(userId: string): Promise<AddressRecord[]> {
  const result = await pool.query<AddressRecord>(
    `SELECT * FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC`,
    [userId],
  );
  return result.rows;
}

export async function createAddress(userId: string, input: AddressInput): Promise<AddressRecord> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // At most one default address per user — clear any existing default
    // before inserting, in the same transaction, rather than trusting the
    // caller to have unset it first.
    if (input.isDefault) {
      await client.query(`UPDATE addresses SET is_default = FALSE WHERE user_id = $1`, [userId]);
    }

    const result = await client.query<AddressRecord>(
      `INSERT INTO addresses (user_id, label, full_name, phone, line1, line2, city, state, country, postal_code, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, 'NG'), $10, $11)
       RETURNING *`,
      [
        userId,
        input.label ?? null,
        input.fullName,
        input.phone,
        input.line1,
        input.line2 ?? null,
        input.city,
        input.state ?? null,
        input.country ?? null,
        input.postalCode ?? null,
        input.isDefault ?? false,
      ],
    );

    await client.query("COMMIT");
    return result.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function updateAddress(
  userId: string,
  addressId: string,
  input: Partial<AddressInput>,
): Promise<AddressRecord | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Row-locked read-modify-write: the WHERE user_id = $2 below is what
    // actually prevents editing someone else's address by guessing an id,
    // not this lock — this lock just keeps a concurrent update on the same
    // row from being lost.
    const existing = await client.query<AddressRecord>(
      `SELECT * FROM addresses WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [addressId, userId],
    );
    const current = existing.rows[0];
    if (!current) {
      await client.query("ROLLBACK");
      return null;
    }

    if (input.isDefault) {
      await client.query(`UPDATE addresses SET is_default = FALSE WHERE user_id = $1 AND id <> $2`, [
        userId,
        addressId,
      ]);
    }

    const result = await client.query<AddressRecord>(
      `UPDATE addresses SET
         label = $3, full_name = $4, phone = $5, line1 = $6, line2 = $7,
         city = $8, state = $9, country = $10, postal_code = $11, is_default = $12
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [
        addressId,
        userId,
        input.label !== undefined ? input.label : current.label,
        input.fullName ?? current.full_name,
        input.phone ?? current.phone,
        input.line1 ?? current.line1,
        input.line2 !== undefined ? input.line2 : current.line2,
        input.city ?? current.city,
        input.state ?? current.state,
        input.country ?? current.country,
        input.postalCode !== undefined ? input.postalCode : current.postal_code,
        input.isDefault ?? current.is_default,
      ],
    );

    await client.query("COMMIT");
    return result.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteAddress(userId: string, addressId: string): Promise<boolean> {
  const result = await pool.query(`DELETE FROM addresses WHERE id = $1 AND user_id = $2`, [
    addressId,
    userId,
  ]);
  return (result.rowCount ?? 0) > 0;
}
