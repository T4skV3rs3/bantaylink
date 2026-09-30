import assert from "node:assert/strict";
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
    canonicalUrl: "https://example.invalid/test-seed",
    api_key: "should-not-be-stored"
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
const first = await ingestAdapter({ adapter, store });
const second = await ingestAdapter({ adapter, store });

if (first.recordsSeen !== seed.records.length) throw new Error("First ingestion count mismatch.");
if (store.entities.size !== seed.records.length) throw new Error("Entity deduplication failed.");
if (store.observations.size !== seed.records.length) throw new Error("Observation count mismatch.");
if (store.rawDocuments.size !== seed.records.length * 2) throw new Error("Raw retrieval history was not retained.");
if (store.observationOccurrences.size !== seed.records.length * 2) throw new Error("Repeat-run occurrence links were not retained.");
if (second.recordsSkipped !== seed.records.length) throw new Error("Repeat ingestion should be fully deduplicated.");

const sourceSnapshot = first.sourceSnapshot;
if (sourceSnapshot.api_key !== "[REDACTED]") throw new Error("Source snapshot secret redaction failed.");

const partialStore = new MemoryStore();
const partialAdapter = {
  id: "test-partial",
  name: "Test Partial",
  source: {
    sourceKey: "test-partial",
    name: "Test Partial",
    sourceClass: "independent_dataset",
    canonicalUrl: "https://example.invalid/test-partial"
  },
  async *fetch() {
    yield { payload: { id: "ok" }, url: "https://example.invalid/ok" };
    yield { payload: { id: "bad" }, url: "https://example.invalid/bad", sourceRecordId: "bad" };
  },
  normalize(record) {
    if (record.id === "bad") throw new Error("deliberate normalization failure");
    return {
      entities: [{
        entityType: "project",
        canonicalKey: record.id,
        label: record.id,
        data: record,
        observations: [{
          recordType: "project",
          sourceRecordId: record.id,
          data: record
        }]
      }]
    };
  }
};

const partial = await ingestAdapter({ adapter: partialAdapter, store: partialStore });
if (partial.status !== "completed") throw new Error("Tolerant ingestion should complete with record errors.");
if (partial.errors.length !== 1) throw new Error("Record-level error was not recorded.");
if (partialStore.rawDocuments.size !== 2) throw new Error("Raw evidence for failed normalization was not retained.");
if (partialStore.observations.size !== 1) throw new Error("Valid records from partial ingestion were not preserved.");

const strictStore = new MemoryStore();
let strictFailed = false;
try {
  await ingestAdapter({
    adapter: partialAdapter,
    store: strictStore,
    options: { strict: true }
  });
} catch {
  strictFailed = true;
}
if (!strictFailed) throw new Error("Strict ingestion should fail on record normalization errors.");
if (strictStore.rawDocuments.size !== 2) throw new Error("Strict mode should retain the failing raw record before aborting.");
if (strictStore.runs.size !== 1 || [...strictStore.runs.values()][0].status !== "failed") {
  throw new Error("Strict ingestion did not mark the run failed.");
}

console.log("BantayLink ingestion tests passed.");
