import pg from "pg";

const { Pool } = pg;

export default async function handler(req, res) {
  const response = {
    service: "bantaylink",
    status: "ok",
    databaseConfigured: Boolean(process.env.DATABASE_URL)
  };

  if (!process.env.DATABASE_URL) {
    return res.status(200).json(response);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false }
  });

  try {
    await pool.query("SELECT 1");
    return res.status(200).json({ ...response, database: "reachable" });
  } catch (error) {
    console.error("[health] database connection failed", {
      name: error?.name,
      code: error?.code,
      constructor: error?.constructor?.name
    });
    return res.status(503).json({
      ...response,
      status: "degraded",
      database: "unreachable"
    });
  } finally {
    await pool.end();
  }
}
