'use client';

import { useRequestAccountDeletionPublic } from '@space-sports/api-client';
import Link from 'next/link';
import { useState } from 'react';
import { FormError, FormNotice } from '@/components/auth/form-alert';
import { FormField } from '@/components/auth/form-field';
import { SubmitButton } from '@/components/auth/submit-button';
import { Field } from '@/components/painel/field';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  DELETION_DEADLINE_DAYS,
  DELETION_REASON_MAX,
  deletionRequestErrorMessage,
  deletionRequestFromForm,
} from '@/lib/account-deletion';
import type { FieldErrors } from '@/lib/auth/validation';
import { focusFirstInvalid, textLink } from '@/lib/utils';

/**
 * Página pública de exclusão de conta (RF-AUTH-03, decisão 40; exigida pelo Google Play). Só serve
 * a quem entra com e-mail e senha: os demais pedem pelo app ou pelo atendimento.
 */
export function DeleteAccountRequest() {
  const request = useRequestAccountDeletionPublic();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<'email' | 'password' | 'reason'>>();
  const [sentTo, setSentTo] = useState<string>();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = deletionRequestFromForm({
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
      reason: String(form.get('reason') ?? ''),
    });
    request.reset();
    if (!result.ok) {
      setFieldErrors(result.errors);
      return focusFirstInvalid(event.currentTarget);
    }
    setFieldErrors(undefined);
    request.mutate({ data: result.data }, { onSuccess: () => setSentTo(result.data.email) });
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-12 sm:py-16">
      <header className="grid gap-2">
        <h1 className="font-display text-h3">Excluir minha conta</h1>
        <p className="text-muted-foreground">
          Peça aqui a exclusão da sua conta do Space Sports e dos seus dados pessoais.
        </p>
      </header>

      <section className="grid gap-3" aria-labelledby="o-que-acontece">
        <h2 id="o-que-acontece" className="text-lg font-semibold">
          O que acontece
        </h2>
        <ol className="grid list-decimal gap-2 pl-5 text-sm">
          <li>
            <strong>Sua conta é inativada na hora.</strong> Você deixa de conseguir entrar enquanto
            o pedido é analisado.
          </li>
          <li>
            <strong>
              A equipe do Space Sports confirma o pedido em até {DELETION_DEADLINE_DAYS} dias
            </strong>{' '}
            e avisa você por e-mail.
          </li>
          <li>
            Ao confirmar, as suas reservas futuras, mensalistas, assinaturas de aula e confirmações
            em aulas futuras são canceladas, e os seus dados pessoais são anonimizados. Os
            pagamentos já registrados continuam no histórico dos espaços, sem os seus dados
            pessoais.
          </li>
          <li>
            Se você é o único Dono de um espaço, a posse precisa passar para outra pessoa antes: o
            pedido não é registrado e o e-mail de resposta explica o motivo.
          </li>
          <li>
            Mudou de ideia? Fale com o atendimento do Space Sports antes da confirmação: o pedido é
            cancelado e a sua conta volta a ficar ativa.
          </li>
        </ol>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Pedir a exclusão</CardTitle>
          <p className="text-muted-foreground text-sm" data-testid="password-only-note">
            Este formulário vale para quem entra com <strong>e-mail e senha</strong>. Se você entra
            com Google, Apple ou telefone, a conta não tem senha: peça pelo app (Perfil → Excluir
            conta) ou pelo atendimento do Space Sports.
          </p>
        </CardHeader>
        <CardContent>
          {sentTo ? (
            <FormNotice>
              <p className="font-medium">Pedido enviado.</p>
              <p>
                Se o e-mail e a senha informados conferem, o seu pedido foi registrado e a conta foi
                inativada. Enviaremos o resultado para <strong>{sentTo}</strong>: o pedido recebido,
                com o prazo de até {DELETION_DEADLINE_DAYS} dias, ou o motivo de não ter sido
                registrado. Por segurança, esta página não informa se a conta existe.
              </p>
            </FormNotice>
          ) : (
            <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
              <FormError
                message={request.error ? deletionRequestErrorMessage(request.error) : undefined}
              />
              <FormField
                large
                name="email"
                label="E-mail da conta"
                type="email"
                autoComplete="email"
                inputMode="email"
                error={fieldErrors?.email}
              />
              <FormField
                large
                name="password"
                label="Senha"
                type="password"
                autoComplete="current-password"
                error={fieldErrors?.password}
              />
              <Field label="Motivo" optional htmlFor="reason" error={fieldErrors?.reason}>
                <Textarea id="reason" name="reason" maxLength={DELETION_REASON_MAX} />
              </Field>
              <SubmitButton
                size="xl"
                pending={request.isPending}
                pendingLabel="Enviando…"
                variant="destructive"
              >
                Pedir exclusão da conta
              </SubmitButton>
            </form>
          )}
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-sm">
        Só quer sair da conta por um tempo? Entre pelo app e use “Inativar conta” no Perfil.{' '}
        <Link href="/" className={textLink}>
          Voltar ao início
        </Link>
      </p>
    </div>
  );
}
