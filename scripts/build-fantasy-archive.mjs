// Build src/fixtures/fantasy-archive.json from a database that holds a full
// read of a finished Major (PHA-5454). Read the Major in first, stage by stage:
//   GET /api/fantasy/refresh?event=<valve id>&hltvEvent=<hltv id>   (owner / dev)
// then:
//   DATABASE_URL=file:/path/to.db node scripts/build-fantasy-archive.mjs 26
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const ids = process.argv.slice(2).map(Number).filter(Number.isInteger);
if (ids.length === 0) {
  console.error("usage: node scripts/build-fantasy-archive.mjs <valve event id> [...]");
  process.exit(1);
}
const prisma = new PrismaClient();
const out = {};
for (const eventId of ids) {
  const rows = await prisma.fantasyMatch.findMany({ where: { eventId }, orderBy: [{ startAt: "asc" }, { hltvMatchId: "asc" }] });
  out[eventId] = rows.map((r) => ({ stageId: r.stageId, data: JSON.parse(r.data) }));
  const byStage = {};
  for (const r of rows) byStage[r.stageId] = (byStage[r.stageId] ?? 0) + 1;
  console.log(`event ${eventId}: ${rows.length} matches`, byStage);
}
const file = join(dirname(fileURLToPath(import.meta.url)), "../src/fixtures/fantasy-archive.json");
writeFileSync(file, JSON.stringify(out) + "\n");
console.log("wrote", file);
await prisma.$disconnect();
