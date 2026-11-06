import {
  isApiError,
  type PlayerBookingDetailDto,
  type PlayerBookingParticipantDto,
  useConfirmInviteLink,
  useCreateBookingInvites,
  useRevokeBookingInvite,
} from '@space-sports/api-client';
import { formatCents, maskPhone, splitBookingPrice } from '@space-sports/shared';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Share, View } from 'react-native';
import { InlineError } from '@/components/state-views';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { Field } from '@/features/auth/components/field';
import { useFormField, validateFields } from '@/features/auth/components/use-form-field';
import { useMe } from '@/features/auth/session';
import { validateRequired } from '@/features/auth/validation';
import { openLink } from '@/features/space/links';
import { errorMessage } from '@/lib/api-errors';
import { formatBookingWhen } from '@/lib/datetime';
import { testIdPart } from '@/lib/test-ids';
import {
  findNewInvite,
  guestName,
  guestStatus,
  inviteItem,
  inviteMessage,
  inviteWhatsappUrl,
  isBookingOrganizer,
  remainingInvites,
  validateInviteEmail,
  validateInvitePhone,
} from './invites';

function ParticipantRow({
  participant,
  canManage,
  booking,
  onChanged,
}: {
  participant: PlayerBookingParticipantDto;
  canManage: boolean;
  booking: PlayerBookingDetailDto;
  onChanged: () => void;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const revoke = useRevokeBookingInvite({
    mutation: { onSuccess: onChanged, onError: (e) => setNotice(errorMessage(e)) },
  });
  const link = useConfirmInviteLink({
    mutation: {
      onSuccess: onChanged,
      onError: (e) => {
        setNotice(errorMessage(e));
        // A sugestão pode ter mudado: relê a lista para a tela não insistir nela.
        if (isApiError(e) && e.code === 'SUGGESTED_USER_MISMATCH') onChanged();
      },
    },
  });
  const status = guestStatus(participant);
  const pending = participant.status === 'INVITED' && participant.inviteUrl;
  const suggested = canManage ? participant.suggestedUser : null;
  const when = formatBookingWhen(booking.startsAt, booking.endsAt, booking.space.timeZone);
  const name = guestName(participant);
  const idPart = testIdPart(participant.name ?? 'vaga-aberta');

  return (
    <View className="gap-2 border-b border-border pb-3">
      <View className="flex-row items-center justify-between gap-2">
        <View className="flex-1">
          <Text className="font-medium" numberOfLines={1}>
            {name}
            {participant.isOrganizer ? ' (organizador)' : ''}
          </Text>
          <Text variant="muted" className="tabular-nums">
            {formatCents(participant.shareCents)}
          </Text>
        </View>
        {participant.isOrganizer ? null : (
          <Badge variant={status.variant}>
            <Text testID={`convite-status-${idPart}`}>{status.label}</Text>
          </Badge>
        )}
      </View>
      {suggested ? (
        <View className="gap-2 rounded-md bg-muted p-3" testID={`convite-sugestao-${idPart}`}>
          <Text className="text-sm">
            O telefone informado é de uma conta do app: {suggested.firstName}.
          </Text>
          <Button
            size="sm"
            variant="outline"
            testID={`convite-vincular-${idPart}`}
            disabled={link.isPending}
            accessibilityLabel={`É ${suggested.firstName}? Vincular`}
            onPress={() => {
              setNotice(null);
              link.mutate({
                bookingId: booking.id,
                participantId: participant.id,
                data: { userId: suggested.id },
              });
            }}
          >
            <Text>{link.isPending ? 'Vinculando…' : 'É essa pessoa? Vincular'}</Text>
          </Button>
        </View>
      ) : null}
      {canManage && pending ? (
        <View className="flex-row flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onPress={() =>
              void Share.share({
                message: inviteMessage(booking.space.name, when, participant.inviteUrl ?? ''),
              })
            }
          >
            <Text>Compartilhar</Text>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onPress={() => {
              void Clipboard.setStringAsync(participant.inviteUrl ?? '').then(() =>
                setCopied(true),
              );
            }}
          >
            <Text>{copied ? 'Link copiado' : 'Copiar link'}</Text>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={revoke.isPending}
            accessibilityLabel={`Revogar convite de ${name}`}
            onPress={() => {
              setNotice(null);
              revoke.mutate({ bookingId: booking.id, participantId: participant.id });
            }}
          >
            <Text>Revogar</Text>
          </Button>
        </View>
      ) : null}
      <InlineError message={notice} />
    </View>
  );
}

/**
 * Dividir a conta (RF-BOOK-04, RN-BOOK-09) e convite com contato (RF-CONTACT-01/05): participantes
 * com a parte de cada um. O organizador convida por nome, com WhatsApp ou e-mail opcionais, ou gera
 * uma vaga aberta; o link (`/r/<token>`) leva à página pública, em que a pessoa responde sem conta.
 */
export function InviteSection({
  booking,
  onChanged,
}: {
  booking: PlayerBookingDetailDto;
  onChanged: () => void;
}) {
  const me = useMe();
  const isOrganizer = isBookingOrganizer(booking, me.id);
  const canInvite = isOrganizer && booking.status === 'CONFIRMED' && booking.peopleCount > 1;
  const remaining = remainingInvites(booking.peopleCount, booking.participants);
  const name = useFormField({
    validate: (value) => validateRequired(value, 'Informe o nome do convidado'),
  });
  const phone = useFormField({ validate: validateInvitePhone, format: maskPhone });
  const email = useFormField({ validate: validateInviteEmail });
  const [notice, setNotice] = useState<string | null>(null);

  // WhatsApp informado abre a conversa; sem ele, ou sem app para o link, vai pelo compartilhamento.
  const deliver = async (created: PlayerBookingDetailDto, whatsapp?: string) => {
    const guest = findNewInvite(booking.participants, created.participants);
    if (!guest?.inviteUrl) return;
    const when = formatBookingWhen(booking.startsAt, booking.endsAt, booking.space.timeZone);
    const message = inviteMessage(booking.space.name, when, guest.inviteUrl);
    if (whatsapp && (await openLink(inviteWhatsappUrl(whatsapp, message)))) return;
    await Share.share({ message });
  };

  const create = useCreateBookingInvites({
    mutation: {
      onSuccess: (created, { data }) => {
        name.setValue('');
        phone.setValue('');
        email.setValue('');
        onChanged();
        deliver(created, data.items?.[0]?.phone).catch(() =>
          setNotice('Convite criado. Use "Compartilhar" na lista para enviar o link.'),
        );
      },
      onError: (e) => {
        setNotice(errorMessage(e));
        onChanged();
      },
    },
  });

  const send = () => {
    if (!validateFields([name, phone, email])) return;
    setNotice(null);
    create.mutate({
      bookingId: booking.id,
      data: { items: [inviteItem(name.value, phone.value, email.value)] },
    });
  };

  const inviteByLink = () => {
    setNotice(null);
    create.mutate({ bookingId: booking.id, data: { items: [{}] } });
  };

  const share = splitBookingPrice(booking.priceCents, booking.peopleCount);
  const others = share[1]?.amountCents ?? share[0]?.amountCents ?? 0;

  if (booking.participants.length === 0 && !canInvite) return null;

  return (
    <Card>
      <Text variant="large">Dividir a conta</Text>
      {booking.peopleCount > 1 ? (
        <Text variant="muted">
          {formatCents(booking.priceCents)} ÷ {booking.peopleCount} pessoas = {formatCents(others)}{' '}
          por pessoa. A diferença do arredondamento fica com o organizador. A divisão é só uma
          referência: o espaço registra o pagamento da reserva inteira.
        </Text>
      ) : null}
      {booking.participants.map((participant) => (
        <ParticipantRow
          key={participant.id}
          participant={participant}
          canManage={isOrganizer}
          booking={booking}
          onChanged={onChanged}
        />
      ))}
      {canInvite ? (
        remaining > 0 ? (
          <View className="gap-3">
            <Text variant="small">Convidar jogadores ({remaining} restantes)</Text>
            <Field
              label="Nome do convidado"
              testID="convite-nome"
              {...name.bind}
              autoCapitalize="words"
              returnKeyType="next"
              maxLength={120}
            />
            <Field
              label="WhatsApp"
              optional
              testID="convite-whatsapp"
              placeholder="(31) 99999-8888"
              {...phone.bind}
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
            />
            <Field
              label="E-mail"
              optional
              testID="convite-email"
              hint="Com o WhatsApp, o convite abre direto na conversa. O contato também ajuda a reconhecer a pessoa quando ela criar conta, e o espaço pode vê-lo."
              {...email.bind}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              maxLength={254}
            />
            <InlineError message={notice} />
            <Button testID="convite-enviar" disabled={create.isPending} onPress={send}>
              <Text>{create.isPending ? 'Enviando…' : 'Enviar'}</Text>
            </Button>
            <Button
              testID="convite-por-link"
              variant="outline"
              disabled={create.isPending}
              onPress={inviteByLink}
            >
              <Text>Convidar por link</Text>
            </Button>
            <Text variant="muted">No link, a própria pessoa preenche os dados e confirma.</Text>
          </View>
        ) : (
          <>
            <InlineError message={notice} />
            <Text variant="muted">Todas as vagas já têm convite.</Text>
          </>
        )
      ) : null}
    </Card>
  );
}
