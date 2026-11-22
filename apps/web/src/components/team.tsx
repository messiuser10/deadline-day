import { useState } from 'react';
import { FORMATIONS, type FormationId } from '@deadline-day/engine';
import { TEAM_COLORS, teamSchema, type TeamInput } from '@deadline-day/protocol';
import { cx, Field, Input } from './ui';
import { inkOn } from '../lib/format';

export function TeamBadge({ color, monogram, size = 'md' }: { color: string; monogram: string; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'size-8 text-[0.65rem]', md: 'size-10 text-xs', lg: 'size-14 text-base' };
  return (
    <span
      className={cx('grid shrink-0 place-items-center rounded-full font-display font-bold tracking-wide ring-2 ring-white/15', sizes[size])}
      style={{ backgroundColor: color, color: inkOn(color) }}
      aria-hidden="true"
    >
      {monogram}
    </span>
  );
}

/** A small pitch with the formation's 11 slots, drawn from the engine's coordinates. */
export function FormationPitch({ formation, className, color = '#3ddc84' }: { formation: FormationId; className?: string; color?: string }) {
  const slots = FORMATIONS[formation].slots;
  return (
    <svg viewBox="0 0 68 100" className={className} aria-hidden="true">
      <rect x="1" y="1" width="66" height="98" rx="4" fill="#0f3d25" stroke="#ffffff30" strokeWidth="1" />
      <line x1="1" y1="50" x2="67" y2="50" stroke="#ffffff25" strokeWidth="0.8" />
      <circle cx="34" cy="50" r="8" fill="none" stroke="#ffffff25" strokeWidth="0.8" />
      <rect x="18" y="83" width="32" height="16" fill="none" stroke="#ffffff25" strokeWidth="0.8" />
      {slots.map((s) => (
        <circle key={s.key} cx={4 + (s.x / 100) * 60} cy={4 + (s.y / 100) * 92} r="3.6" fill={color} stroke="#0a0f1e" strokeWidth="0.8" />
      ))}
    </svg>
  );
}

export function FormationPicker({
  value,
  onChange,
  enabled,
  locked,
}: {
  value: FormationId;
  onChange: (f: FormationId) => void;
  enabled: readonly FormationId[];
  locked?: FormationId | null;
}) {
  const options = locked ? [locked] : enabled;
  return (
    <div role="radiogroup" aria-label="Formation" className="grid grid-cols-3 gap-2 sm:grid-cols-5">
      {options.map((f) => (
        <button
          key={f}
          type="button"
          role="radio"
          aria-checked={value === f}
          onClick={() => onChange(f)}
          className={cx(
            'flex flex-col items-center gap-1 rounded-xl p-2 ring-1 ring-inset transition',
            value === f ? 'bg-pitch-500/15 ring-pitch-400' : 'bg-night-950/50 ring-white/10 hover:ring-white/30',
          )}
        >
          <FormationPitch formation={f} className="h-14 w-auto" />
          <span className="font-display text-sm font-semibold tracking-wide">{f}</span>
        </button>
      ))}
    </div>
  );
}

export function defaultMonogramFor(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .split(/\s+/)
    .filter((w) => w && w.toLowerCase() !== 'and');
  const letters = words.length >= 2 ? words.slice(0, 3).map((w) => w[0]) : [...(words[0] ?? 'FC').slice(0, 3)];
  return letters
    .join('')
    .normalize('NFD')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
    .slice(0, 3);
}

export interface TeamDraft {
  teamName: string;
  color: string;
  monogram: string;
  formation: FormationId;
}

export function randomTeamDraft(seedName: string, taken: string[] = []): TeamDraft {
  const color = TEAM_COLORS.find((c) => !taken.includes(c)) ?? TEAM_COLORS[0];
  const base = seedName.trim() ? `${seedName.trim().split(' ')[0]} FC` : 'Deadline FC';
  const teamName = base.length >= 3 ? base.slice(0, 24) : 'Deadline FC';
  return { teamName, color, monogram: defaultMonogramFor(teamName), formation: '4-3-3' };
}

/** Validates a draft with the shared schema; returns the first message per field. */
export function teamErrors(draft: TeamDraft): Partial<Record<keyof TeamInput, string>> {
  const res = teamSchema.safeParse(draft);
  if (res.success) return {};
  const out: Partial<Record<keyof TeamInput, string>> = {};
  for (const issue of res.error.issues) {
    const key = issue.path[0] as keyof TeamInput;
    out[key] ??= issue.message;
  }
  return out;
}

export function TeamEditor({
  draft,
  onChange,
  enabledFormations,
  lockedFormation,
  takenColors = [],
  showErrors,
}: {
  draft: TeamDraft;
  onChange: (d: TeamDraft) => void;
  enabledFormations: readonly FormationId[];
  lockedFormation?: FormationId | null;
  takenColors?: string[];
  showErrors?: boolean;
}) {
  const [monogramTouched, setMonogramTouched] = useState(false);
  const errors = showErrors ? teamErrors(draft) : {};
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end gap-3">
        <TeamBadge color={draft.color} monogram={draft.monogram || '?'} size="lg" />
        <div className="flex-1">
          <Field label="Team name" error={errors.teamName} hint="3 to 24 characters">
            {(id) => (
              <Input
                id={id}
                value={draft.teamName}
                maxLength={24}
                autoComplete="off"
                onChange={(e) => {
                  const teamName = e.target.value;
                  onChange({ ...draft, teamName, monogram: monogramTouched ? draft.monogram : defaultMonogramFor(teamName) });
                }}
              />
            )}
          </Field>
        </div>
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-white/80">Colour</span>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Team colour">
            {TEAM_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={draft.color === c}
                aria-label={`Colour ${c}${takenColors.includes(c) ? ' (used by another team)' : ''}`}
                onClick={() => onChange({ ...draft, color: c })}
                className={cx(
                  'size-9 rounded-full ring-2 transition',
                  draft.color === c ? 'ring-white' : 'ring-transparent hover:ring-white/40',
                  takenColors.includes(c) && draft.color !== c && 'opacity-40',
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
        <div className="w-20">
          <Field label="Badge" error={errors.monogram}>
            {(id) => (
              <Input
                id={id}
                value={draft.monogram}
                maxLength={3}
                className="text-center font-display uppercase tracking-widest"
                onChange={(e) => {
                  setMonogramTouched(true);
                  onChange({ ...draft, monogram: e.target.value.toUpperCase() });
                }}
              />
            )}
          </Field>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-white/80">
          Formation{lockedFormation ? <span className="text-white/50"> (set by the host)</span> : null}
        </span>
        <FormationPicker
          value={lockedFormation ?? draft.formation}
          onChange={(formation) => onChange({ ...draft, formation })}
          enabled={enabledFormations}
          locked={lockedFormation}
        />
      </div>
    </div>
  );
}
