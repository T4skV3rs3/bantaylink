import { sha256 } from "../ingestion/hash.js";

export const ENTITY_RESOLUTION_ENGINE_VERSION = "1.0.0";

const WINNER_DATASET = "NLE_Winners_2004-2025";

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeText(value) {
  return clean(value)
    .toUpperCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeName(value) {
  return normalizeText(value)
    .replace(/\b(HON|HONORABLE|ATTY|ATTY\.|DR|MR|MS|MRS|ENGR|ENGR\.)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePlace(value) {
  return normalizeText(value)
    .replace(/\b(PROVINCE|CITY|MUNICIPALITY|MUNICIPAL)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function numeric(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function observationIds(observationIndex, entityId, recordType) {
  return (observationIndex.get(entityId) ?? [])
    .filter(item => !recordType || item.recordType === recordType)
    .map(item => item.id)
    .sort();
}

function candidateFingerprint(method, source, target) {
  return sha256({
    engineVersion: ENTITY_RESOLUTION_ENGINE_VERSION,
    method,
    source: source.canonicalKey,
    target: target.canonicalKey
  });
}

function candidate({
  sourceEntity,
  targetEntity,
  entityType,
  method,
  status,
  rationale,
  evidenceObservationIds,
  payload = {}
}) {
  return {
    id: null,
    fingerprint: candidateFingerprint(method, sourceEntity, targetEntity),
    sourceEntityId: sourceEntity.id,
    candidateEntityId: targetEntity.id,
    entityType,
    matchMethod: method,
    status,
    rationale,
    evidenceObservationIds: [...new Set(evidenceObservationIds)].sort(),
    evidenceEdgeIds: [],
    payload
  };
}

function isWinnerEntity(entity) {
  return entity.entityType === "election_result" &&
    (entity.data?.dataset === WINNER_DATASET || entity.data?.dataset == null);
}

function personDescriptor(entity) {
  const data = entity.data ?? {};
  if (!isWinnerEntity(entity) && entity.entityType !== "person") return null;

  const fullName = normalizeName(data.fullName ?? data.name ?? data.candidateName);
  if (!fullName) return null;

  return {
    name: fullName,
    city: normalizePlace(data.city ?? data.municipality),
    province: normalizePlace(data.province),
    position: normalizeText(data.position),
    sex: normalizeText(data.sex),
    year: numeric(data.year)
  };
}

function stableExternalId(entity) {
  const data = entity.data ?? {};
  const type = entity.entityType;

  if (type === "project") {
    const id = clean(data.contractId ?? data.spId);
    if (id) return { namespace: data.contractId ? "contract_id" : "sp_id", value: id };
  }

  if (type === "procurement_event") {
    const id = clean(data.referenceNumber);
    if (id) {
      const procuringEntity = normalizeText(data.procuringEntity);
      return {
        namespace: "procurement_reference",
        value: procuringEntity ? procuringEntity + "::" + id : id
      };
    }
  }

  if (type === "contractor") {
    const id = clean(data.pcabId ?? data.stableContractorId);
    if (id) return { namespace: data.pcabId ? "pcab_id" : "stable_contractor_id", value: id };
  }

  if (type === "source") {
    const id = clean(data.documentId ?? data.trackingNumber ?? data.url);
    if (id) return { namespace: data.documentId ? "document_id" : "source_reference", value: id };
  }

  if (type === "person") {
    const id = clean(data.stablePersonId ?? data.sourcePersonId);
    if (id) return { namespace: data.stablePersonId ? "stable_person_id" : "source_person_id", value: id };
  }

  if (type === "organization") {
    const id = clean(data.stableOrganizationId ?? data.sourceOrganizationId);
    if (id) return { namespace: data.stableOrganizationId ? "stable_organization_id" : "source_organization_id", value: id };
  }

  return null;
}

function buildStableIndexes(entities) {
  const indexes = new Map();

  for (const entity of entities) {
    const external = stableExternalId(entity);
    if (!external) continue;
    const key = entity.entityType + "::" + external.namespace + "::" + normalizeText(external.value);
    const list = indexes.get(key) ?? [];
    list.push(entity);
    indexes.set(key, list);
  }

  return indexes;
}

function buildPersonIndexes(entities) {
  const byNameLocality = new Map();
  const byName = new Map();

  for (const entity of entities) {
    const descriptor = personDescriptor(entity);
    if (!descriptor) continue;

    const localityKey = [
      descriptor.name,
      descriptor.city,
      descriptor.province
    ].join("::");

    const nameKey = descriptor.name;
    for (const [index, key] of [[byNameLocality, localityKey], [byName, nameKey]]) {
      const list = index.get(key) ?? [];
      list.push({ entity, descriptor });
      index.set(key, list);
    }
  }

  return { byNameLocality, byName };
}

function compatiblePersonContext(a, b) {
  const sexCompatible = !a.sex || !b.sex || a.sex === b.sex;
  const positionCompatible = !a.position || !b.position || a.position === b.position;
  return sexCompatible && positionCompatible;
}

function makeEvidence(observationIndex, sourceEntityId, targetEntityId) {
  return [
    ...observationIds(observationIndex, sourceEntityId),
    ...observationIds(observationIndex, targetEntityId)
  ];
}

export function resolveEntities(snapshot, { maxCandidates = 25000 } = {}) {
  const entities = [...snapshot.entities]
    .filter(entity =>
      entity.entityType !== "election_result" ||
      entity.data?.dataset === WINNER_DATASET ||
      entity.data?.dataset == null
    )
    .sort((a, b) => a.canonicalKey.localeCompare(b.canonicalKey));

  const observationIndex = new Map();
  for (const obs of snapshot.observations) {
    const list = observationIndex.get(obs.entityId) ?? [];
    list.push(obs);
    observationIndex.set(obs.entityId, list);
  }

  const stableIndex = buildStableIndexes(entities);
  const { byNameLocality, byName } = buildPersonIndexes(entities);

  const candidates = [];
  const seenPairs = new Set();
  const push = item => {
    if (candidates.length >= maxCandidates) return;
    if (seenPairs.has(item.fingerprint)) return;
    seenPairs.add(item.fingerprint);
    candidates.push(item);
  };

  for (const sourceEntity of entities) {
    const external = stableExternalId(sourceEntity);
    if (external) {
      const key = sourceEntity.entityType + "::" + external.namespace + "::" + normalizeText(external.value);
      for (const targetEntity of stableIndex.get(key) ?? []) {
        if (targetEntity.id === sourceEntity.id) continue;
        const conflict = sourceEntity.entityType === "contractor" &&
          clean(sourceEntity.data?.pcabId) &&
          clean(targetEntity.data?.pcabId) &&
          clean(sourceEntity.data?.pcabId) !== clean(targetEntity.data?.pcabId);

        push(candidate({
          sourceEntity,
          targetEntity,
          entityType: sourceEntity.entityType,
          method: external.namespace,
          status: conflict ? "CONFLICT" : "AUTO_CONFIRMED",
          rationale: conflict
            ? "Two records expose conflicting stable contractor identifiers and must not be merged."
            : "The source records expose the same typed stable external identifier; this is an identity match at the identifier level.",
          evidenceObservationIds: makeEvidence(observationIndex, sourceEntity.id, targetEntity.id),
          payload: {
            namespace: external.namespace,
            value: external.value
          }
        }));
      }
    }

    const descriptor = personDescriptor(sourceEntity);
    if (!descriptor) continue;

    const localityKey = [
      descriptor.name,
      descriptor.city,
      descriptor.province
    ].join("::");

    const localityCandidates = byNameLocality.get(localityKey) ?? [];
    if (localityCandidates.length > 1) {
      for (const { entity: targetEntity, descriptor: targetDescriptor } of localityCandidates) {
        if (targetEntity.id === sourceEntity.id) continue;
        if (!compatiblePersonContext(descriptor, targetDescriptor)) continue;

        push(candidate({
          sourceEntity,
          targetEntity,
          entityType: "person",
          method: "name_locality_candidate",
          status: "REVIEW_REQUIRED",
          rationale: "The records share normalized full name and the same recorded city/municipality and province. This is a candidate only; it does not establish that they are the same real-world person.",
          evidenceObservationIds: makeEvidence(observationIndex, sourceEntity.id, targetEntity.id),
          payload: {
            normalizedName: descriptor.name,
            city: descriptor.city || null,
            province: descriptor.province || null,
            sourceYear: descriptor.year,
            candidateYear: targetDescriptor.year,
            sourcePosition: descriptor.position || null,
            candidatePosition: targetDescriptor.position || null
          }
        }));
      }
    } else if (localityCandidates.length === 0) {
      const sameNameCandidates = byName.get(descriptor.name) ?? [];
      for (const { entity: targetEntity, descriptor: targetDescriptor } of sameNameCandidates) {
        if (targetEntity.id === sourceEntity.id) continue;
        if (!compatiblePersonContext(descriptor, targetDescriptor)) continue;
        if (!descriptor.city && !descriptor.province && !targetDescriptor.city && !targetDescriptor.province) {
          continue;
        }

        push(candidate({
          sourceEntity,
          targetEntity,
          entityType: "person",
          method: "name_candidate",
          status: "REVIEW_REQUIRED",
          rationale: "The records share a normalized full name but do not share the full recorded locality context. This is a research candidate only and is not identity proof.",
          evidenceObservationIds: makeEvidence(observationIndex, sourceEntity.id, targetEntity.id),
          payload: {
            normalizedName: descriptor.name,
            sourceCity: descriptor.city || null,
            sourceProvince: descriptor.province || null,
            candidateCity: targetDescriptor.city || null,
            candidateProvince: targetDescriptor.province || null
          }
        }));
      }
    }
  }

  candidates.sort(
    (a, b) =>
      a.status.localeCompare(b.status) ||
      a.entityType.localeCompare(b.entityType) ||
      a.fingerprint.localeCompare(b.fingerprint)
  );

  return {
    engineVersion: ENTITY_RESOLUTION_ENGINE_VERSION,
    candidates
  };
}
