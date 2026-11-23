import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from './ui';
import { prefersReducedMotion } from '../lib/format';

export interface SwipeTab {
  id: string;
  label: string;
  badge?: ReactNode;
  content: ReactNode;
}

/**
 * Tabs whose panels sit side by side and can be swiped (scroll snap). The strip takes the height of the
 * panel on screen, so a short panel does not leave a long empty page under it.
 */
export function SwipeTabs({ tabs, label }: { tabs: SwipeTab[]; label: string }) {
  const strip = useRef<HTMLDivElement>(null);
  const panels = useRef<(HTMLElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const [height, setHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    const el = panels.current[active];
    if (!el) return;
    const measure = () => setHeight(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [active]);

  const go = (i: number) => {
    const el = strip.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    setActive(i);
  };

  return (
    <div>
      <div className="sticky top-14 z-20 -mx-3 bg-night-900/90 px-3 py-2 backdrop-blur sm:-mx-4 sm:px-4">
        <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto rounded-2xl bg-night-950/60 p-1 ring-1 ring-white/10 [scrollbar-width:none]">
          {tabs.map((t, i) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={i === active}
              aria-controls={`panel-${t.id}`}
              onClick={() => go(i)}
              className={cx(
                'flex min-h-10 flex-1 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-sm font-medium transition',
                i === active ? 'bg-pitch-500 text-ink' : 'text-white/70 hover:text-white',
              )}
            >
              {t.label}
              {t.badge}
            </button>
          ))}
        </div>
      </div>
      <div
        ref={strip}
        onScroll={(e) => {
          const el = e.currentTarget;
          const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
          if (i !== active && i >= 0 && i < tabs.length) setActive(i);
        }}
        style={{ height }}
        className="mt-1 flex snap-x snap-mandatory items-start overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((t, i) => (
          <section
            key={t.id}
            ref={(el) => {
              panels.current[i] = el;
            }}
            id={`panel-${t.id}`}
            role="tabpanel"
            aria-labelledby={`tab-${t.id}`}
            inert={i !== active}
            className="flex w-full shrink-0 snap-start snap-always flex-col gap-4"
          >
            {t.content}
          </section>
        ))}
      </div>
    </div>
  );
}
