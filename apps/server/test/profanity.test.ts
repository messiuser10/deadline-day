import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFANITY_WORDS, findProfanity, maskProfanity } from '../src/text/profanity';

const words = DEFAULT_PROFANITY_WORDS;

describe('profanity filter', () => {
  it('catches plain, plural, leetspeak, accented and spaced-out words', () => {
    for (const text of ['shit', 'Shits FC', 'sh1t', '$hit', 'shit!', 'ſhit'.normalize('NFKC'), 'f u c k', 'Fúck']) {
      expect(findProfanity(text, words), text).not.toBeNull();
    }
  });

  it('does not flag clean football names (no Scunthorpe problem)', () => {
    for (const text of ['Scunthorpe United', 'Arsenal', 'Essex Rovers', 'Cockburn Town', 'Shiitake Mushrooms XI', 'Goal!!! 3-0', 'Assist Kings']) {
      expect(findProfanity(text, words), text).toBeNull();
    }
  });

  it('masks all but the first letter and leaves the rest of the message alone', () => {
    expect(maskProfanity('well shit, nice goal', words)).toBe('well s***, nice goal');
    expect(maskProfanity('shit!! what a goal', words)).toBe('s***!! what a goal');
    expect(maskProfanity('nice goal!', words)).toBe('nice goal!');
    expect(maskProfanity('f u c k', words)).toBe('*******');
  });

  it('uses the admin word list', () => {
    expect(findProfanity('Banana Boys', ['banana'])).toBe('banana');
    expect(findProfanity('Banana Boys', words)).toBeNull();
  });
});
