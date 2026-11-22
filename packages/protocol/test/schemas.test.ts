import { describe, expect, it } from 'vitest';
import {
  BOT_TEAM_NAMES,
  JOIN_CODE_ALPHABET,
  TEAM_COLORS,
  chatSchema,
  createGameSchema,
  guestSchema,
  joinCodeSchema,
  monogramSchema,
  registerSchema,
  teamNameSchema,
  teamPatchSchema,
} from '../src';

const team = { teamName: 'Gavel United', color: '#22C36B', monogram: 'gu', formation: '4-3-3' };

describe('auth schemas', () => {
  it('lowercases usernames and rejects odd characters', () => {
    expect(registerSchema.parse({ username: 'Reyansh_7', password: 'longenough' }).username).toBe('reyansh_7');
    expect(registerSchema.safeParse({ username: 'no spaces', password: 'longenough' }).success).toBe(false);
    expect(registerSchema.safeParse({ username: 'ab', password: 'longenough' }).success).toBe(false);
    expect(registerSchema.safeParse({ username: 'fine', password: 'short' }).success).toBe(false);
  });

  it('collapses spaces in display names', () => {
    expect(guestSchema.parse({ displayName: '  Big   Sam ' }).displayName).toBe('Big Sam');
    expect(guestSchema.safeParse({ displayName: ' x ' }).success).toBe(false);
  });
});

describe('team schemas', () => {
  it('normalises colour and monogram', () => {
    const parsed = createGameSchema.parse({ name: 'Friday   Draft', team });
    expect(parsed.name).toBe('Friday Draft');
    expect(parsed.team).toMatchObject({ color: '#22c36b', monogram: 'GU' });
    expect(parsed.settings).toEqual({});
  });

  it('accepts accented team names and rejects symbols', () => {
    expect(teamNameSchema.parse('Atlético  Rovers')).toBe('Atlético Rovers');
    expect(teamNameSchema.safeParse('Bad <b>').success).toBe(false);
    expect(teamNameSchema.safeParse('AB').success).toBe(false);
    expect(monogramSchema.safeParse('ABCD').success).toBe(false);
  });

  it('rejects unknown formations', () => {
    expect(teamPatchSchema.safeParse({ formation: '2-2-6' }).success).toBe(false);
    expect(teamPatchSchema.parse({ isReady: true })).toEqual({ isReady: true });
  });

  it('rejects settings out of type range', () => {
    expect(createGameSchema.safeParse({ name: 'Draft', team, settings: { maxTeams: 13 } }).success).toBe(false);
    expect(createGameSchema.safeParse({ name: 'Draft', team, settings: { extraPct: 2 } }).success).toBe(false);
  });
});

describe('other schemas', () => {
  it('uppercases join codes', () => {
    expect(joinCodeSchema.parse(' ab3dk9 ')).toBe('AB3DK9');
    expect(joinCodeSchema.safeParse('ABC').success).toBe(false);
  });

  it('limits chat to 280 characters', () => {
    expect(chatSchema.parse({ body: ' hi  there ' }).body).toBe('hi there');
    expect(chatSchema.safeParse({ body: '   ' }).success).toBe(false);
    expect(chatSchema.safeParse({ body: 'x'.repeat(281) }).success).toBe(false);
  });

  it('has 12 colours, 12 bot names and a join alphabet without look-alikes', () => {
    expect(TEAM_COLORS).toHaveLength(12);
    expect(new Set(BOT_TEAM_NAMES).size).toBe(12);
    for (const ch of 'IL01O') expect(JOIN_CODE_ALPHABET).not.toContain(ch);
    for (const name of BOT_TEAM_NAMES) expect(teamNameSchema.safeParse(name).success, name).toBe(true);
  });
});
