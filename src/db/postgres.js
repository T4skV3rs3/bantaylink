import pg from "pg";

const { Pool } = pg;

export function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for the Postgres store.");
  }

  return new Pool({
    connectionString,
    max: Number(process.env.DB_POOL_MAX || 4),
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false }
  });
}

export async function withTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function initSchema(pool, schemaSql) {
  await pool.query(schemaSql);
}
