// Test-only helpers that read the supplied data files. The engine itself never does I/O.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCsvRecords, unwrapPlayers, type DataInput } from '../src';

const dataDir = fileURLToPath(new URL('../../../data/', import.meta.url));

function read(name: string): string {
  return readFileSync(dataDir + name, 'utf8');
}

export function loadDataInput(): DataInput {
  return {
    masterCsv: parseCsvRecords(read('auction_players.csv')),
    masterJson: unwrapPlayers(JSON.parse(read('auction_players.json'))),
    clubs: JSON.parse(read('clubs.json')) as unknown[],
    seedPlayers: unwrapPlayers(JSON.parse(read('players.seed.json'))),
    seedCsv: parseCsvRecords(read('players.csv')),
  };
}
