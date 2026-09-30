import { sha256 } from "../ingestion/hash.js";

export const ENTITY_RESOLUTION_ENGINE_VERSION = "1.2.0";

const WINNER_DATASET = "NLE_Winners_2004-2025";
const MAX_EVIDENCE_IDS_PER_ENTITY = 100;
const MAX_NAME_VARIANTS = 4;

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeText(value) {
  return clean(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeName(value) {
  return normalizeText(value)
    .replace(/\b(HON|HONORABLE|ATTY|ATTORNEY|DR|MR|MS|MRS|ENGR|ENGINEER|GOV|GOVERNOR|MAYOR|VICE MAYOR|CONG|CONGRESSMAN|CONGRESSWOMAN|REP)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizePlace(value) {
  return normalizeText(value)
    .replace(/\b(PROVINCE|CITY|MUNICIPALITY|MUNICIPAL)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizePosition(value) {
  return normalizeText(value);
}

export function normalizeOrganizationName(value) {
  return normalizeText(value)
    .replace(/\b(INCORPORATED|CORPORATION|COMPANY|LIMITED)\b/g, " ")
    .replace(/\b(INC|CORP|CO|LTD|LLC)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function numeric(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function winnerEntity(entity) {
  return entity.entityType === "election_result" &&
    (entity.data?.dataset === WINNER_DATASET || entity.data?.dataset == null);
}

function nameVariants(data) {
  const values = new Set();
  const full = normalizeName(data.fullName ?? data.name ?? data.candidateName);
  if (full) values.add(full);

  const first = normalizeName(data.firstName);
  const middle = normalizeName(data.middleName);
  const last = normalizeName(data.lastName);

  if (first && last) {
    values.add([first, middle, last].filter(Boolean).join(" "));
    values.add([last, first, middle].filter(Boolean).join(" "));
  }

  if (full && full.includes(",")) {
    const parts = full.split(",").map(clean).filter(Boolean);
    if (parts.length === 2) {
      values.add(parts[1] + " " + parts[0]);
      values.add(parts[0] + " " + parts[1]);
    }
  }

  return [...values].filter(Boolean).slice(0, MAX_NAME_VARIANTS);
}

function structuredNameKey(data) {
  const first = normalizeName(data.firstName);
  const middle = normalizeName(data.middleName);
  const last = normalizeName(data.lastName);
  if (!first || !last) return null;
  return [last, first, middle].filter(Boolean).join("::");
}

function personDescriptor(entity) {
  if (!winnerEntity(entity) && entity.entityType !== "person") return null;
  const data = entity.data ?? {};
  const variants = nameVariants(data);
  if (!variants.length) return null;

  const city = normalizePlace(data.city ?? data.municipality);
  const province = normalizePlace(data.province);

  return {
    names: variants,
    primaryName: variants[0],
    structuredNameKey: structuredNameKey(data),
    city,
    province,
    localityKey: [city, province].filter(Boolean).join("::"),
    position: normalizePosition(data.position),
    sex: normalizeText(data.sex),
    year: numeric(data.year),
    sourcePersonId: clean(data.stablePersonId ?? data.sourcePersonId)
  };
}

function stableExternalId(entity) {
  const data = entity.data ?? {};

  if (entity.entityType === "project") {
    const id = clean(data.contractId ?? data.spId);
    if (id) {
      const namespace = data.contractId ? "contract_id" : "sp_id";
      return {
        namespace,
        value: id,
        identifierScope: "source_scoped",
        scopeKey: clean(entity.canonicalKey).split(":")[0] || entity.entityType,
        identityScope: "entity_identity"
      };
    }
  }

  if (entity.entityType === "procurement_event") {
    const id = clean(data.referenceNumber);
    if (id) {
      const procuring = normalizeText(data.procuringEntity);
      return {
        namespace: "procurement_reference",
        value: procuring ? procuring + "::" + id : id,
        identifierScope: "source_scoped",
        scopeKey: "philgeps",
        identityScope: "entity_identity"
      };
    }
  }

  if (entity.entityType === "contractor") {
    const id = clean(data.pcabId ?? data.stableContractorId);
    if (id) {
      return {
        namespace: data.pcabId ? "pcab_id" : "stable_contractor_id",
        value: id,
        identifierScope: data.pcabId ? "global" : "source_scoped",
        scopeKey: data.pcabId ? "global" : (clean(entity.canonicalKey).split(":")[0] || entity.entityType),
        identityScope: "entity_identity"
      };
    }
  }

  if (entity.entityType === "source") {
    const id = clean(data.documentId ?? data.trackingNumber ?? data.url);
    if (id) {
      const namespace = data.documentId
        ? "document_id"
        : data.trackingNumber
          ? "tracking_number"
          : "source_reference";
      return {
        namespace,
        value: id,
        identifierScope: "source_scoped",
        scopeKey: clean(entity.canonicalKey).split(":")[0] || entity.entityType,
        identityScope: "entity_identity"
      };
    }
  }

  if (entity.entityType === "person") {
    const id = clean(data.stablePersonId ?? data.sourcePersonId);
    if (id) {
      return {
        namespace: data.stablePersonId ? "stable_person_id" : "source_person_id",
        value: id,
        identifierScope: "source_scoped",
        scopeKey: clean(entity.canonicalKey).split(":")[0] || entity.entityType,
        identityScope: "entity_identity"
      };
    }
  }

  if (entity.entityType === "organization") {
    const id = clean(data.stableOrganizationId ?? data.sourceOrganizationId);
    if (id) {
      return {
        namespace: data.stableOrganizationId ? "stable_organization_id" : "source_organization_id",
        value: id,
        identifierScope: "source_scoped",
        scopeKey: clean(entity.canonicalKey).split(":")[0] || entity.entityType,
        identityScope: "entity_identity"
      };
    }
  }

  return null;
}

function observationIndex(snapshot) {
  const index = new Map();
  for (const row of snapshot.observations) {
    const list = index.get(row.entityId) ?? [];
    list.push(row);
    index.set(row.entityId, list);
  }
  return index;
}

function edgeIndex(snapshot) {
  const index = new Map();
  for (const row of snapshot.edges) {
    for (const entityId of [row.fromEntityId, row.toEntityId]) {
      if (!entityId) continue;
      const list = index.get(entityId) ?? [];
      list.push(row);
      index.set(entityId, list);
    }
  }
  return index;
}

function evidenceIds(index, entityId) {
  return (index.get(entityId) ?? [])
    .map(item => item.id)
    .sort()
    .slice(0, MAX_EVIDENCE_IDS_PER_ENTITY);
}

function pairEvidence(index, entityId, otherId) {
  return [...new Set([...evidenceIds(index, entityId), ...evidenceIds(index, otherId)])].sort();
}

function candidateFingerprint(method, a, b) {
  const keys = [a.canonicalKey, b.canonicalKey].sort();
  return sha256({
    engineVersion: ENTITY_RESOLUTION_ENGINE_VERSION,
    method,
    source: keys[0],
    target: keys[1]
  });
}

function makeCandidate({
  a,
  b,
  entityType,
  matchMethod,
  status,
  rationale,
  evidenceObservationIds,
  evidenceEdgeIds = [],
  payload = {}
}) {
  const ordered = a.canonicalKey.localeCompare(b.canonicalKey) <= 0 ? [a, b] : [b, a];

  return {
    id: null,
    fingerprint: candidateFingerprint(matchMethod, ordered[0], ordered[1]),
    sourceEntityId: ordered[0].id,
    candidateEntityId: ordered[1].id,
    entityType,
    matchMethod,
    status,
    rationale,
    evidenceObservationIds: [...new Set(evidenceObservationIds)].sort(),
    evidenceEdgeIds: [...new Set(evidenceEdgeIds)].sort(),
    payload
  };
}

function addCandidateFactory(candidates, seen, maxCandidates) {
  return item => {
    if (candidates.length >= maxCandidates || seen.has(item.fingerprint)) return;
    seen.add(item.fingerprint);
    candidates.push(item);
  };
}

function buildStableIndex(entities) {
  const index = new Map();
  for (const entity of entities) {
    const external = stableExternalId(entity);
    if (!external) continue;

    const key = entity.entityType + "::" + external.identifierScope + "::" + external.scopeKey + "::" +
      external.namespace + "::" + normalizeText(external.value);
    const list = index.get(key) ?? [];
    list.push(entity);
    index.set(key, list);
  }
  return index;
}

function buildPersonNameIndex(entities) {
  const index = new Map();

  for (const entity of entities) {
    const descriptor = personDescriptor(entity);
    if (!descriptor) continue;

    for (const name of descriptor.names) {
      const list = index.get(name) ?? [];
      list.push({ entity, descriptor });
      index.set(name, list);
    }
  }

  return index;
}

function buildOrganizationNameIndex(entities) {
  const index = new Map();
  for (const entity of entities) {
    if (entity.entityType !== "organization") continue;
    const name = normalizeOrganizationName(
      entity.data?.legalName ?? entity.data?.name ?? entity.data?.organizationName
    );
    if (!name) continue;
    const list = index.get(name) ?? [];
    list.push({ entity, stableId: stableExternalId(entity) });
    index.set(name, list);
  }
  return index;
}

function buildContractorNameIndex(entities) {
  const index = new Map();

  for (const entity of entities) {
    if (entity.entityType !== "contractor") continue;
    const name = normalizeOrganizationName(
      entity.data?.legalName ?? entity.data?.name ?? entity.data?.contractor
    );
    if (!name) continue;

    const list = index.get(name) ?? [];
    list.push({
      entity,
      pcabId: clean(entity.data?.pcabId)
    });
    index.set(name, list);
  }

  return index;
}

function personContext(a, b) {
  const sameCity = Boolean(a.city && b.city && a.city === b.city);
  const sameProvince = Boolean(a.province && b.province && a.province === b.province);
  const samePosition = Boolean(a.position && b.position && a.position === b.position);
  const sameSex = Boolean(a.sex && b.sex && a.sex === b.sex);
  const sexConflict = Boolean(a.sex && b.sex && a.sex !== b.sex);
  const yearGap = a.year != null && b.year != null ? Math.abs(a.year - b.year) : null;

  return { sameCity, sameProvince, samePosition, sameSex, sexConflict, yearGap };
}

function personMatch(a, b) {
  const leftNames = new Set(a.names);
  const sharedName = b.names.find(value => leftNames.has(value));
  if (!sharedName) return null;

  const context = personContext(a, b);
  if (context.sameCity && context.sameProvince) {
    return {
      matchMethod: "name_locality_candidate",
      rationale: "The records share a normalized name variant and the same recorded city/municipality and province. This is a review candidate only; it does not establish that they are the same real-world person.",
      context
    };
  }

  if (context.sameProvince) {
    return {
      matchMethod: "name_province_candidate",
      rationale: "The records share a normalized name variant and the same recorded province, but not the same complete locality context. This is a research candidate only and is not identity proof.",
      context
    };
  }

  if (context.samePosition && context.yearGap != null && context.yearGap <= 6 &&
      (a.city || a.province || b.city || b.province)) {
    return {
      matchMethod: "name_office_time_candidate",
      rationale: "The records share a normalized name variant and compatible office/time context. This is a research candidate only and is not identity proof.",
      context
    };
  }

  return null;
}

export function resolveEntities(snapshot, { maxCandidates = 25000 } = {}) {
  if (!snapshot || !Array.isArray(snapshot.entities) ||
      !Array.isArray(snapshot.observations) || !Array.isArray(snapshot.edges)) {
    throw new Error("Entity resolution requires entities, observations, and edges arrays.");
  }

  const entities = snapshot.entities
    .filter(entity =>
      entity.entityType !== "election_result" ||
      entity.data?.dataset === WINNER_DATASET ||
      entity.data?.dataset == null
    )
    .slice()
    .sort((a, b) => a.canonicalKey.localeCompare(b.canonicalKey));

  const obsIndex = observationIndex(snapshot);
  const edgeIdx = edgeIndex(snapshot);
  const stable = buildStableIndex(entities);
  const personNames = buildPersonNameIndex(entities);
  const contractorNames = buildContractorNameIndex(entities);
  const organizationNames = buildOrganizationNameIndex(entities);
  const candidates = [];
  const seen = new Set();
  let truncated = false;
  const push = item => {
    if (seen.has(item.fingerprint)) return;
    if (candidates.length >= maxCandidates) {
      truncated = true;
      return;
    }
    seen.add(item.fingerprint);
    candidates.push(item);
  };

  for (const sourceEntity of entities) {
    const external = stableExternalId(sourceEntity);

    if (external) {
      const key = sourceEntity.entityType + "::" + external.identifierScope + "::" + external.scopeKey + "::" +
        external.namespace + "::" + normalizeText(external.value);
      for (const targetEntity of stable.get(key) ?? []) {
        if (targetEntity.id === sourceEntity.id) continue;
        push(makeCandidate({
          a: sourceEntity,
          b: targetEntity,
          entityType: sourceEntity.entityType,
          matchMethod: external.namespace,
          status: "AUTO_CONFIRMED",
          rationale: "The source records expose the same typed stable external identifier. The identifier match is automatic; any name or descriptive-field differences remain visible for review.",
          evidenceObservationIds: pairEvidence(obsIndex, sourceEntity.id, targetEntity.id),
          evidenceEdgeIds: pairEvidence(edgeIdx, sourceEntity.id, targetEntity.id),
          payload: {
            identityScope: external.identityScope,
            identifierNamespace: external.namespace,
            identifierValue: external.value,
            identifierScope: external.identifierScope,
            identifierSourceScope: external.scopeKey
          }
        }));
      }
    }

    if (sourceEntity.entityType === "organization") {
      const sourceName = normalizeOrganizationName(
        sourceEntity.data?.legalName ?? sourceEntity.data?.name ?? sourceEntity.data?.organizationName
      );
      if (sourceName) {
        for (const peer of organizationNames.get(sourceName) ?? []) {
          if (peer.entity.id === sourceEntity.id) continue;

          const pair = sourceEntity.canonicalKey.localeCompare(peer.entity.canonicalKey) < 0
            ? [sourceEntity, peer.entity]
            : [peer.entity, sourceEntity];

          if (pair[0].id !== sourceEntity.id) continue;

          const aStable = stableExternalId(pair[0]);
          const bStable = stableExternalId(pair[1]);
          if (aStable?.value && bStable?.value && aStable.value !== bStable.value) {
            push(makeCandidate({
              a: pair[0],
              b: pair[1],
              entityType: "organization",
              matchMethod: "organization_name_conflicting_identifier",
              status: "CONFLICT",
              rationale: "The organization names normalize to the same value but the records expose different stable identifiers. They must not be merged automatically.",
              evidenceObservationIds: pairEvidence(obsIndex, pair[0].id, pair[1].id),
              evidenceEdgeIds: pairEvidence(edgeIdx, pair[0].id, pair[1].id),
              payload: {
                normalizedName: sourceName,
                sourceIdentifier: aStable.value,
                candidateIdentifier: bStable.value
              }
            }));
          } else if (!aStable?.value && !bStable?.value) {
            push(makeCandidate({
              a: pair[0],
              b: pair[1],
              entityType: "organization",
              matchMethod: "normalized_organization_name",
              status: "REVIEW_REQUIRED",
              rationale: "The organization names normalize to the same value without a shared stable identifier. This is a review candidate only.",
              evidenceObservationIds: pairEvidence(obsIndex, pair[0].id, pair[1].id),
              evidenceEdgeIds: pairEvidence(edgeIdx, pair[0].id, pair[1].id),
              payload: { normalizedName: sourceName }
            }));
          }
        }
      }
    }

    if (sourceEntity.entityType === "contractor") {
      const sourceName = normalizeOrganizationName(
        sourceEntity.data?.legalName ?? sourceEntity.data?.name ?? sourceEntity.data?.contractor
      );
      if (sourceName) {
        for (const peer of contractorNames.get(sourceName) ?? []) {
          if (peer.entity.id === sourceEntity.id) continue;

          const pair = sourceEntity.canonicalKey.localeCompare(peer.entity.canonicalKey) < 0
            ? [sourceEntity, peer.entity]
            : [peer.entity, sourceEntity];

          if (pair[0].id !== sourceEntity.id) continue;

          const aPcab = clean(pair[0].data?.pcabId);
          const bPcab = clean(pair[1].data?.pcabId);

          if (!aPcab && !bPcab) {
            push(makeCandidate({
              a: pair[0],
              b: pair[1],
              entityType: "contractor",
              matchMethod: "normalized_contractor_name",
              status: "REVIEW_REQUIRED",
              rationale: "The contractor names normalize to the same value, but no shared stable identifier was provided. This is a review candidate only.",
              evidenceObservationIds: pairEvidence(obsIndex, pair[0].id, pair[1].id),
              evidenceEdgeIds: pairEvidence(edgeIdx, pair[0].id, pair[1].id),
              payload: { normalizedName: sourceName }
            }));
          } else if (aPcab && bPcab && aPcab !== bPcab) {
            push(makeCandidate({
              a: pair[0],
              b: pair[1],
              entityType: "contractor",
              matchMethod: "contractor_name_conflicting_pcab",
              status: "CONFLICT",
              rationale: "The records share a normalized contractor name but expose different PCAB identifiers. They must not be merged automatically.",
              evidenceObservationIds: pairEvidence(obsIndex, pair[0].id, pair[1].id),
          evidenceEdgeIds: pairEvidence(edgeIdx, pair[0].id, pair[1].id),
              payload: {
                normalizedName: sourceName,
                sourcePcabId: aPcab,
                candidatePcabId: bPcab
              }
            }));
          }
        }
      }
    }

    const person = personDescriptor(sourceEntity);
    if (!person) continue;

    const peersSeen = new Set();
    for (const name of person.names) {
      for (const peer of personNames.get(name) ?? []) {
        if (peer.entity.id === sourceEntity.id || peersSeen.has(peer.entity.id)) continue;
        peersSeen.add(peer.entity.id);

        const match = personMatch(person, peer.descriptor);
        if (!match) continue;

        const pair = sourceEntity.canonicalKey.localeCompare(peer.entity.canonicalKey) < 0
          ? [sourceEntity, peer.entity]
          : [peer.entity, sourceEntity];

        if (pair[0].id !== sourceEntity.id) continue;

        push(makeCandidate({
          a: pair[0],
          b: pair[1],
          entityType: "person",
          matchMethod: match.matchMethod,
          status: "REVIEW_REQUIRED",
          rationale: match.rationale,
          evidenceObservationIds: pairEvidence(obsIndex, pair[0], pair[1]),
          payload: {
            sharedNameVariant: name,
            sourceNames: person.names,
            candidateNames: peer.descriptor.names,
            sourceStructuredNameKey: person.structuredNameKey,
            candidateStructuredNameKey: peer.descriptor.structuredNameKey,
            cityMatch: match.context.sameCity,
            provinceMatch: match.context.sameProvince,
            positionMatch: match.context.samePosition,
            sexMatch: match.context.sameSex,
            sexConflict: match.context.sexConflict,
            yearGap: match.context.yearGap
          }
        }));
      }
    }
  }

  candidates.sort((a, b) =>
    a.status.localeCompare(b.status) ||
    a.entityType.localeCompare(b.entityType) ||
    a.matchMethod.localeCompare(b.matchMethod) ||
    a.fingerprint.localeCompare(b.fingerprint)
  );

  return {
    engineVersion: ENTITY_RESOLUTION_ENGINE_VERSION,
    candidates,
    truncated
  };
}

export function buildAutoConfirmedClusters(candidates, entities) {
  const entityMap = new Map(entities.map(entity => [entity.id, entity]));
  const parent = new Map();
  const rank = new Map();

  function make(id) {
    if (!parent.has(id)) {
      parent.set(id, id);
      rank.set(id, 0);
    }
  }

  function find(id) {
    make(id);
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    while (parent.get(id) !== id) {
      const next = parent.get(id);
      parent.set(id, root);
      id = next;
    }
    return root;
  }

  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    const rka = rank.get(ra);
    const rkb = rank.get(rb);
    if (rka < rkb) parent.set(ra, rb);
    else if (rka > rkb) parent.set(rb, ra);
    else {
      parent.set(rb, ra);
      rank.set(ra, rka + 1);
    }
  }

  for (const candidate of candidates) {
    if (candidate.status !== "AUTO_CONFIRMED") continue;
    if (candidate.payload?.identityScope !== "entity_identity") continue;
    if (candidate.sourceEntityId === candidate.candidateEntityId) continue;
    union(candidate.sourceEntityId, candidate.candidateEntityId);
  }

  const groups = new Map();
  for (const id of parent.keys()) {
    const root = find(id);
    const list = groups.get(root) ?? [];
    list.push(id);
    groups.set(root, list);
  }

  const clusters = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const sorted = members
      .map(id => entityMap.get(id))
      .filter(Boolean)
      .sort((a, b) => a.canonicalKey.localeCompare(b.canonicalKey));

    const entityType = sorted[0]?.entityType;
    if (!entityType || sorted.some(item => item.entityType !== entityType)) continue;

    const identityCandidates = candidates.filter(item =>
      item.status === "AUTO_CONFIRMED" &&
      item.payload?.identityScope === "entity_identity" &&
      members.includes(item.sourceEntityId) &&
      members.includes(item.candidateEntityId)
    );

    const clusterKey = sha256({
      engineVersion: ENTITY_RESOLUTION_ENGINE_VERSION,
      entityType,
      memberCanonicalKeys: sorted.map(item => item.canonicalKey)
    });

    clusters.push({
      id: null,
      clusterKey,
      entityType,
      representativeEntityId: sorted[0].id,
      memberEntityIds: sorted.map(item => item.id),
      status: "AUTO_CONFIRMED",
      basis: {
        matchMethods: [...new Set(identityCandidates.map(item => item.matchMethod))].sort(),
        memberCount: sorted.length,
        rule: "connected_component_of_typed_stable_identifier_matches"
      }
    });
  }

  return clusters.sort((a, b) => a.clusterKey.localeCompare(b.clusterKey));
}
