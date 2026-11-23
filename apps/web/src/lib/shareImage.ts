/** The season card behind "Download Image": a 1080 x 1350 PNG drawn on a canvas, no libraries. */
import { inkOn } from './format';
import { ordinal } from './season';

export interface CardTeam {
  name: string;
  color: string;
  monogram: string;
}

export interface SeasonCardInput {
  gameName: string;
  season: number;
  champion: CardTeam & { points: number };
  myTeam?: CardTeam & { position: number; points: number; grade: string };
  table: (CardTeam & { position: number; points: number; auction: boolean })[];
  awards: { label: string; value: string }[];
}

const W = 1080;
const H = 1350;
const NAVY = '#0a0f1e';
const CARD = '#111933';
const GREEN = '#3ddc84';
const GOLD = '#f5c542';
const DISPLAY = '"Oswald Variable", Oswald, "Arial Narrow", sans-serif';
const SANS = '"Inter Variable", Inter, system-ui, sans-serif';

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

/** Draw text no wider than maxWidth: shrink down to minSize, then cut with an ellipsis. */
function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, weight: number, size: number, family: string, minSize = size * 0.6) {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (ctx.measureText(text).width > maxWidth && s > minSize) {
    s -= 2;
    ctx.font = `${weight} ${s}px ${family}`;
  }
  let out = text;
  while (ctx.measureText(out).width > maxWidth && out.length > 1) out = out.slice(0, -2) + '…';
  ctx.fillText(out, x, y);
}

function badge(ctx: CanvasRenderingContext2D, team: CardTeam, cx: number, cy: number, r: number) {
  ctx.fillStyle = team.color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = inkOn(team.color);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitText(ctx, team.monogram, cx, cy + 1, r * 1.5, 700, r * 0.8, DISPLAY);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

export async function seasonCardBlob(input: SeasonCardInput): Promise<Blob> {
  try {
    await Promise.all([document.fonts.load(`700 80px ${DISPLAY}`), document.fonts.load(`500 32px ${SANS}`)]);
  } catch {
    // Fall back to system fonts.
  }
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // Background with mowing stripes.
  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 180) {
    ctx.fillStyle = 'rgba(255,255,255,0.025)';
    ctx.fillRect(0, y, W, 90);
  }

  // Brand and title.
  ctx.fillStyle = '#22c36b';
  roundRect(ctx, 64, 60, 64, 64, 14);
  ctx.fillStyle = NAVY;
  ctx.font = `700 30px ${DISPLAY}`;
  ctx.textAlign = 'center';
  ctx.fillText('DD', 96, 104);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 46px ${DISPLAY}`;
  ctx.fillText('DEADLINE DAY', 148, 108);
  ctx.fillStyle = GREEN;
  ctx.font = `600 28px ${DISPLAY}`;
  ctx.fillText(`SEASON ${input.season} COMPLETE`, 64, 182);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  fitText(ctx, input.gameName, 64, 226, W - 128, 500, 34, SANS);

  // Champions.
  ctx.fillStyle = GOLD;
  roundRect(ctx, 64, 258, W - 128, 196, 28);
  ctx.fillStyle = NAVY;
  ctx.font = `600 28px ${DISPLAY}`;
  ctx.fillText('CHAMPIONS', 104, 312);
  fitText(ctx, input.champion.name.toUpperCase(), 104, 392, W - 360, 700, 76, DISPLAY);
  ctx.font = `600 30px ${SANS}`;
  ctx.fillText(`${input.champion.points} points`, 104, 432);
  badge(ctx, input.champion, W - 160, 356, 64);

  // The viewer's team.
  let y = 486;
  if (input.myTeam) {
    const t = input.myTeam;
    ctx.fillStyle = CARD;
    roundRect(ctx, 64, y, W - 128, 150, 24);
    badge(ctx, t, 140, y + 75, 44);
    ctx.fillStyle = '#ffffff';
    fitText(ctx, t.name, 206, y + 66, W - 480, 700, 44, DISPLAY);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = `500 28px ${SANS}`;
    ctx.fillText(`Finished ${ordinal(t.position)} with ${t.points} points`, 206, y + 110);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = `600 22px ${DISPLAY}`;
    ctx.textAlign = 'right';
    ctx.fillText('AUCTION GRADE', W - 104, y + 48);
    ctx.fillStyle = t.grade.startsWith('A') ? GREEN : t.grade.startsWith('D') || t.grade === 'F' ? '#fca5a5' : '#ffffff';
    ctx.font = `700 76px ${DISPLAY}`;
    ctx.fillText(t.grade, W - 104, y + 124);
    ctx.textAlign = 'left';
    y += 182;
  }

  // Final table (top rows).
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = `600 24px ${DISPLAY}`;
  ctx.fillText('FINAL TABLE', 64, y + 20);
  y += 44;
  const rows = input.table.slice(0, input.myTeam ? 6 : 8);
  for (const r of rows) {
    if (r.auction) {
      ctx.fillStyle = 'rgba(245,197,66,0.10)';
      roundRect(ctx, 64, y, W - 128, 50, 12);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = `600 26px ${DISPLAY}`;
    ctx.textAlign = 'right';
    ctx.fillText(String(r.position), 116, y + 35);
    ctx.textAlign = 'left';
    badge(ctx, r, 160, y + 25, 18);
    ctx.fillStyle = '#ffffff';
    fitText(ctx, r.name, 194, y + 35, W - 420, r.auction ? 700 : 500, 28, SANS);
    ctx.font = `700 30px ${DISPLAY}`;
    ctx.textAlign = 'right';
    ctx.fillText(String(r.points), W - 96, y + 36);
    ctx.textAlign = 'left';
    y += 56;
  }

  // Awards.
  y += 20;
  for (const a of input.awards.slice(0, 3)) {
    ctx.fillStyle = GOLD;
    ctx.font = `600 24px ${DISPLAY}`;
    ctx.fillText(a.label.toUpperCase(), 64, y + 26);
    ctx.fillStyle = '#ffffff';
    fitText(ctx, a.value, 360, y + 26, W - 424, 500, 28, SANS);
    y += 46;
  }

  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = `400 20px ${SANS}`;
  ctx.fillText('Deadline Day is an unofficial fan game, not affiliated with any club, league or player.', 64, H - 40);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not draw the image'))), 'image/png'));
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
