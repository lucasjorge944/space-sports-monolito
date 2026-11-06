'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { signOut } from '@/lib/auth/sign-out';

export function SignOutButton() {
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="outline"
      size="xl"
      disabled={pending}
      onClick={() => {
        setPending(true);
        void signOut();
      }}
    >
      {pending ? 'Saindo…' : 'Sair'}
    </Button>
  );
}
