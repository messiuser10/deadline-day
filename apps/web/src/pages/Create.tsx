import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { FORMATION_IDS } from '@deadline-day/engine';
import { gameNameSchema, type GameSettings } from '@deadline-day/protocol';
import { errorMessage, post } from '../lib/api';
import { useMe, usePublicSettings } from '../lib/auth';
import { Button, Card, CardTitle, ErrorText, Field, Input, Skeleton } from '../components/ui';
import { SettingsForm } from '../components/SettingsForm';
import { SignInGate } from '../components/SignInGate';
import { randomTeamDraft, TeamEditor, teamErrors, type TeamDraft } from '../components/team';

export function CreatePage() {
  const { data: me, isLoading: meLoading } = useMe();
  const { data: pub } = usePublicSettings();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [settings, setSettings] = useState<GameSettings | null>(null);
  const [team, setTeam] = useState<TeamDraft | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (pub && !settings) setSettings(pub.gameDefaults);
  }, [pub, settings]);
  useEffect(() => {
    if (me && !team) {
      setTeam(randomTeamDraft(me.displayName));
      setName((n) => n || `${me.displayName}'s game`.slice(0, 40));
    }
  }, [me, team]);

  const create = useMutation({
    mutationFn: async () => (await post<{ code: string }>('/api/games', { name, settings, team })).code,
    onSuccess: (code) => void navigate(`/lobby/${code}`),
  });

  if (meLoading) return <PageSkeleton />;
  if (!me) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-10">
        <h1 className="mb-6 text-center font-display text-4xl font-bold uppercase">Create game</h1>
        <Card>
          <SignInGate why="Pick a name to host a game. Your friends join with a code." />
        </Card>
      </main>
    );
  }
  if (!pub || !settings || !team) return <PageSkeleton />;

  const nameCheck = gameNameSchema.safeParse(name);
  const nameError = submitted && !nameCheck.success ? (nameCheck.error.issues[0]?.message ?? null) : null;
  const enabled = FORMATION_IDS.filter((f) => pub.formationsEnabled.includes(f));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!nameCheck.success || Object.keys(teamErrors(team)).length) return;
    create.mutate();
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-32 pt-6 lg:pb-12">
      <h1 className="mb-5 font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">Create game</h1>
      <form onSubmit={submit} className="grid items-start gap-4 lg:grid-cols-[1fr_1.2fr]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardTitle>Game</CardTitle>
            <Field label="Game name" error={nameError}>
              {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />}
            </Field>
          </Card>
          <Card>
            <CardTitle>Your team</CardTitle>
            <TeamEditor
              draft={team}
              onChange={setTeam}
              enabledFormations={enabled}
              lockedFormation={settings.formationRule === 'forced' ? settings.forcedFormation : null}
              showErrors={submitted}
            />
          </Card>
        </div>
        <Card>
          <CardTitle>Rules</CardTitle>
          <SettingsForm
            value={settings}
            onChange={setSettings}
            limits={pub.gameLimits}
            formationsEnabled={pub.formationsEnabled}
            publicLobbiesEnabled={pub.publicLobbiesEnabled}
          />
        </Card>
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-night-900/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur lg:static lg:col-span-2 lg:border-0 lg:bg-transparent lg:p-0">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 lg:items-end">
            <ErrorText>{create.error ? errorMessage(create.error) : null}</ErrorText>
            <Button type="submit" size="lg" className="w-full lg:w-auto lg:min-w-60" loading={create.isPending}>
              Create lobby
            </Button>
          </div>
        </div>
      </form>
    </main>
  );
}

function PageSkeleton() {
  return (
    <main className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-6 lg:grid-cols-2">
      <Skeleton className="h-64" />
      <Skeleton className="h-96" />
    </main>
  );
}
