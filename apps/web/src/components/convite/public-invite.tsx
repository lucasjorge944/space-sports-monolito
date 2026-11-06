'use client';

import {
  getGetPublicInviteQueryKey,
  isApiError,
  type PublicInvitePreview,
  useAcceptInvite,
  useConfirmPublicInvite,
  useDeclineInvite,
  useDeclinePublicInvite,
  useGetInvite,
  useGetMe,
  useGetPublicInvite,
} from '@space-sports/api-client';
import { normalizePhone } from '@space-sports/shared';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Loader2, MapPin, UserRound, Wallet } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { AuthCard } from '@/components/auth/auth-card';
import { FormError } from '@/components/auth/form-alert';
import { ConfirmDialog } from '@/components/painel/confirm-dialog';
import { Field } from '@/components/painel/field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MaskedInput } from '@/components/ui/masked-input';
import { Skeleton } from '@/components/ui/skeleton';
import { signOut } from '@/lib/auth/sign-out';
import { normalizeEmail, validateEmail, validateName } from '@/lib/auth/validation';
import { formatMoney } from '@/lib/format';
import { apiErrorMessage } from '@/lib/painel/errors';
import {
  formatInviteWhen,
  inviteAppLink,
  isSlotTakenError,
  publicInviteView,
  signInWithInvitePath,
  signUpWithInvitePath,
} from '@/lib/public-invite';
import { focusFirstInvalid } from '@/lib/utils';

type Fresh = 'confirmed' | 'declined' | null;

/** Convite por link (RF-CONTACT-02/03): responde sem conta, ou com a conta se houver sessão. */
export function PublicInvite({ token, autoAccept }: { token: string; autoAccept: boolean }) {
  const queryClient = useQueryClient();
  const preview = useGetPublicInvite(token, { query: { retry: false } });
  // Sem redirecionar para o login: aqui a resposta não depende de conta.
  const me = useGetMe({ query: { retry: false } });
  const loggedIn = me.isSuccess;
  // A prévia pública não diz de quem é a vaga; com sessão, a API diz se é da pessoa.
  const mine = useGetInvite(token, { query: { enabled: loggedIn, retry: false } });

  // Resposta dada agora nesta tela: muda o texto em relação a quem só reabriu o link.
  const [fresh, setFresh] = useState<Fresh>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  const store = (data: PublicInvitePreview) =>
    queryClient.setQueryData(getGetPublicInviteQueryKey(token), data);
  // A vaga pode ter mudado enquanto a página estava aberta: a prévia nova mostra a situação.
  const refetchOnConflict = (error: unknown) => {
    if (!isApiError(error) || error.status !== 409) return;
    void preview.refetch();
    if (loggedIn) void mine.refetch();
  };

  const confirm = useConfirmPublicInvite({
    mutation: {
      onSuccess: (data) => {
        store(data);
        setFresh('confirmed');
      },
      onError: refetchOnConflict,
    },
  });
  const accept = useAcceptInvite({
    mutation: {
      onSuccess: () => {
        setFresh('confirmed');
        void preview.refetch();
      },
      onError: refetchOnConflict,
    },
  });
  const afterDecline = {
    onSuccess: () => {
      setFresh('declined');
      setDeclineOpen(false);
      void preview.refetch();
    },
    onError: (error: unknown) => {
      if (isApiError(error) && error.status === 409) setDeclineOpen(false);
      refetchOnConflict(error);
    },
  };
  const declinePublic = useDeclinePublicInvite({ mutation: afterDecline });
  const declineAccount = useDeclineInvite({ mutation: afterDecline });
  const decline = loggedIn ? declineAccount : declinePublic;

  const view = preview.data ? publicInviteView(preview.data) : null;
  const acceptedByMe = accept.isSuccess || mine.data?.acceptedByMe === true;
  // Com sessão, a API compara a conta com o convite: dá para avisar antes de qualquer clique.
  const slotTaken =
    mine.data?.slotTaken === true ||
    isSlotTakenError(confirm.error) ||
    isSlotTakenError(accept.error);
  const anotherAccount = mine.data?.forAnotherAccount === true;
  const canAccept =
    !slotTaken &&
    !anotherAccount &&
    (view === 'open' || view === 'account-only' || view === 'answered');

  // Voltou do cadastro ou do login com o token: aceita sem pedir outro clique (RF-CONTACT-03).
  const autoAccepted = useRef(false);
  const accepting = accept.mutate;
  useEffect(() => {
    if (!autoAccept || autoAccepted.current || !loggedIn || !canAccept) return;
    if (mine.isPending || acceptedByMe) return;
    autoAccepted.current = true;
    accepting({ token });
  }, [autoAccept, loggedIn, canAccept, mine.isPending, acceptedByMe, accepting, token]);

  if (preview.isPending) {
    return (
      <AuthCard title="Convite para jogar">
        <div role="status" aria-label="Carregando convite" className="flex flex-col gap-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </AuthCard>
    );
  }

  if (preview.isError) {
    const missing = isApiError(preview.error) && preview.error.code === 'INVITE_NOT_FOUND';
    return (
      <AuthCard
        title="Convite indisponível"
        description={
          missing
            ? 'Este link não existe mais. Peça um novo ao organizador da reserva.'
            : apiErrorMessage(preview.error)
        }
      >
        {missing ? null : (
          <Button size="xl" onClick={() => void preview.refetch()}>
            Tentar novamente
          </Button>
        )}
      </AuthCard>
    );
  }

  const invite = preview.data;
  const { booking } = invite;
  const organizer = booking.organizerFirstName;
  const accountOffer = <AccountOffer token={token} loggedIn={loggedIn} checking={me.isPending} />;

  if (view === 'cancelled') {
    return (
      <InviteCard title="Reserva cancelada" invite={invite}>
        <Note>Esta reserva foi cancelada. Fale com {organizer} se tiver dúvidas.</Note>
      </InviteCard>
    );
  }

  if (view === 'expired') {
    return (
      <InviteCard title="Convite expirado" invite={invite}>
        <Note>Esta reserva já terminou, e o convite não vale mais.</Note>
      </InviteCard>
    );
  }

  if (acceptedByMe) {
    return (
      <InviteCard title="Presença confirmada" invite={invite}>
        <Note>A reserva está na sua conta. {organizer} foi avisado.</Note>
        <Button asChild size="xl">
          <a href={inviteAppLink(token)}>Abrir no app</a>
        </Button>
      </InviteCard>
    );
  }

  if (view === 'taken' || slotTaken) {
    return (
      <InviteCard title="Vaga ocupada" invite={invite}>
        <Note>Esta vaga já foi preenchida. Peça outro link a {organizer}.</Note>
        {loggedIn && view === 'answered' ? (
          <Note>
            Se a presença é sua, use a conta com o e-mail ou o telefone que você informou.
          </Note>
        ) : null}
      </InviteCard>
    );
  }

  if (view === 'declined') {
    return (
      <InviteCard
        title={fresh === 'declined' ? 'Resposta enviada' : 'Convite já respondido'}
        invite={invite}
      >
        <Note>
          {fresh === 'declined'
            ? `Avisamos ${organizer} que você não vai.`
            : 'A resposta deste convite foi "Não vou". Se mudou de ideia, fale com o organizador.'}
        </Note>
      </InviteCard>
    );
  }

  if (view === 'answered') {
    return (
      <InviteCard
        title={fresh === 'confirmed' ? 'Presença confirmada' : 'Convite já respondido'}
        invite={invite}
      >
        <Note>
          {fresh === 'confirmed'
            ? `Avisamos ${organizer} que você vai. Com uma conta no mesmo e-mail ou telefone, a reserva fica com você.`
            : `A presença deste convite já foi confirmada. Se não foi você, peça outro link a ${organizer}.`}
        </Note>
        {accept.error ? <FormError message={apiErrorMessage(accept.error)} /> : null}
        {loggedIn && mine.isPending ? (
          <Skeleton className="h-11 w-full" />
        ) : loggedIn ? (
          <Button size="xl" disabled={accept.isPending} onClick={() => accept.mutate({ token })}>
            {accept.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Trazer para minha conta
          </Button>
        ) : (
          accountOffer
        )}
      </InviteCard>
    );
  }

  const onlyAccount = view === 'account-only';

  if (formOpen && !loggedIn && !onlyAccount) {
    return (
      <InviteCard title="Confirmar presença" invite={invite}>
        <ConfirmForm
          pending={confirm.isPending}
          error={confirm.error}
          onBack={() => setFormOpen(false)}
          onSubmit={(data) => confirm.mutate({ token, data })}
        />
      </InviteCard>
    );
  }

  const actionError = accept.error ?? decline.error;

  return (
    <InviteCard
      title="Convite para jogar"
      description={`${organizer} convidou você para esta reserva.`}
      invite={invite}
    >
      {actionError ? <FormError message={apiErrorMessage(actionError)} /> : null}
      {me.isPending || (loggedIn && mine.isPending) ? (
        <Skeleton className="h-11 w-full" />
      ) : anotherAccount ? (
        <>
          <Alert variant="warning" role="status">
            Este convite é para outra conta do Space Sports. Para responder, troque para a conta
            convidada.
          </Alert>
          <Button
            size="xl"
            disabled={switching}
            onClick={() => {
              setSwitching(true);
              // Sai antes de ir ao login: com a sessão aberta, o `proxy.ts` tira a pessoa de lá.
              void signOut(signInWithInvitePath(token));
            }}
          >
            {switching ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Trocar de conta
          </Button>
        </>
      ) : onlyAccount && !loggedIn ? (
        <>
          <Note>Este convite é para uma conta do Space Sports. Entre para responder.</Note>
          <Button asChild size="xl">
            <Link href={signInWithInvitePath(token)}>Entrar</Link>
          </Button>
          <Button asChild size="xl" variant="outline">
            <a href={inviteAppLink(token)}>Abrir no app</a>
          </Button>
        </>
      ) : (
        <>
          <Button
            size="xl"
            disabled={accept.isPending}
            onClick={() => (loggedIn ? accept.mutate({ token }) : setFormOpen(true))}
          >
            {accept.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Confirmar presença
          </Button>
          <Button
            size="xl"
            variant="outline"
            disabled={accept.isPending}
            onClick={() => setDeclineOpen(true)}
          >
            Não vou
          </Button>
        </>
      )}

      <ConfirmDialog
        open={declineOpen}
        onOpenChange={setDeclineOpen}
        title="Não vai jogar?"
        description={`Vamos avisar ${organizer}. Depois disso, este link não vale mais.`}
        confirmLabel="Não vou"
        pending={decline.isPending}
        error={decline.error}
        onConfirm={() => decline.mutate({ token })}
      />
    </InviteCard>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-sm">{children}</p>;
}

/** Depois de responder sem conta: abrir no app, ou criar conta levando o token. */
function AccountOffer({
  token,
  loggedIn,
  checking,
}: {
  token: string;
  loggedIn: boolean;
  checking: boolean;
}) {
  if (loggedIn) return null;
  if (checking) return <Skeleton className="h-11 w-full" />;
  return (
    <>
      <Button asChild size="xl">
        <a href={inviteAppLink(token)}>Abrir no app</a>
      </Button>
      <Button asChild size="xl" variant="outline">
        <Link href={signUpWithInvitePath(token)}>Criar conta</Link>
      </Button>
    </>
  );
}

function InviteCard({
  title,
  description,
  invite,
  children,
}: {
  title: string;
  description?: string;
  invite: PublicInvitePreview;
  children: ReactNode;
}) {
  return (
    <AuthCard title={title} description={description}>
      <InviteSummary invite={invite} />
      {children}
    </AuthCard>
  );
}

/** Só o que a prévia pública traz: nunca dados de outros convidados (RF-CONTACT-02). */
function InviteSummary({ invite }: { invite: PublicInvitePreview }) {
  const { booking, shareCents } = invite;
  return (
    <ul className="bg-muted/40 grid gap-2 rounded-lg border p-3 text-sm" aria-label="Reserva">
      <SummaryItem icon={<MapPin aria-hidden />}>
        <strong className="block">{booking.space.name}</strong>
        {booking.court.name} · {booking.sport.name}
      </SummaryItem>
      <SummaryItem icon={<CalendarClock aria-hidden />}>
        <span className="tabular-nums">
          {formatInviteWhen(booking.startsAt, booking.endsAt, booking.space.timeZone)}
        </span>
      </SummaryItem>
      <SummaryItem icon={<UserRound aria-hidden />}>
        Organizado por {booking.organizerFirstName}
      </SummaryItem>
      {shareCents > 0 ? (
        <SummaryItem icon={<Wallet aria-hidden />}>
          Sua parte: <span className="tabular-nums">{formatMoney(shareCents)}</span>
        </SummaryItem>
      ) : null}
    </ul>
  );
}

function SummaryItem({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="text-muted-foreground mt-0.5 shrink-0 [&>svg]:size-4">{icon}</span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

type ConfirmData = { name: string; phone?: string; email?: string; marketingConsent: boolean };

function ConfirmForm({
  pending,
  error,
  onBack,
  onSubmit,
}: {
  pending: boolean;
  error: unknown;
  onBack: () => void;
  onSubmit: (data: ConfirmData) => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const e164 = phone ? normalizePhone(phone) : null;
    const next = {
      name: validateName(name),
      phone: phone
        ? e164
          ? undefined
          : 'Informe o WhatsApp com DDD'
        : email.trim()
          ? undefined
          : 'Informe o WhatsApp ou o e-mail',
      email: email.trim() ? validateEmail(email) : undefined,
    };
    setErrors(next);
    if (next.name || next.phone || next.email) return focusFirstInvalid(event.currentTarget);
    onSubmit({
      name: name.trim(),
      ...(e164 ? { phone: e164 } : {}),
      ...(email.trim() ? { email: normalizeEmail(email) } : {}),
      marketingConsent: consent,
    });
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <FormError message={error ? apiErrorMessage(error) : undefined} />
      <Field label="Seu nome" htmlFor="invite-name" error={errors.name}>
        <Input
          id="invite-name"
          autoComplete="name"
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <p className="text-muted-foreground text-sm">Informe o WhatsApp ou o e-mail. Basta um.</p>
      <Field label="WhatsApp" htmlFor="invite-phone" error={errors.phone}>
        <MaskedInput
          mask="phone"
          id="invite-phone"
          autoComplete="tel-national"
          value={phone}
          onValueChange={setPhone}
        />
      </Field>
      <Field label="E-mail" htmlFor="invite-email" error={errors.email}>
        <Input
          id="invite-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          maxLength={254}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </Field>
      <div className="flex items-start gap-2">
        <Checkbox
          id="invite-consent"
          className="mt-0.5"
          checked={consent}
          onCheckedChange={(value) => setConsent(value === true)}
        />
        <Label htmlFor="invite-consent" className="leading-snug font-normal">
          Quero receber novidades e convites do Space Sports
        </Label>
      </div>
      <p className="text-muted-foreground text-xs">
        Seu nome e contato ficam com o Space Sports e com o espaço, para organizar esta reserva.
        Novidades e convites só chegam se você marcar a caixa acima.
      </p>
      <div className="flex flex-col gap-2">
        <Button type="submit" size="xl" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Confirmar presença
        </Button>
        <Button type="button" size="xl" variant="outline" disabled={pending} onClick={onBack}>
          Voltar
        </Button>
      </div>
    </form>
  );
}
