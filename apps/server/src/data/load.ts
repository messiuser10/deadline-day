/** Reads the supplied data files from data/ and parses them with the engine. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseClubs,
  parseCsvRecords,
  parseMasterRows,
  parseSeedPlayers,
  toMasterPlayer,
  toSeedPlayer,
  unwrapPlayers,
  validateData,
  type ClubData,
  type DataInput,
  type DataReport,
  type MasterPlayer,
  type SeedPlayer,
} from '@deadline-day/engine';
import { DATA_DIR } from '../paths';

export const DATA_FILES = {
  masterCsv: 'auction_players.csv',
  masterJson: 'auction_players.json',
  clubs: 'clubs.json',
  seedJson: 'players.seed.json',
  seedCsv: 'players.csv',
} as const;

export interface LoadedData {
  input: DataInput;
  report: DataReport;
  clubs: ClubData[];
  seedPlayers: SeedPlayer[];
  masterPlayers: MasterPlayer[];
}

export function readDataInput(dataDir: string = DATA_DIR): DataInput {
  const read = (name: string) => readFileSync(join(dataDir, name), 'utf8');
  return {
    masterCsv: parseCsvRecords(read(DATA_FILES.masterCsv)),
    masterJson: unwrapPlayers(JSON.parse(read(DATA_FILES.masterJson))),
    clubs: JSON.parse(read(DATA_FILES.clubs)) as unknown[],
    seedPlayers: unwrapPlayers(JSON.parse(read(DATA_FILES.seedJson))),
    seedCsv: parseCsvRecords(read(DATA_FILES.seedCsv)),
  };
}

/** Read, validate and parse every data file. Parsed lists are only meaningful when report.errors is empty. */
export function loadData(dataDir: string = DATA_DIR): LoadedData {
  const input = readDataInput(dataDir);
  const report = validateData(input);
  return {
    input,
    report,
    clubs: parseClubs(input.clubs).rows,
    seedPlayers: parseSeedPlayers(input.seedPlayers).rows.map(toSeedPlayer),
    masterPlayers: parseMasterRows(input.masterCsv).rows.map(toMasterPlayer),
  };
}
