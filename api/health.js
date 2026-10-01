import pg from "pg";

const { Pool } = pg;

const EXPECTED_TABLES = [
  "sources",
  "ingestion_runs",
  "raw_documents",
  "entities",
  "observations",
  "observation_occurrences",
  "edges",
  "edge_occurrences",
  "correlation_runs",
  "correlation_findings",
  "entity_resolution_runs",
  "entity_resolution_candidates",
  "entity_resolution_assertions",
  "entity_resolution_clusters"
];

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
    connectionTimeoutMillis: 5000,
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false }
  });

  try {
    await pool.query("SELECT 1");

    const schemaResult = await pool.query(
      "SELECT table_name FROM information_schema.tables " +
      "WHERE table_schema='public' AND table_name = ANY($1::text[])",
      [EXPECTED_TABLES]
    );

    const found = new Set(schemaResult.rows.map(row => row.table_name));
    const missingTables = EXPECTED_TABLES.filter(table => !found.has(table));

    if (missingTables.length) {
      console.error("[health] database schema incomplete", {
        missingTables,
        expectedTableCount: EXPECTED_TABLES.length,
        foundTableCount: found.size
      });
      return res.status(503).json({
        ...response,
        status: "degraded",
        database: "reachable",
        schema: "incomplete"
      });
    }

    return res.status(200).json({
      ...response,
      database: "reachable",
      schema: "ready",
      tablesChecked: EXPECTED_TABLES.length
    });
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
