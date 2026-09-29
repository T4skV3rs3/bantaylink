import { readFile } from "node:fs/promises";
import { createPool, initSchema } from "../src/db/postgres.js";

const schema = await readFile(new URL("../db/schema.sql", import.meta.url), "utf8");
const pool = createPool();

try {
  await initSchema(pool, schema);
  console.log("BantayLink provenance schema initialized.");
} finally {
  await pool.end();
}
