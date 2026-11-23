import { useEffect, useState } from 'react';
import { Button, Card, CardTitle, Field, Skeleton } from '../../components/ui';
import { AdminHeader, Textarea } from './parts';
import { useAdminSettings, useSaveSetting } from './Settings';

const MAX = 200;

/** Site-wide banner (maintenance_banner): shown above the header on every page. */
export function AnnouncementsTab() {
  const q = useAdminSettings();
  const save = useSaveSetting('Banner');
  const current = q.data?.settings.maintenance_banner.message ?? null;
  const [text, setText] = useState('');
  useEffect(() => setText(current ?? ''), [current]);
  if (q.isPending) return <Skeleton className="h-60" />;
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return (
    <>
      <AdminHeader title="Announcements" description="A banner shown above the header on every page, e.g. planned maintenance. Everyone sees it within a few minutes." />
      <Card className="max-w-2xl">
        <CardTitle>Site banner</CardTitle>
        <p className="mb-2 text-xs uppercase tracking-wide text-white/45">Now showing</p>
        {current ? (
          <div className="mb-4 rounded-xl bg-gold-400 px-4 py-2 text-center text-sm font-semibold text-ink">{current}</div>
        ) : (
          <p className="mb-4 rounded-xl bg-night-950/40 px-4 py-3 text-sm text-white/50">No banner.</p>
        )}
        <Field label="Message" hint={`${trimmed.length} of ${MAX} characters`}>
          {(id) => <Textarea id={id} rows={3} maxLength={MAX} value={text} onChange={(e) => setText(e.target.value)} placeholder="Maintenance tonight at 22:00 UTC: games in progress are saved." className="!font-sans !text-sm" />}
        </Field>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => save.mutate({ key: 'maintenance_banner', value: { message: trimmed } })} loading={save.isPending} disabled={!trimmed || trimmed === current}>
            {current ? 'Update banner' : 'Show banner'}
          </Button>
          {current && (
            <Button variant="secondary" onClick={() => save.mutate({ key: 'maintenance_banner', value: { message: null } })} loading={save.isPending}>
              Clear banner
            </Button>
          )}
        </div>
      </Card>
    </>
  );
}
