import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { HOW_TO_PLAY } from '../lib/howToPlay';
import { setPref, usePrefs } from '../lib/prefs';
import { Button, cx, Modal } from './ui';

/** Pages where a pop-up would get in the way (a live auction, a season, the admin panel, signing in). */
const QUIET = /^\/(auction|season|reveal|results|admin|login)(\/|$)/;

/** The short How to Play walkthrough: opens by itself on a first visit, and from the How to Play page. */
export function Walkthrough({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const last = step === HOW_TO_PLAY.length - 1;
  const s = HOW_TO_PLAY[step]!;
  const close = () => {
    setPref('walkthroughSeen', true);
    onClose();
    setStep(0);
  };
  return (
    <Modal open={open} onClose={close} title="How to play">
      <div className="flex flex-col gap-5" aria-live="polite">
        <div className="flex items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-pitch-500 font-display text-2xl font-bold text-ink" aria-hidden="true">
            {step + 1}
          </span>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.2em] text-white/50">
              Step {step + 1} of {HOW_TO_PLAY.length}
            </p>
            <h3 className="font-display text-2xl font-semibold uppercase tracking-wide">{s.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-white/75">{s.body}</p>
          </div>
        </div>
        <div className="flex justify-center gap-1.5" aria-hidden="true">
          {HOW_TO_PLAY.map((x, i) => (
            <span key={x.title} className={cx('h-1.5 rounded-full transition-all', i === step ? 'w-6 bg-pitch-400' : 'w-1.5 bg-white/20')} />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={close}>
            Skip
          </Button>
          <div className="ml-auto flex gap-2">
            {step > 0 && (
              <Button variant="secondary" onClick={() => setStep(step - 1)}>
                Back
              </Button>
            )}
            <Button onClick={() => (last ? close() : setStep(step + 1))} autoFocus>
              {last ? 'Let’s play' : 'Next'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** Shows the walkthrough once per device, on the first visit to a page where it does not interrupt play. */
export function FirstVisitWalkthrough() {
  const seen = usePrefs((p) => p.walkthroughSeen);
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!seen && !QUIET.test(pathname)) setOpen(true);
  }, [seen, pathname]);
  return <Walkthrough open={open && !seen} onClose={() => setOpen(false)} />;
}
