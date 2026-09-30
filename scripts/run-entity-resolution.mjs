import { createPool, createPostgresStore } from "../src/db/postgres.js";
import { executeEntityResolutionRun } from "../src/entity-resolution/engine.js";

const pool = createPool();

try {
  const maxCandidates = process.env.BANTAYLINK_MAX_RESOLUTION_CANDIDATES
    ? Number(process.env.BANTAYLINK_MAX_RESOLUTION_CANDIDATES)
    : undefined;

  const run = await executeEntityResolutionRun({
    store: createPostgresStore(pool),
    maxCandidates
  });

  console.log(JSON.stringify(run, null, 2));
} finally {
  await pool.end();
}
