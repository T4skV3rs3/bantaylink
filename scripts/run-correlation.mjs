import { createPool, createPostgresStore } from "../src/db/postgres.js";
import { executeCorrelationRun } from "../src/correlation/engine.js";

const pool = createPool();
try {
  const maxFindings = process.env.BANTAYLINK_MAX_FINDINGS
    ? Number(process.env.BANTAYLINK_MAX_FINDINGS)
    : undefined;

  const run = await executeCorrelationRun({
    store: createPostgresStore(pool),
    maxFindings
  });

  console.log(JSON.stringify(run, null, 2));
} finally {
  await pool.end();
}
