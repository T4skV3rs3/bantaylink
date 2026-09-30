import { createPool } from "../src/db/postgres.js";

function normalizeLimit(value, fallback = 100) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), 1), 250) : fallback;
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

  const limit = normalizeLimit(req.query?.limit);
  const status = String(req.query?.status ?? "").trim().slice(0, 32);
  const matchMethod = String(req.query?.matchMethod ?? "").trim().slice(0, 64);
  const entityType = String(req.query?.entityType ?? "").trim().slice(0, 64);
  const pool = createPool();

  try {
    const runResult = await pool.query(
      `SELECT id, engine_version AS "engineVersion", status,
              started_at AS "startedAt", completed_at AS "completedAt",
              entity_count AS "entityCount", candidate_count AS "candidateCount",
              auto_confirmed_count AS "autoConfirmedCount",
              review_required_count AS "reviewRequiredCount",
              conflict_count AS "conflictCount",
              cluster_count AS "clusterCount",
              truncated, errors
       FROM entity_resolution_runs
       WHERE status='completed'
       ORDER BY completed_at DESC
       LIMIT 1`
    );

    if (!runResult.rows[0]) {
      return res.status(200).json({
        service: "bantaylink",
        status: "ok",
        run: null,
        candidates: [],
        clusters: []
      });
    }

    const run = runResult.rows[0];

    const [candidateResult, clusterResult] = await Promise.all([
      pool.query(
        `SELECT c.id, c.source_entity_id AS "sourceEntityId",
                c.candidate_entity_id AS "candidateEntityId",
                c.entity_type AS "entityType",
                c.identity_group_key AS "identityGroupKey",
                c.match_method AS "matchMethod",
                c.status, c.fingerprint, c.rationale,
                c.evidence_observation_ids AS "evidenceObservationIds",
                c.evidence_edge_ids AS "evidenceEdgeIds",
                c.payload, c.created_at AS "createdAt",
                se.entity_type AS "sourceEntityType",
                ce.entity_type AS "candidateEntityType",
                se.label AS "sourceLabel", ce.label AS "candidateLabel",
                se.canonical_key AS "sourceCanonicalKey",
                ce.canonical_key AS "candidateCanonicalKey"
         FROM entity_resolution_candidates c
         JOIN entities se ON se.id=c.source_entity_id
         JOIN entities ce ON ce.id=c.candidate_entity_id
         WHERE c.entity_resolution_run_id=$1
           AND ($2::text='' OR c.status=$2)
           AND ($3::text='' OR c.match_method=$3)
           AND ($4::text='' OR c.entity_type=$4)
         ORDER BY c.status, c.entity_type, c.match_method, c.fingerprint
         LIMIT $5`,
        [run.id, status, matchMethod, entityType, limit]
      ),
      pool.query(
        `SELECT c.id, c.entity_type AS "entityType",
                c.cluster_key AS "clusterKey",
                c.representative_entity_id AS "representativeEntityId",
                c.member_entity_ids AS "memberEntityIds",
                c.status, c.basis, c.created_at AS "createdAt",
                e.label AS "representativeLabel",
                e.canonical_key AS "representativeCanonicalKey"
         FROM entity_resolution_clusters c
         JOIN entities e ON e.id=c.representative_entity_id
         WHERE c.entity_resolution_run_id=$1
         ORDER BY c.entity_type, c.cluster_key
         LIMIT $2`,
        [run.id, Math.min(limit, 100)]
      )
    ]);

    return res.status(200).json({
      service: "bantaylink",
      status: "ok",
      run,
      candidates: candidateResult.rows,
      clusters: clusterResult.rows
    });
  } catch {
    return res.status(503).json({
      service: "bantaylink",
      status: "degraded",
      error: "Entity resolution data could not be read."
    });
  } finally {
    await pool.end();
  }
}
