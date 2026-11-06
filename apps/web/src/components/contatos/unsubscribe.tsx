'use client';

import { isApiError, useUnsubscribeContact } from '@space-sports/api-client';
import { Loader2 } from 'lucide-react';
import { AuthCard } from '@/components/auth/auth-card';
import { FormError } from '@/components/auth/form-alert';
import { Button } from '@/components/ui/button';
import { apiErrorMessage } from '@/lib/painel/errors';

/**
 * Descadastro público (RF-CONTACT-08). Pede um clique em vez de agir ao abrir: leitores de e-mail e
 * antivírus visitam os links sozinhos, e isso não pode descadastrar ninguém.
 */
export function Unsubscribe({ token }: { token: string }) {
  const unsubscribe = useUnsubscribeContact();

  if (unsubscribe.isSuccess) {
    return (
      <AuthCard
        title="Descadastro feito"
        description="Você não vai mais receber novidades e convites do Space Sports."
      >
        <p className="text-muted-foreground text-sm">Você já pode fechar esta página.</p>
      </AuthCard>
    );
  }

  if (isApiError(unsubscribe.error) && unsubscribe.error.code === 'UNSUBSCRIBE_TOKEN_INVALID') {
    return (
      <AuthCard
        title="Link inválido"
        description="Este link de descadastro não funcionou. Confira se copiou o link inteiro."
      >
        <p className="text-muted-foreground text-sm">
          Se precisar, abra de novo o link da mensagem que você recebeu.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Parar de receber novidades"
      description="Confirme para não receber mais novidades e convites do Space Sports."
    >
      <FormError message={unsubscribe.error ? apiErrorMessage(unsubscribe.error) : undefined} />
      <Button
        size="xl"
        disabled={unsubscribe.isPending}
        onClick={() => unsubscribe.mutate({ data: { token } })}
      >
        {unsubscribe.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        Confirmar descadastro
      </Button>
    </AuthCard>
  );
}
