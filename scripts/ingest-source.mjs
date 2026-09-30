import { ingestAdapter } from "../src/ingestion/engine.js";
import { createPool, createPostgresStore } from "../src/db/postgres.js";
import { openHalalanVotesAdapter, openHalalanWinnersAdapter } from "../src/adapters/openhalalan.js";
import { dpwhProjectDetailAdapter, dpwhTransparencyAdapter } from "../src/adapters/dpwh.js";
import { dpwhEfoiAdapter } from "../src/adapters/dpwh-efoi.js";
import { daSidlanAdapter } from "../src/adapters/da-sidlan.js";
import { coaElibraryAdapter } from "../src/adapters/coa-elibrary.js";
import { philgepsAdapter } from "../src/adapters/philgeps.js";

const adapters = new Map([
  [openHalalanWinnersAdapter.id, openHalalanWinnersAdapter],
  [openHalalanVotesAdapter.id, openHalalanVotesAdapter],
  [dpwhTransparencyAdapter.id, dpwhTransparencyAdapter],
  [dpwhProjectDetailAdapter.id, dpwhProjectDetailAdapter],
  [dpwhEfoiAdapter.id, dpwhEfoiAdapter],
  [daSidlanAdapter.id, daSidlanAdapter],
  [coaElibraryAdapter.id, coaElibraryAdapter],
  [philgepsAdapter.id, philgepsAdapter]
]);

const adapterId = process.argv[2] || process.env.BANTAYLINK_ADAPTER;
if (!adapterId || !adapters.has(adapterId)) {
  throw new Error(
    `Choose an adapter: ${[...adapters.keys()].join(", ")}. Example: node scripts/ingest-source.mjs openhalalan-winners`
  );
}

const pool = createPool();
try {
  const maxRecords = process.env.BANTAYLINK_MAX_RECORDS
    ? Number(process.env.BANTAYLINK_MAX_RECORDS)
    : undefined;

  const run = await ingestAdapter({
    adapter: adapters.get(adapterId),
    store: createPostgresStore(pool),
    options: { maxRecords }
  });

  console.log(JSON.stringify(run, null, 2));
} finally {
  await pool.end();
}
