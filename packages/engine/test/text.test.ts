import { describe, expect, it } from 'vitest';
import { normalizeName, parseCsv, parseCsvRecords, slugify, toCsv } from '../src';

describe('csv', () => {
  it('handles a BOM, quotes, escaped quotes and CRLF', () => {
    const text = '﻿a,b,c\r\n1,"x, y","say ""hi"""\r\n2,,z\n';
    expect(parseCsv(text)).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x, y', 'say "hi"'],
      ['2', '', 'z'],
    ]);
    expect(parseCsvRecords(text)[1]).toEqual({ a: '2', b: '', c: 'z' });
  });

  it('round-trips through toCsv', () => {
    const rows = [['Vini Jr.', 'ST|RW', 'a "quote"', 3]] as const;
    const out = toCsv(['name', 'alts', 'note', 'n'], rows);
    expect(parseCsvRecords(out)).toEqual([{ name: 'Vini Jr.', alts: 'ST|RW', note: 'a "quote"', n: '3' }]);
  });

  it('rejects rows with the wrong number of cells', () => {
    expect(() => parseCsvRecords('a,b\n1\n')).toThrow(/row 2/);
  });
});

describe('names', () => {
  it('normalizes accents, case and punctuation', () => {
    expect(normalizeName('Kylian Mbappé')).toBe('kylian mbappe');
    expect(normalizeName('Vini Jr.')).toBe('vini jr');
    expect(normalizeName("N'Golo  Kanté")).toBe('n golo kante');
    expect(normalizeName('Martin Ødegaard')).toBe('martin odegaard');
    expect(slugify('Atlético Madrid')).toBe('atletico-madrid');
  });
});
