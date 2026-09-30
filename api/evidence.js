import { createPool } from "../src/db/postgres.js";

function ids(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 200);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }

  if (!process.env.DATABASE_URL) {
    return res.status(503).json({
      service: "bantaylink",
      status: "unavailable",
      reason: "DATABASE_URL is not configured."
    });
  }

  const observationIds = ids(req.query?.observationIds || req.query?.observations);
  const edgeIds = ids(req.query?.edgeIds || req.query?.edges);

  if (!observationIds.length && !edgeIds.length) {
    return res.status(400).json({ error: "Provide observationIds and/or edgeIds." });
  }

  const pool = createPool();

  try {
    const [observations, edges] = await Promise.all([
      observationIds.length ? pool.query(
        `SELECT o.id, o.entity_id AS "entityId", o.source_id AS "sourceId",
                o.ingestion_run_id AS "ingestionRunId", o.raw_document_id AS "rawDocumentId",
                o.record_type AS "recordType", o.source_record_id AS "sourceRecordId",
                o.observed_at AS "observedAt", o.content_hash AS "contentHash", o.data,
                s.name AS "sourceName", s.source_class AS "sourceClass",
                s.publisher, s.canonical_url AS "canonicalUrl",
                r.retrieval_url AS "retrievalUrl", r.retrieved_at AS "retrievedAt",
                r.http_status AS "httpStatus", r.mime_type AS "mimeType",
                r.payload_encoding AS "payloadEncoding", r.hash_algorithm AS "hashAlgorithm",
                r.hash_scope AS "hashScope", r.content_hash AS "rawContentHash"
         FROM observations o
         JOIN sources s ON s.id=o.source_id
         LEFT JOIN raw_documents r ON r.id=o.raw_document_id
         WHERE o.id = ANY($1::text[])
         ORDER BY o.observed_at DESC`,
        [observationIds]
      ) : { rows: [] },
      edgeIds.length ? pool.query(
        `SELECT e.id, e.from_entity_id AS "fromEntityId", e.to_entity_id AS "toEntityId",
                e.edge_type AS "edgeType", e.source_id AS "sourceId",
                e.ingestion_run_id AS "ingestionRunId", e.raw_document_id AS "rawDocumentId",
                e.source_record_id AS "sourceRecordId", e.observed_at AS "observedAt",
                e.content_hash AS "contentHash", e.data,
                s.name AS "sourceName", s.source_class AS "sourceClass",
                s.publisher, s.canonical_url AS "canonicalUrl",
                r.retrieval_url AS "retrievalUrl", r.retrieved_at AS "retrievedAt",
                r.http_status AS "httpStatus", r.mime_type AS "mimeType",
                r.payload_encoding AS "payloadEncoding", r.hash_algorithm AS "hashAlgorithm",
                r.hash_scope AS "hashScope", r.content_hash AS "rawContentHash"
         FROM edges e
         JOIN sources s ON s.id=e.source_id
         LEFT JOIN raw_documents r ON r.id=e.raw_document_id
         WHERE e.id = ANY($1::text[])
         ORDER BY e.observed_at DESC`,
        [edgeIds]
      ) : { rows: [] }
    ]);

    return res.status(200).json({
      service: "bantaylink",
      status: "ok",
      observations: observations.rows.map(row => ({
        ...row,
        evidenceUrl: row.canonicalUrl,
        hashTrace: {
          algorithm: row.hashAlgorithm,
          scope: row.hashScope,
          normalizedContentHash: row.contentHash,
          rawDocumentHash: row.rawContentHash || null
        }
      })),
      edges: edges.rows
    });
  } catch {
    return res.status(503).json({
      service: "bantaylink",
      status: "degraded",
      error: "Evidence bundle could not be read."
    });
  } finally {
    await pool.end();
  }
}
