import { createPool, createPostgresStore } from "../src/db/postgres.js";
import { ingestAdapter } from "../src/ingestion/engine.js";
import { seedAdapter } from "../src/adapters/seed.js";

const pool = createPool();

try {
  const run = await ingestAdapter({ adapter: seedAdapter, store: createPostgresStore(pool) });
  console.log(JSON.stringify({
    runId: run.id,
    status: run.status,
    recordsSeen: run.recordsSeen,
    recordsInserted: run.recordsInserted,
    recordsUpdated: run.recordsUpdated,
    recordsSkipped: run.recordsSkipped
  }, null, 2));
} finally {
  await pool.end();
}
