/**
 * npm run data:validate                 check the supplied files in data/ (section 5)
 * npm run data:validate -- --dir <path> check another folder with the same five files
 * Exits 1 on any error.
 */
import { resolve } from 'node:path';
import { MAX_TEAMS } from '@deadline-day/engine';
import { loadData } from '@deadline-day/server/data';
import { DATA_DIR } from '@deadline-day/server/paths';

const dirFlag = process.argv.indexOf('--dir');
const dir = dirFlag >= 0 && process.argv[dirFlag + 1] ? resolve(process.env.INIT_CWD ?? process.cwd(), process.argv[dirFlag + 1]!) : DATA_DIR;

const { report } = loadData(dir);

console.log(`Deadline Day data check (${dir})\n`);
console.log(`master pool players  ${report.masterCount}`);
console.log(`AI clubs             ${report.clubCount}`);
console.log(`AI squad players     ${report.seedPlayerCount}`);
console.log(`seed_club links      ${report.seedClubLinks} (${report.seedClubLinksResolved} resolve to exactly one squad player)\n`);

console.log(`Supply per group, ${MAX_TEAMS} teams, worst case (heaviest enabled formation for every group):`);
console.log('group  master  need  pool  spare');
for (const s of report.supply) {
  console.log(
    `${s.group.padEnd(5)}  ${String(s.master).padStart(6)}  ${String(s.worstCaseNeed).padStart(4)}  ${String(s.worstCaseSize).padStart(4)}  ${String(s.spare).padStart(5)}`,
  );
}

if (report.warnings.length) {
  console.log(`\n${report.warnings.length} warning(s):`);
  for (const w of report.warnings) console.log(`  - ${w}`);
}

if (report.errors.length) {
  console.error(`\nFAILED with ${report.errors.length} error(s):`);
  for (const e of report.errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log('\nOK: data is valid.');
