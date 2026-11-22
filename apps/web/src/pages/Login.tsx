import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { loginSchema, registerSchema } from '@deadline-day/protocol';
import { errorMessage } from '../lib/api';
import { useLogin, useMe, usePublicSettings, useRegister } from '../lib/auth';
import { Button, Card, ErrorText, Field, Input, Segmented } from '../components/ui';
import { SignInGate } from '../components/SignInGate';

type Tab = 'login' | 'register' | 'guest';

/** Only same-site paths, so a crafted ?next= cannot send people elsewhere. */
function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = safeNext(params.get('next'));
  const initial = (params.get('tab') as Tab | null) ?? 'login';
  const [tab, setTab] = useState<Tab>(['login', 'register', 'guest'].includes(initial) ? initial : 'login');
  const { data: me } = useMe();
  const { data: settings } = usePublicSettings();

  // A guest who opens "create an account" stays on the page to upgrade.
  useEffect(() => {
    if (me && !(me.isGuest && tab === 'register')) void navigate(next, { replace: true });
  }, [me, tab, next, navigate]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-10">
      <h1 className="mb-6 text-center font-display text-4xl font-bold uppercase tracking-tight">
        {tab === 'register' ? 'Create account' : tab === 'guest' ? 'Play as guest' : 'Log in'}
      </h1>
      <Card className="flex flex-col gap-5">
        <Segmented<Tab>
          label="Sign-in method"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'login', label: 'Log in' },
            { value: 'register', label: 'Sign up' },
            { value: 'guest', label: 'Guest' },
          ]}
        />
        {tab === 'login' && <LoginForm />}
        {tab === 'register' &&
          (settings && !settings.registrationsOpen ? (
            <p className="text-sm text-white/70">New accounts are closed right now. You can still play as a guest.</p>
          ) : (
            <RegisterForm upgrading={!!me?.isGuest} />
          ))}
        {tab === 'guest' && <SignInGate why="Guests can create, join and play games. Create an account later to keep your history." />}
      </Card>
    </main>
  );
}

function LoginForm() {
  const login = useLogin();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = loginSchema.safeParse({ username, password });
    if (parsed.success) login.mutate(parsed.data);
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Username">
        {(id) => <Input id={id} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" required />}
      </Field>
      <Field label="Password">
        {(id) => <Input id={id} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />}
      </Field>
      <ErrorText>{login.error ? errorMessage(login.error) : null}</ErrorText>
      <Button type="submit" size="lg" loading={login.isPending}>
        Log in
      </Button>
    </form>
  );
}

function RegisterForm({ upgrading }: { upgrading: boolean }) {
  const register = useRegister();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const input = { username, password, ...(displayName.trim() ? { displayName } : {}) };
  const parsed = registerSchema.safeParse(input);
  const fieldError = (field: string) =>
    submitted && !parsed.success ? (parsed.error.issues.find((i) => i.path[0] === field)?.message ?? null) : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (parsed.success) register.mutate(parsed.data);
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {upgrading && <p className="text-sm text-pitch-400">Your guest games move to the new account.</p>}
      <Field label="Username" hint="3 to 20 letters, digits or _" error={fieldError('username')}>
        {(id) => <Input id={id} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" />}
      </Field>
      <Field label="Display name (optional)" error={fieldError('displayName')}>
        {(id) => <Input id={id} value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="nickname" maxLength={24} />}
      </Field>
      <Field label="Password" hint="At least 8 characters" error={fieldError('password')}>
        {(id) => <Input id={id} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />}
      </Field>
      <ErrorText>{register.error ? errorMessage(register.error) : null}</ErrorText>
      <Button type="submit" size="lg" loading={register.isPending}>
        {upgrading ? 'Save my account' : 'Create account'}
      </Button>
    </form>
  );
}
