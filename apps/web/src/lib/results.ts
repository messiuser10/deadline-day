/** Helpers for the Season Complete screen: labels, tones and the plain-text summary. */
import type { AuctionGradeView, PurchaseView, ResultsView } from '@deadline-day/protocol';
import { money } from './format';
import { ordinal, type SeasonIndex } from './season';

export type Grade = AuctionGradeView['grade'];
export type PurchaseTag = PurchaseView['tag'];

/** Grade colour helps; the letter always carries the meaning. */
export function gradeTone(g: Grade): 'green' | 'neutral' | 'gold' | 'red' {
  if (g.startsWith('A')) return 'green';
  if (g.startsWith('B')) return 'neutral';
  if (g.startsWith('C')) return 'gold';
  return 'red';
}

export const GRADE_TEXT: Record<'green' | 'neutral' | 'gold' | 'red', string> = {
  green: 'text-pitch-400',
  neutral: 'text-white',
  gold: 'text-gold-400',
  red: 'text-red-300',
};

export const TAG_LABEL: Record<PurchaseTag, string> = { steal: 'Steal', fair: 'Fair', overpay: 'Overpay' };
export const TAG_TONE: Record<PurchaseTag, 'green' | 'neutral' | 'red'> = { steal: 'green', fair: 'neutral', overpay: 'red' };

export const pctOf = (x: number) => `${Math.round(x * 100)}%`;

/** Share text: champion, every auction team's finish and grade, and the awards. */
export function summaryText(index: SeasonIndex, results: ResultsView, gameName: string, url: string): string {
  const team = (id: string) => index.teams.get(id);
  const final = index.view.standings.at(-1) ?? [];
  const champion = team(index.view.championId);
  const champRow = final.find((r) => r.teamId === index.view.championId);
  const lines = [`Deadline Day: ${gameName}, season ${results.number}`, `Champions: ${champion?.name ?? '?'}${champRow ? ` (${champRow.points} pts)` : ''}`, '', 'Auction teams'];
  for (const g of results.grades) {
    const t = team(g.teamId);
    const row = final.find((r) => r.teamId === g.teamId);
    lines.push(`${ordinal(g.finalPosition)} ${t?.name ?? '?'}${t?.managerName ? ` (${t.managerName})` : ''}, ${row?.points ?? 0} pts, grade ${g.grade}`);
  }
  const a = results.awards;
  const who = (p: { name: string; teamId: string } | null) => (p ? `${p.name} (${team(p.teamId)?.name ?? '?'})` : 'nobody');
  lines.push('', 'Awards');
  if (a.goldenBoot) lines.push(`Golden Boot: ${who(a.goldenBoot)}, ${a.goldenBoot.value} goals`);
  if (a.playmaker) lines.push(`Playmaker: ${who(a.playmaker)}, ${a.playmaker.value} assists`);
  if (a.goldenGlove) lines.push(`Golden Glove: ${who(a.goldenGlove)}, ${a.goldenGlove.value} clean sheets`);
  if (a.playerOfTheSeason) lines.push(`Player of the Season: ${who(a.playerOfTheSeason)}, ${a.playerOfTheSeason.value.toFixed(2)} average`);
  if (a.bestBuy) lines.push(`Best Buy: ${who(a.bestBuy)} for ${money(a.bestBuy.priceM)}`);
  if (a.biggestOverpay) lines.push(`Biggest Overpay: ${who(a.biggestOverpay)} for ${money(a.biggestOverpay.priceM)}`);
  lines.push('', url);
  return lines.join('\n');
}

/** Copy to the clipboard, falling back to a hidden textarea where the async API is missing. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const el = document.createElement('textarea');
      el.value = text;
      el.setAttribute('readonly', '');
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.append(el);
      el.select();
      const ok = document.execCommand('copy');
      el.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
