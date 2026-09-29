import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sha256 } from "../ingestion/hash.js";

const here = dirname(fileURLToPath(import.meta.url));

export const seedAdapter = {
  id: "bantaylink-seed",
  name: "BantayLink Alpha Seed",
  source: {
    id: "seed-source",
    sourceKey: "bantaylink-alpha-seed",
    name: "BantayLink Alpha Seed",
    sourceClass: "independent_dataset",
    publisher: "BantayLink",
    canonicalUrl: "https://github.com/T4skV3rs3/bantaylink/blob/main/data/seed.json",
    version: "0.1.0"
  },

  async *fetch() {
    const path = join(here, "../../data/seed.json");
    const parsed = JSON.parse(await readFile(path, "utf8"));
    for (const record of parsed.records ?? []) {
      yield {
        payload: record,
        url: "https://github.com/T4skV3rs3/bantaylink/blob/main/data/seed.json",
        mimeType: "application/json"
      };
    }
  },

  normalize(record) {
    const canonicalKey = record.id;
    if (!canonicalKey) throw new Error("Seed record is missing id.");

    return {
      entities: [
        {
          entityType: record.type,
          canonicalKey,
          label: record.name ?? record.id,
          data: record,
          observations: [
            {
              recordType: record.type,
              sourceRecordId: record.id,
              observedAt: new Date().toISOString(),
              contentHash: sha256(record),
              data: record
            }
          ]
        }
      ]
    };
  }
};
