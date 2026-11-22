/** Text helpers: CSV parsing and name normalization. Pure, no I/O. */

/**
 * Minimal RFC 4180 CSV parser: quoted fields, escaped quotes, CRLF or LF, leading BOM.
 * Returns rows of raw string cells.
 */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (inQuotes) throw new Error('CSV ends inside a quoted field');
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/** Parse CSV with a header row into objects keyed by header name. */
export function parseCsvRecords(text: string): Record<string, string>[] {
  const [header, ...body] = parseCsv(text);
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return body.map((cells, index) => {
    if (cells.length !== keys.length) {
      throw new Error(`CSV row ${index + 2} has ${cells.length} cells, expected ${keys.length}`);
    }
    return Object.fromEntries(keys.map((k, i) => [k, cells[i] ?? '']));
  });
}

function csvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: readonly string[], rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

/** Lowercase, accents and punctuation stripped, single spaces. "Vini Jr." -> "vini jr". */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ø/gi, 'o')
    .replace(/æ/gi, 'ae')
    .replace(/ß/g, 'ss')
    .replace(/ł/gi, 'l')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Default monogram for a shield: initials of up to three words, skipping "and".
 * "Brighton and Hove Albion" -> "BHA", "Al-Nassr" -> "AN".
 */
export function defaultMonogram(name: string): string {
  const words = normalizeName(name)
    .split(' ')
    .filter((w) => w && w !== 'and');
  return words
    .slice(0, 3)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

/** URL-safe slug from a name: "Atlético Madrid" -> "atletico-madrid". */
export function slugify(name: string): string {
  return normalizeName(name).replace(/ /g, '-');
}
