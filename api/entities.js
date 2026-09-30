import { createPool } from "../src/db/postgres.js";

function cleanQuery(value, max = 120) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeLimit(value, fallback = 50) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), 1), 200) : fallback;
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

  const q = cleanQuery(req.query?.q);
  const type = cleanQuery(req.query?.type, 40);
  const limit = normalizeLimit(req.query?.limit);
  const pool = createPool();

  try {
    const result = await pool.query(
      `SELECT
         e.id, e.entity_type AS "entityType", e.canonical_key AS "canonicalKey",
         e.label, e.data, e.first_seen_at AS "firstSeenAt", e.last_seen_at AS "lastSeenAt",
         COALESCE(obs.observation_count, 0)::int AS "observationCount",
         COALESCE(ed.edge_count, 0)::int AS "edgeCount",
         COALESCE(rc.review_count, 0)::int AS "reviewCandidateCount"
       FROM entities e
       LEFT JOIN (
         SELECT entity_id, COUNT(*) AS observation_count
         FROM observations GROUP BY entity_id
       ) obs ON obs.entity_id=e.id
       LEFT JOIN (
         SELECT entity_id, COUNT(*) AS edge_count
         FROM (
           SELECT from_entity_id AS entity_id FROM edges
           UNION ALL
           SELECT to_entity_id AS entity_id FROM edges
         ) edge_entities
         GROUP BY entity_id
       ) ed ON ed.entity_id=e.id
       LEFT JOIN (
         SELECT entity_id, COUNT(*) AS review_count
         FROM (
           SELECT source_entity_id AS entity_id
           FROM entity_resolution_candidates
           WHERE status='REVIEW_REQUIRED'
           UNION ALL
           SELECT candidate_entity_id AS entity_id
           FROM entity_resolution_candidates
           WHERE status='REVIEW_REQUIRED'
         ) review_entities
         GROUP BY entity_id
       ) rc ON rc.entity_id=e.id
       WHERE ($1::text = '' OR e.entity_type=$1)
         AND (
           $2::text = ''
           OR e.label ILIKE '%' || $2 || '%'
           OR e.canonical_key ILIKE '%' || $2 || '%'
         )
       ORDER BY e.entity_type, COALESCE(e.label, e.canonical_key), e.canonical_key
       LIMIT $3`,
      [type, q, limit]
    );

    return res.status(200).json({
      service: "bantaylink",
      status: "ok",
      query: { q, type: type || null, limit },
      entities: result.rows
    });
  } catch {
    return res.status(503).json({
      service: "bantaylink",
      status: "degraded",
      error: "Entity index could not be read."
    });
  } finally {
    await pool.end();
  }
}
