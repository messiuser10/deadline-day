import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router';
import { displayNameSchema } from '@deadline-day/protocol';
import { errorMessage } from '../lib/api';
import { useGuest } from '../lib/auth';
import { Button, ErrorText, Field, Input } from './ui';

/** Shown where a user is needed: one field to play as a guest, or a link to log in. */
export function SignInGate({ why }: { why: string }) {
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const guest = useGuest();
  const location = useLocation();
  const parsed = displayNameSchema.safeParse(name);
  const fieldError = touched && !parsed.success ? (parsed.error.issues[0]?.message ?? 'Check your name') : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (parsed.success) guest.mutate({ displayName: parsed.data });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <p className="text-sm text-white/70">{why}</p>
      <Field label="Your name" error={fieldError} hint="Shown to the other managers">
        {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={24} autoComplete="nickname" placeholder="e.g. Big Sam" />}
      </Field>
      <ErrorText>{guest.error ? errorMessage(guest.error) : null}</ErrorText>
      <Button type="submit" loading={guest.isPending}>
        Play as guest
      </Button>
      <p className="text-center text-sm text-white/60">
        Have an account?{' '}
        <Link className="font-semibold text-pitch-400 hover:underline" to={`/login?next=${encodeURIComponent(location.pathname)}`}>
          Log in
        </Link>
      </p>
    </form>
  );
}
