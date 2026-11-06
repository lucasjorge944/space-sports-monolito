'use client';

import { type SuperSpace, useSuperInviteOwner } from '@space-sports/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { FormError, FormNotice } from '@/components/auth/form-alert';
import { FormField } from '@/components/auth/form-field';
import { SubmitButton } from '@/components/auth/submit-button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { normalizeEmail, validateEmail } from '@/lib/auth/validation';
import { invalidateSuper } from '@/lib/super/invalidate';
import { ownerInviteMessage } from '@/lib/super/labels';
import { describeError } from '../query-states';

export function OwnerInviteCard({ space }: { space: SuperSpace }) {
  const queryClient = useQueryClient();
  const invite = useSuperInviteOwner();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<string>();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(undefined);
    const invalid = validateEmail(email);
    setError(invalid);
    if (invalid) return;
    try {
      const response = await invite.mutateAsync({
        spaceId: space.id,
        data: { email: normalizeEmail(email) },
      });
      setResult(ownerInviteMessage[response.status]);
      if (response.status === 'LINKED' || response.status === 'INVITED') setEmail('');
      await invalidateSuper(queryClient);
    } catch (thrown) {
      setError(describeError(thrown));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dono</CardTitle>
        <CardDescription>Quem administra o espaço e a equipe dele.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {space.owners.length > 0 ? (
          <ul className="grid gap-1 text-sm">
            {space.owners.map((owner) => (
              <li key={owner.id}>
                <span className="font-medium">{owner.name}</span>{' '}
                <span className="text-muted-foreground">{owner.email}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">Este espaço ainda não tem Dono.</p>
        )}
        <form onSubmit={onSubmit} noValidate className="grid gap-3">
          <FormField
            name="owner-email"
            label="Convidar Dono por e-mail"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="off"
          />
          <FormError message={error} />
          {result ? <FormNotice>{result}</FormNotice> : null}
          <SubmitButton pending={invite.isPending} pendingLabel="Enviando…" className="w-fit">
            Convidar
          </SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
