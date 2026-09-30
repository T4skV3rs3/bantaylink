import assert from "node:assert/strict";
import { parseCsv } from "../src/ingestion/csv.js";
import { normalizeWinner, normalizeVote } from "../src/adapters/openhalalan.js";
import { normalizeDpwhProject } from "../src/adapters/dpwh.js";
import { normalizeSidlanIbuild } from "../src/adapters/da-sidlan.js";
import { normalizeCoaElibraryDocument } from "../src/adapters/coa-elibrary.js";
import { normalizePhilgepsRecord } from "../src/adapters/philgeps.js";

const csv = 'Last Name,First Name,Full Name,Position,Year\nDOE,JOHN,"DOE, JOHN",MAYOR,2025\n';
const parsed = parseCsv(csv);
assert.equal(parsed.length, 1);
assert.equal(parsed[0]["Full Name"], "DOE, JOHN");

const winner = normalizeWinner({
  "Last Name": "DOE",
  "First Name": "JOHN",
  "Middle Name": "SMITH",
  "Full Name": "DOE, JOHN SMITH",
  Position: "MAYOR",
  Party: "IND",
  Year: "2025",
  Province: "TEST",
  City: "TEST",
  Region: "TEST",
  Sex: "M",
  "Middle Name Source": "original",
  "Sex Source": "prior"
}, "hash-winner");
assert.equal(winner.entities[0].entityType, "election_result");
assert.equal(winner.entities[0].observations[0].sourceRecordId, winner.entities[0].canonicalKey);
assert.equal(winner.entities[0].data.year, 2025);

const vote = normalizeVote({
  year: "2025",
  region: "TEST",
  province: "TEST",
  city: "TEST",
  position: "MAYOR",
  candidate_name: "DOE, JOHN",
  party: "IND",
  votes: "1234",
  percentage: "61.2",
  rank: "2",
  is_national_race: "false",
  is_geographic: "true"
}, "hash-vote");
assert.equal(vote.entities[0].data.votes, 1234);

const project = normalizeDpwhProject({
  contractId: "25AA0001",
  description: "TEST PROJECT",
  category: "Roads",
  status: "Suspended",
  infraType: "Roads",
  budget: 1000,
  progress: 25,
  location: { region: "Region I" },
  contractor: "TEST BUILDER",
  completionDate: "2026-01-01"
}, "hash-project");
assert.equal(project.entities[0].entityType, "project");
assert.equal(project.entities[0].canonicalKey, "dpwh-contract:25AA0001");
assert.deepEqual(project.entities[0].data.signals, ["suspended"]);
assert.equal(project.entities[0].data.infraType, "Roads");
assert.equal(project.entities[0].data.pcabId, null);
assert.equal(project.entities.length, 2);
assert.equal(project.edges.length, 1);
assert.equal(project.edges[0].edgeType, "contracted_to");
assert.equal(project.entities[1].entityType, "contractor");

const sidlan = normalizeSidlanIbuild({
  sp_id: "IB-123",
  sp_name: "Farm to Market Road",
  region: "Region V",
  province: "Camarines Norte",
  municipality: "Daet",
  awarded_cost: "1234567.89",
  Physical_Progress: "42.5",
  specific_status: "Construction"
}, "hash-sidlan");
assert.equal(sidlan.entities[0].entityType, "project");
assert.equal(sidlan.entities[0].canonicalKey, "da-sidlan:ibuild:IB-123");
assert.equal(sidlan.entities[0].data.awardedCost, 1234567.89);
assert.equal(sidlan.entities[0].data.physicalProgress, 42.5);

const coa = normalizeCoaElibraryDocument({
  url: "https://elibrary.coa.gov.ph/resource/view/demo",
  title: "Demo Annual Audit Report",
  category: "Annual Audit Reports",
  published: "2025",
  documentId: "demo"
});
assert.equal(coa.entities[0].entityType, "source");
assert.equal(coa.entities[0].observations[0].recordType, "official_document");

const philgeps = normalizePhilgepsRecord({
  "Reference Number": "ABC-123",
  "Project Title": "Road repair",
  "Procuring Entity": "Test LGU",
  "Award Amount": "1,234,567.00",
  "Awardee": "Test Builder"
}, "hash-philgeps", "https://open.philgeps.gov.ph/data/example.csv");
assert.equal(philgeps.entities[0].entityType, "procurement_event");
assert.equal(philgeps.entities[0].canonicalKey, "philgeps:ABC-123");
assert.equal(philgeps.entities[0].data.awardAmount, 1234567);
assert.equal(philgeps.entities[0].data.awardee, "Test Builder");

console.log("Adapter normalization checks passed.");
