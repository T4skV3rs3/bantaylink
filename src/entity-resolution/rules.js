import { sha256 } from "../ingestion/hash.js";

export const ENTITY_RESOLUTION_ENGINE_VERSION = "1.2.0";

const WINNER_DATASET = "NLE_Winners_2004-2025";
const MAX_EVIDENCE_IDS_PER_ENTITY = 200;
const MAX_NAME_VARIANTS = 6;

const ENTITY_TYPES = new Set([
  "project",
  "contractor",
  "organization",
  "person",
  "procurement_event",
  "source",
  "election_result"
]);

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
    .replace(/\b(JR|SR|II|III|IV|V|VI|VII|VIII)\b/g, " ")
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
    .replace(/\b(INCORPORATED|CORPORATION|COMPANY|LIMITED|HOLDINGS|HOLDING)\b/g, " ")
    .replace(/\b(INC|CORP|CO|LTD|LLC|PLC)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function numeric(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function yearFromDate(value) {
  const match = clean(value).match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function winnerEntity(entity) {
  return entity.entityType === "election_result" &&
    (entity.data?.dataset === WINNER_DATASET || entity.data?.dataset == null);
}

export function identityTypeForEntity(entity) {
  if (entity.entityType === "election_result" || entity.entityType === "person") return "person";
  if (entity.entityType === "contractor" || entity.entityType === "organization") return "organization";
  if (entity.entityType === "source") return "document";
  return entity.entityType;
}

function eligibleEntity(entity) {
  if (!ENTITY_TYPES.has(entity.entityType)) return false;
  if (entity.entityType === "election_result") return winnerEntity(entity);
  return true;
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
      values.add([parts[1], parts[0]].join(" "));
      values.add([parts[0], parts[1]].join(" "));
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
  const names = nameVariants(data);
  if (!names.length) return null;

  const city = normalizePlace(data.city ?? data.municipality);
  const province = normalizePlace(data.province);

  return {
    names,
    primaryName: names[0],
    structuredNameKey: structuredNameKey(data),
    city,
    province,
    localityKey: [city, province].filter(Boolean).join("::") || null,
    position: normalizePosition(data.position),
    sex: normalizeText(data.sex),
    year: numeric(data.year)
  };
}

function organizationDescriptor(entity) {
  if (!["contractor", "organization"].includes(entity.entityType)) return null;
  const data = entity.data ?? {};
  const legalName = clean(data.legalName ?? data.name ?? data.contractor ?? data.awardee ?? data.procuringEntity);
  const name = normalizeOrganizationName(legalName);
  if (!name) return null;

  return {
    name,
    legalName,
    pcabId: clean(data.pcabId),
    merchantId: clean(data.merchantId ?? data.philgepsMerchantId ?? data.supplierId),
    sourceOrganizationId: clean(data.sourceOrganizationId ?? data.procuringEntityId ?? data.organizationId),
    city: normalizePlace(data.city ?? data.municipality),
    province: normalizePlace(data.province),
    region: normalizePlace(data.region)
  };
}

function projectDescriptor(entity) {
  if (entity.entityType !== "project") return null;
  const data = entity.data ?? {};
  const title = clean(data.description ?? data.projectDescription ?? data.name ?? data.spName);
  const normalizedTitle = normalizeText(title);
  if (!normalizedTitle) return null;

  const years = new Set(
    [data.infraYear, data.year, data.projectYear, yearFromDate(data.startDate),
      yearFromDate(data.contractEffectivityDate), yearFromDate(data.expiryDate),
      yearFromDate(data.completionDate)]
      .map(numeric)
      .filter(Boolean)
  );

  return {
    title,
    normalizedTitle,
    city: normalizePlace(data.city ?? data.municipality ?? data.location?.city ?? data.location?.municipality),
    province: normalizePlace(data.province ?? data.location?.province),
    region: normalizePlace(data.region ?? data.location?.region),
    years: [...years].sort(),
    amount: numeric(data.contractAmount ?? data.awardedAmount ?? data.budget ?? data.estimatedProjectCost ?? data.awardedCost)
  };
}

function procurementDescriptor(entity) {
  if (entity.entityType !== "procurement_event") return null;
  const data = entity.data ?? {};
  const title = clean(data.title ?? data.projectName ?? data.projectTitle ?? data.description ?? data.name);
  const normalizedTitle = normalizeText(title);
  if (!normalizedTitle) return null;

  const years = new Set(
    [yearFromDate(data.postingDate), yearFromDate(data.awardDate), numeric(data.year)]
      .map(numeric)
      .filter(Boolean)
  );

  return {
    title,
    normalizedTitle,
    city: normalizePlace(data.city ?? data.municipality ?? data.location?.city ?? data.location?.municipality),
    province: normalizePlace(data.province ?? data.location?.province),
    region: normalizePlace(data.region ?? data.location?.region),
    years: [...years].sort(),
    amount: numeric(data.awardAmount ?? data.abc ?? data.contractAmount)
  };
}

function stableExternalIdentifiers(entity) {
  const data = entity.data ?? {};
  const out = [];
  const add = (namespace, value) => {
    const normalized = clean(value);
    if (!normalized) return;
    const identityType = identityTypeForEntity(entity);
    out.push({
      identityType,
      namespace,
      value: normalized,
      key: identityType + "::" + namespace + "::" + normalizeText(normalized)
    });
  };

  if (entity.entityType === "project") {
    add("contract_id", data.contractId);
    add("sp_id", data.spId);
  }

  if (entity.entityType === "procurement_event") {
    const reference = clean(data.referenceNumber);
    const procuringEntity = normalizeText(data.procuringEntity);
    if (reference && procuringEntity) add("procurement_reference", procuringEntity + "::" + reference);
  }

  if (["contractor", "organization"].includes(entity.entityType)) {
    add("pcab_id", data.pcabId);
    add("stable_contractor_id", data.stableContractorId);
    add("merchant_id", data.merchantId ?? data.philgepsMerchantId ?? data.supplierId);
    add("stable_organization_id", data.stableOrganizationId);
    add("source_organization_id", data.sourceOrganizationId ?? data.procuringEntityId ?? data.organizationId);
  }

  if (entity.entityType === "source") {
    add("document_id", data.documentId);
    add("tracking_number", data.trackingNumber);
    add("source_url", data.url ?? data.canonicalUrl);
  }

  if (entity.entityType === "person" || entity.entityType === "election_result") {
    add("stable_person_id", data.stablePersonId);
    add("source_person_id", data.sourcePersonId);
  }

  return out;
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

function evidenceIds(index, entityId) {
  return (index.get(entityId) ?? [])
    .map(item => item.id)
    .sort()
    .slice(0, MAX_EVIDENCE_IDS_PER_ENTITY);
}

function pairEvidence(index, a, b) {
  return [...new Set([...evidenceIds(index, a.id), ...evidenceIds(index, b.id)])]
    .sort()
    .slice(0, MAX_EVIDENCE_IDS_PER_ENTITY * 2);
}

function candidateFingerprint(method, groupKey, a, b) {
  const keys = [a.canonicalKey, b.canonicalKey].sort();
  return sha256({
    engineVersion: ENTITY_RESOLUTION_ENGINE_VERSION,
    method,
    groupKey: groupKey ?? null,
    source: keys[0],
    target: keys[1]
  });
}

function makeCandidate({
  a,
  b,
  entityType,
  identityGroupKey = null,
  matchMethod,
  status,
  rationale,
  evidenceObservationIds,
  payload = {}
}) {
  const ordered = a.canonicalKey.localeCompare(b.canonicalKey) <= 0 ? [a, b] : [b, a];

  return {
    id: null,
    fingerprint: candidateFingerprint(matchMethod, identityGroupKey, ordered[0], ordered[1]),
    sourceEntityId: ordered[0].id,
    candidateEntityId: ordered[1].id,
    entityType,
    identityGroupKey,
    matchMethod,
    status,
    rationale,
    evidenceObservationIds: [...new Set(evidenceObservationIds)].sort(),
    evidenceEdgeIds: [],
    payload
  };
}

function addCandidateFactory(candidates, seen, maxCandidates) {
  return item => {
    if (candidates.length >= maxCandidates || seen.has(item.fingerprint)) return false;
    seen.add(item.fingerprint);
    candidates.push(item);
    return true;
  };
}

function sameArraySet(a, b) {
  if (!a.length || !b.length) return false;
  const values = new Set(b);
  return a.some(item => values.has(item));
}

function amountClose(a, b) {
  if (a == null || b == null || a <= 0 || b <= 0) return false;
  return Math.abs(a - b) / Math.max(a, b) <= 0.05;
}

function tokenSimilarity(a, b) {
  const left = new Set(normalizeText(a).split(" ").filter(Boolean));
  const right = new Set(normalizeText(b).split(" ").filter(Boolean));
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap += 1;
  return overlap / new Set([...left, ...right]).size;
}

function projectContextMatch(a, b) {
  const titleExact = a.normalizedTitle === b.normalizedTitle;
  const similarity = tokenSimilarity(a.normalizedTitle, b.normalizedTitle);
  const sameCity = Boolean(a.city && b.city && a.city === b.city);
  const sameProvince = Boolean(a.province && b.province && a.province === b.province);
  const sameRegion = Boolean(a.region && b.region && a.region === b.region);
  const sameYear = sameArraySet(a.years, b.years);
  const closeAmount = amountClose(a.amount, b.amount);

  const titleMatch = titleExact || similarity >= 0.92;
  const contextCount = [sameCity, sameProvince, sameRegion, sameYear, closeAmount].filter(Boolean).length;

  return {
    titleExact,
    similarity: Number(similarity.toFixed(4)),
    sameCity,
    sameProvince,
    sameRegion,
    sameYear,
    closeAmount,
    contextCount,
    valid: titleMatch && contextCount >= (titleExact ? 1 : 2)
  };
}

function personContextMatch(a, b) {
  const sameCity = Boolean(a.city && b.city && a.city === b.city);
  const sameProvince = Boolean(a.province && b.province && a.province === b.province);
  const samePosition = Boolean(a.position && b.position && a.position === b.position);
  const sameSex = Boolean(a.sex && b.sex && a.sex === b.sex);
  const sexConflict = Boolean(a.sex && b.sex && a.sex !== b.sex);
  const yearGap = a.year != null && b.year != null ? Math.abs(a.year - b.year) : null;

  return { sameCity, sameProvince, samePosition, sameSex, sexConflict, yearGap };
}

function personCandidateMatch(a, b) {
  const sharedName = a.names.find(value => b.names.includes(value));
  if (!sharedName) return null;

  const context = personContextMatch(a, b);

  if (context.sameCity && context.sameProvince) {
    return {
      method: "name_locality_candidate",
      rationale: "The records share a normalized full-name variant and the same recorded city/municipality and province. This remains a review candidate and does not establish that they are the same real-world person."
    };
  }

  if (context.sameProvince) {
    return {
      method: "name_province_candidate",
      rationale: "The records share a normalized full-name variant and the same recorded province, but not the same complete locality context. This remains a research candidate and is not identity proof."
    };
  }

  if (context.samePosition && context.yearGap != null && context.yearGap <= 8 &&
      (a.city || a.province || b.city || b.province)) {
    return {
      method: "name_office_time_candidate",
      rationale: "The records share a normalized full-name variant and compatible office/time context. This remains a research candidate and is not identity proof."
    };
  }

  return null;
}

function organizationNameCandidates(entities) {
  const index = new Map();
  for (const entity of entities) {
    const descriptor = organizationDescriptor(entity);
    if (!descriptor) continue;
    const list = index.get(descriptor.name) ?? [];
    list.push({ entity, descriptor });
    index.set(descriptor.name, list);
  }
  return index;
}

function personNameCandidates(entities) {
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

function stableIndex(entities) {
  const index = new Map();
  for (const entity of entities) {
    for (const external of stableExternalIdentifiers(entity)) {
      const list = index.get(external.key) ?? [];
      list.push({ entity, external });
      index.set(external.key, list);
    }
  }
  return index;
}

function ordered(a, b) {
  return a.canonicalKey.localeCompare(b.canonicalKey) <= 0 ? [a, b] : [b, a];
}

export function resolveEntities(snapshot, { maxCandidates = 25000 } = {}) {
  if (!snapshot || !Array.isArray(snapshot.entities) ||
      !Array.isArray(snapshot.observations) || !Array.isArray(snapshot.edges)) {
    throw new Error("Entity resolution requires entities, observations, and edges arrays.");
  }

  const entities = snapshot.entities
    .filter(eligibleEntity)
    .slice()
    .sort((a, b) => a.canonicalKey.localeCompare(b.canonicalKey));

  const obsIndex = observationIndex(snapshot);
  const stable = stableIndex(entities);
  const people = personNameCandidates(entities);
  const organizations = organizationNameCandidates(entities);
  const projects = entities.map(projectDescriptor).filter(Boolean);
  const procurement = entities.map(procurementDescriptor).filter(Boolean);
  const candidates = [];
  const seen = new Set();
  const push = addCandidateFactory(candidates, seen, maxCandidates);

  for (const sourceEntity of entities) {
    const sourceStable = stableExternalIdentifiers(sourceEntity);

    for (const external of sourceStable) {
      for (const peer of stable.get(external.key) ?? []) {
        if (peer.entity.id === sourceEntity.id) continue;

        const pair = ordered(sourceEntity, peer.entity);
        const sourceData = sourceEntity.data ?? {};
        const targetData = peer.entity.data ?? {};
        const sourceName = normalizeName(sourceData.fullName ?? sourceData.name ?? sourceData.legalName ?? sourceData.contractor ?? sourceData.awardee);
        const targetName = normalizeName(targetData.fullName ?? targetData.name ?? targetData.legalName ?? targetData.contractor ?? targetData.awardee);

        push(makeCandidate({
          a: pair[0],
          b: pair[1],
          entityType: external.identityType,
          identityGroupKey: external.key,
          matchMethod: external.namespace,
          status: "AUTO_CONFIRMED",
          rationale: "The source records expose the same typed stable external identifier. The identifier match is automatic; any descriptive-field differences remain visible for review.",
          evidenceObservationIds: pairEvidence(obsIndex, pair[0], pair[1]),
          payload: {
            identityType: external.identityType,
            identityScope: "entity_identity",
            identifierNamespace: external.namespace,
            identifierValue: external.value,
            sourceEntityType: pair[0].entityType,
            candidateEntityType: pair[1].entityType,
            normalizedNameMatch: Boolean(sourceName && targetName && sourceName === targetName),
            nameDifference: Boolean(sourceName && targetName && sourceName !== targetName)
          }
        }));
      }
    }

    const organization = organizationDescriptor(sourceEntity);
    if (organization) {
      for (const peer of organizations.get(organization.name) ?? []) {
        if (peer.entity.id === sourceEntity.id) continue;
        const pair = ordered(sourceEntity, peer.entity);
        if (pair[0].id !== sourceEntity.id) continue;

        const sourceIds = stableExternalIdentifiers(pair[0]);
        const targetIds = stableExternalIdentifiers(pair[1]);
        const conflictingNamespace = sourceIds
          .filter(item => ["pcab_id","merchant_id","stable_contractor_id","stable_organization_id","source_organization_id"].includes(item.namespace))
          .find(item => targetIds.some(other =>
            other.namespace === item.namespace &&
            normalizeText(other.value) !== normalizeText(item.value)
          ));

        if (conflictingNamespace) {
          push(makeCandidate({
            a: pair[0],
            b: pair[1],
            entityType: "organization",
            matchMethod: "organization_name_conflicting_identifier",
            status: "CONFLICT",
            rationale: "The records share a normalized organization name but expose different values for the same typed stable identifier namespace. They must not be merged automatically.",
            evidenceObservationIds: pairEvidence(obsIndex, pair[0], pair[1]),
            payload: {
              normalizedName: organization.name,
              conflictingNamespace: conflictingNamespace.namespace,
              sourceValue: conflictingNamespace.value,
              candidateValue: targetIds.find(item => item.namespace === conflictingNamespace.namespace)?.value ?? null
            }
          }));
        } else {
          push(makeCandidate({
            a: pair[0],
            b: pair[1],
            entityType: "organization",
            matchMethod: "normalized_organization_name",
            status: "REVIEW_REQUIRED",
            rationale: "The records expose the same normalized organization name, but no shared typed stable identifier was established by this rule. This is a review candidate, not identity proof.",
            evidenceObservationIds: pairEvidence(obsIndex, pair[0], pair[1]),
            payload: {
              normalizedName: organization.name,
              sourceEntityType: pair[0].entityType,
              candidateEntityType: pair[1].entityType,
              sourcePcabId: clean(pair[0].data?.pcabId) || null,
              candidatePcabId: clean(pair[1].data?.pcabId) || null
            }
          }));
        }
      }
    }

    const person = personDescriptor(sourceEntity);
    if (person) {
      const peersSeen = new Set();
      for (const name of person.names) {
        for (const peer of people.get(name) ?? []) {
          if (peer.entity.id === sourceEntity.id || peersSeen.has(peer.entity.id)) continue;
          peersSeen.add(peer.entity.id);

          const match = personCandidateMatch(person, peer.descriptor);
          if (!match) continue;

          const pair = ordered(sourceEntity, peer.entity);
          if (pair[0].id !== sourceEntity.id) continue;

          const context = personContextMatch(person, peer.descriptor);
          push(makeCandidate({
            a: pair[0],
            b: pair[1],
            entityType: "person",
            matchMethod: match.method,
            status: "REVIEW_REQUIRED",
            rationale: match.rationale,
            evidenceObservationIds: pairEvidence(obsIndex, pair[0], pair[1]),
            payload: {
              identityType: "person",
              identityScope: "name_context",
              sharedNameVariant: name,
              sourceNames: person.names,
              candidateNames: peer.descriptor.names,
              sourceStructuredNameKey: person.structuredNameKey,
              candidateStructuredNameKey: peer.descriptor.structuredNameKey,
              cityMatch: context.sameCity,
              provinceMatch: context.sameProvince,
              positionMatch: context.samePosition,
              sexMatch: context.sameSex,
              sexConflict: context.sexConflict,
              yearGap: context.yearGap
            }
          }));
        }
      }
    }
  }

  for (let i = 0; i < projects.length; i += 1) {
    for (let j = i + 1; j < projects.length; j += 1) {
      const a = projects[i];
      const b = projects[j];
      if (a.entity.id === b.entity.id) continue;
      const context = projectContextMatch(a, b);
      if (!context.valid) continue;

      const pair = ordered(a.entity, b.entity);
      push(makeCandidate({
        a: pair[0],
        b: pair[1],
        entityType: "project",
        matchMethod: "project_context_candidate",
        status: "REVIEW_REQUIRED",
        rationale: "The records have strongly similar project descriptions plus at least one shared jurisdiction, year, or amount signal. This is a project crosswalk candidate only and should be checked against the underlying source records.",
        evidenceObservationIds: pairEvidence(obsIndex, pair[0], pair[1]),
        payload: {
          identityType: "project",
          identityScope: "cross_source_context",
          sourceTitle: a.title,
          candidateTitle: b.title,
          ...context
        }
      }));
    }
  }

  for (const project of projects) {
    for (const event of procurement) {
      const context = projectContextMatch(project, event);
      if (!context.valid) continue;
      const pair = ordered(project.entity, event.entity);
      push(makeCandidate({
        a: pair[0],
        b: pair[1],
        entityType: "project_procurement",
        matchMethod: "project_procurement_context_candidate",
        status: "REVIEW_REQUIRED",
        rationale: "The project and procurement record have strongly similar descriptions plus at least one shared jurisdiction, year, or amount signal. This is a crosswalk candidate and does not by itself establish that the procurement event is the same project.",
        evidenceObservationIds: pairEvidence(obsIndex, pair[0], pair[1]),
        payload: {
          identityType: "project_procurement",
          identityScope: "cross_source_context",
          projectTitle: project.title,
          procurementTitle: event.title,
          ...context
        }
      }));
    }
  }

  candidates.sort((a, b) =>
    a.status.localeCompare(b.status) ||
    a.entityType.localeCompare(b.entityType) ||
    a.matchMethod.localeCompare(b.matchMethod) ||
    (a.identityGroupKey ?? "").localeCompare(b.identityGroupKey ?? "") ||
    a.fingerprint.localeCompare(b.fingerprint)
  );

  return {
    engineVersion: ENTITY_RESOLUTION_ENGINE_VERSION,
    candidates,
    truncated: candidates.length >= maxCandidates
  };
}

export function buildAutoConfirmedClusters(candidates, entities) {
  const entityMap = new Map(entities.map(entity => [entity.id, entity]));
  const parent = new Map();
  const rank = new Map();

  function nodeKey(identityType, entityId) {
    return identityType + "::" + entityId;
  }

  function make(key) {
    if (!parent.has(key)) {
      parent.set(key, key);
      rank.set(key, 0);
    }
  }

  function find(key) {
    make(key);
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root);
    while (parent.get(key) !== key) {
      const next = parent.get(key);
      parent.set(key, root);
      key = next;
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
    union(nodeKey(candidate.entityType, candidate.sourceEntityId), nodeKey(candidate.entityType, candidate.candidateEntityId));
  }

  const grouped = new Map();
  for (const key of parent.keys()) {
    const root = find(key);
    const separator = key.indexOf("::");
    const identityType = separator === -1 ? key : key.slice(0, separator);
    const list = grouped.get(root) ?? { identityType, members: [] };
    list.members.push(key);
    grouped.set(root, list);
  }

  const clusters = [];
  for (const group of grouped.values()) {
    const prefix = group.identityType + "::";
    const memberIds = [...new Set(group.members
      .filter(key => key.startsWith(prefix))
      .map(key => key.slice(prefix.length)))];
    if (memberIds.length < 2) continue;

    const sorted = memberIds
      .map(id => entityMap.get(id))
      .filter(Boolean)
      .sort((a, b) => a.canonicalKey.localeCompare(b.canonicalKey));

    if (sorted.length < 2) continue;

    const clusterCandidates = candidates.filter(candidate =>
      candidate.status === "AUTO_CONFIRMED" &&
      candidate.entityType === group.identityType &&
      memberIds.includes(candidate.sourceEntityId) &&
      memberIds.includes(candidate.candidateEntityId)
    );

    const clusterKey = sha256({
      engineVersion: ENTITY_RESOLUTION_ENGINE_VERSION,
      identityType: group.identityType,
      memberCanonicalKeys: sorted.map(entity => entity.canonicalKey)
    });

    clusters.push({
      id: null,
      clusterKey,
      entityType: group.identityType,
      representativeEntityId: sorted[0].id,
      memberEntityIds: sorted.map(entity => entity.id),
      status: "AUTO_CONFIRMED",
      basis: {
        identityGroupKeys: [...new Set(clusterCandidates.map(item => item.identityGroupKey).filter(Boolean))].sort(),
        matchMethods: [...new Set(clusterCandidates.map(item => item.matchMethod))].sort(),
        memberCount: sorted.length,
        rule: "connected_component_of_typed_stable_identifier_matches"
      }
    });
  }

  return clusters.sort((a, b) => a.clusterKey.localeCompare(b.clusterKey));
}
