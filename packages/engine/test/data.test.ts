import { describe, expect, it } from 'vitest';
import {
  EXPECTED_SEED_CLUB_LINKS,
  findSeedMatches,
  parseMasterRows,
  parseSeedPlayers,
  validateData,
  type DataInput,
} from '../src';
import { loadDataInput } from './fixtures';

const data = loadDataInput();

/** Copy the input with one master CSV row changed. */
function withMasterRow(index: number, patch: Record<string, string>): DataInput {
  const masterCsv = data.masterCsv.map((r, i) => (i === index ? { ...(r as object), ...patch } : r));
  return { ...data, masterCsv, masterJson: undefined };
}

describe('supplied data', () => {
  it('passes validation with no errors', () => {
    const report = validateData(data);
    expect(report.errors).toEqual([]);
    expect(report.masterCount).toBe(570);
    expect(report.clubCount).toBe(20);
    expect(report.seedPlayerCount).toBe(618);
    expect(report.masterByGroup).toEqual({
      GK: 45, CB: 60, RB: 45, LB: 45, CDM: 50, CM: 60, CAM: 50, ST: 50, RM: 40, LM: 40, RW: 40, LW: 45,
    });
  });

  it('resolves all 265 seed_club players to exactly one AI squad player', () => {
    const master = parseMasterRows(data.masterCsv).rows;
    const seed = parseSeedPlayers(data.seedPlayers).rows;
    const linked = master.filter((p) => p.seedClub !== null);
    expect(linked).toHaveLength(EXPECTED_SEED_CLUB_LINKS);
    for (const p of linked) expect(findSeedMatches(p, seed), p.id).toHaveLength(1);
    expect(validateData(data).seedClubLinksResolved).toBe(EXPECTED_SEED_CLUB_LINKS);
  });

  it('has Messi as a CAM with verified alternates ST, RW and RM', () => {
    const messi = parseMasterRows(data.masterCsv).rows.find((p) => p.name === 'Lionel Messi');
    expect(messi).toMatchObject({ position: 'CAM', altPositions: ['ST', 'RW', 'RM'], altSource: 'ea' });
  });

  it('contains no player with a position outside the 12 groups', () => {
    for (const p of parseMasterRows(data.masterCsv).rows) {
      expect(['GK', 'RB', 'LB', 'CB', 'CDM', 'CM', 'CAM', 'RM', 'LM', 'RW', 'LW', 'ST']).toContain(p.position);
    }
  });
});

describe('validation catches broken data', () => {
  const firstError = (input: DataInput) => validateData(input).errors.join('\n');

  it('a wrong row count', () => {
    expect(firstError({ ...data, masterCsv: data.masterCsv.slice(1), masterJson: undefined })).toMatch(/expected 570 rows, found 569/);
  });

  it('a duplicate id', () => {
    const id = (data.masterCsv[0] as { id: string }).id;
    expect(firstError(withMasterRow(1, { id }))).toMatch(/duplicate id/);
  });

  it('a position outside the 12 allowed', () => {
    expect(firstError(withMasterRow(0, { position: 'CF' }))).toMatch(/position CF is not one of/);
    expect(firstError(withMasterRow(0, { alt_positions: 'LWB' }))).toMatch(/alternate position LWB is not one of/);
  });

  it('an alternate equal to the main position', () => {
    expect(firstError(withMasterRow(0, { alt_positions: 'GK' }))).toMatch(/equals the main position/);
  });

  it('a rating outside 40 to 99', () => {
    expect(firstError(withMasterRow(0, { overall: '100' }))).toMatch(/overall 100 outside 40 to 99/);
    expect(firstError(withMasterRow(0, { overall: '39' }))).toMatch(/overall 39 outside/);
  });

  it('a price that does not match the formula', () => {
    expect(firstError(withMasterRow(0, { market_value_m: '999' }))).toMatch(/market_value_m 999 does not match/);
    expect(firstError(withMasterRow(0, { base_price_m: '1' }))).toMatch(/base_price_m 1 does not match/);
  });

  it('a seed_club that does not exist', () => {
    expect(firstError(withMasterRow(0, { seed_club: 'Nowhere FC' }))).toMatch(/seed_club Nowhere FC does not exist/);
  });

  it('a CSV and JSON that disagree', () => {
    const masterJson = data.masterJson!.map((r, i) => (i === 0 ? { ...(r as object), overall: 70 } : r));
    expect(firstError({ ...data, masterJson })).toMatch(/differs from the CSV in overall/);
  });
});
