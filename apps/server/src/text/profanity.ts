/**
 * A small profanity filter for team names, display names, game names and chat.
 * Words are matched per token after lower-casing, stripping accents and undoing common
 * letter substitutions (0 -> o, 1 -> i, 3 -> e, 4 -> a, 5 -> s, 7 -> t, @ -> a, $ -> s),
 * with simple suffixes (s, es, er, ers, ing, ed, y). Spaced-out letters ("f u c k") are caught too.
 * The list is the admin-editable app setting `profanity_words`; these are the defaults.
 */
export const DEFAULT_PROFANITY_WORDS = [
  'fuck',
  'motherfucker',
  'shit',
  'cunt',
  'bitch',
  'bastard',
  'dick',
  'cock',
  'pussy',
  'twat',
  'wanker',
  'prick',
  'slut',
  'whore',
  'asshole',
  'arsehole',
  'bollocks',
  'porn',
  'rape',
  'rapist',
  'nazi',
  'hitler',
  'nigger',
  'nigga',
  'faggot',
  'fag',
  'retard',
  'spic',
  'chink',
  'kike',
  'tranny',
];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i' };
const SUFFIXES = ['', 's', 'es', 'er', 'ers', 'ing', 'ed', 'y'];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[013457@$!]/g, (c) => LEET[c] ?? c);
}

const lettersOnly = (s: string) => normalize(s).replace(/[^a-z]/g, '');

function matchesWord(token: string, words: readonly string[]): string | null {
  for (const w of words) {
    if (w && SUFFIXES.some((s) => token === w + s)) return w;
  }
  return null;
}

function prepare(words: readonly string[]): string[] {
  return words.map(lettersOnly).filter((w) => w.length >= 2);
}

/** Runs of letters, digits and leet symbols: the words of a message. */
const WORD_RUN = /[\p{L}\p{N}@$!]+/gu;
/** Leet symbols at the edges may just be punctuation ("shit!"), so also try without them. */
const EDGE_SYMBOLS = /^[@$!]+|[@$!]+$/g;

function runMatches(run: string, list: readonly string[]): 'whole' | 'core' | null {
  if (matchesWord(lettersOnly(run), list)) return 'whole';
  const core = run.replace(EDGE_SYMBOLS, '');
  if (core && core !== run && matchesWord(lettersOnly(core), list)) return 'core';
  return null;
}

/** The first listed word the text contains, or null. */
export function findProfanity(text: string, words: readonly string[]): string | null {
  const list = prepare(words);
  const runs = text.match(WORD_RUN) ?? [];
  for (const run of runs) {
    const hit = matchesWord(lettersOnly(run), list) ?? matchesWord(lettersOnly(run.replace(EDGE_SYMBOLS, '')), list);
    if (hit) return hit;
  }
  // Spaced-out words ("f u c k").
  return matchesWord(runs.map((r) => lettersOnly(r.replace(EDGE_SYMBOLS, ''))).join(''), list);
}

const maskWord = (w: string) => w[0] + '*'.repeat(Math.max(1, w.length - 1));

/** Replace listed words with their first letter and asterisks (for chat). */
export function maskProfanity(text: string, words: readonly string[]): string {
  const list = prepare(words);
  const masked = text.replace(WORD_RUN, (run) => {
    const hit = runMatches(run, list);
    if (hit === 'whole') return maskWord(run);
    if (hit === 'core') {
      const core = run.replace(EDGE_SYMBOLS, '');
      const at = run.indexOf(core);
      return run.slice(0, at) + maskWord(core) + run.slice(at + core.length);
    }
    return run;
  });
  return findProfanity(masked, words) ? '*'.repeat(Math.min(12, text.length)) : masked;
}
