import { readFile } from "node:fs/promises";
import { MemoryStore } from "../src/db/memory.js";
import { ingestAdapter } from "../src/ingestion/engine.js";

const seed = JSON.parse(await readFile(new URL("../data/seed.json", import.meta.url), "utf8"));

const adapter = {
  id: "test-seed",
  name: "Test Seed",
  source: {
    sourceKey: "test-seed",
    name: "Test Seed",
    sourceClass: "independent_dataset",
    canonicalUrl: "https://example.invalid/test-seed"
  },
  async *fetch() {
    for (const record of seed.records) {
      yield record;
    }
  },
  normalize(record) {
    return {
      entities: [{
        entityType: record.type,
        canonicalKey: record.id,
        label: record.name ?? record.id,
        data: record,
        observations: [{
          recordType: record.type,
          sourceRecordId: record.id,
          data: record
        }]
      }]
    };
  }
};

const store = new MemoryStore();
const first = await ingestAdapter({adapter,store});
const second = await ingestAdapter({adapter,store});

if (first.recordsSeen !== seed.records.length) throw new Error("First ingestion count mismatch.");
if (store.entities.size !== seed.records.length) throw new Error("Entity deduplication failed.");
if (store.observations.size !== seed.records.length) throw new Error("Observation count mismatch.");
if (second.recordsSkipped !== seed.records.length) throw new Error("Repeat ingestion should be fully deduplicated.");

console.log("BantayLink ingestion tests passed.");
