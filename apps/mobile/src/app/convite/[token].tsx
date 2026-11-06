import {
  isApiError,
  useAcceptInvite,
  useDeclineInvite,
  useGetInvite,
} from '@space-sports/api-client';
import { formatCents } from '@space-sports/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/screen-header';
import { EmptyView, ErrorView, InlineError, LoadingView } from '@/components/state-views';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { isProfileIncomplete } from '@/features/auth/route-access';
import { useSession } from '@/features/auth/session';
import { isValidInviteToken, savePendingInvite } from '@/features/invites/pending-invite';
import { errorMessage, isNotFound } from '@/lib/api-errors';
import { formatBookingWhen } from '@/lib/datetime';

/**
 * Deep link `spacesports://convite/<token>` (RF-BOOK-04), também o "Abrir no app" da página pública.
 * Deslogado: guarda o token, pede para entrar ou criar conta e volta aqui depois (`EntryGate`).
 * Logado sem nome (conta de telefone): guarda o token e leva a completar o perfil; o `EntryGate`
 * volta aqui quando o app abrir.
 * Logado: mostra a reserva e a sua parte para aceitar ou recusar. Quem confirmou na página, sem
 * conta, usa o mesmo aceite para trazer a presença para a conta, se ela tiver o mesmo contato; a
 * vaga de outra pessoa não oferece o aceite (RF-CONTACT-03).
 */
export default function ConviteScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { state } = useSession();
  const signedIn = state.status === 'signed-in';
  const incompleteProfile = state.status === 'signed-in' && isProfileIncomplete(state.me);
  const valid = isValidInviteToken(token ?? '');
  const query = useGetInvite(token ?? '', {
    query: { enabled: signedIn && !incompleteProfile && valid, retry: false },
  });
  const [notice, setNotice] = useState<string | null>(null);

  // Sem nome, o app ainda não abre: guarda o token (só se válido) antes de sair daqui.
  useEffect(() => {
    if (!incompleteProfile) return;
    let active = true;
    void savePendingInvite(token ?? '').then(() => {
      if (active) router.replace('/completar-perfil');
    });
    return () => {
      active = false;
    };
  }, [incompleteProfile, token, router]);

  const done = (bookingId: string | null) => {
    void queryClient.invalidateQueries({ queryKey: ['/v1/bookings'] });
    if (bookingId) router.replace({ pathname: '/reserva/[id]', params: { id: bookingId } });
    else router.replace('/');
  };
  const accept = useAcceptInvite({
    mutation: {
      onSuccess: (invite) => done(invite.booking.id),
      onError: (e) => {
        setNotice(errorMessage(e));
        // A vaga pode ter sido ocupada depois da prévia: relê para a tela não insistir no aceite.
        if (isApiError(e) && e.code === 'INVITE_SLOT_TAKEN') void query.refetch();
      },
    },
  });
  const decline = useDeclineInvite({
    mutation: {
      onSuccess: () => done(null),
      onError: (e) => setNotice(errorMessage(e)),
    },
  });

  const body = () => {
    if (incompleteProfile) return <LoadingView />;
    if (!valid) {
      return (
        <View testID="convite-invalido" className="flex-1">
          <EmptyView title="Convite inválido" description="Peça um novo link a quem convidou." />
        </View>
      );
    }
    if (!signedIn) {
      return (
        <View className="gap-4 p-4">
          <Text variant="h4">Você foi convidado para jogar</Text>
          <Text variant="muted">
            Entre ou crie sua conta para ver a reserva e aceitar o convite.
          </Text>
          <Button
            testID="convite-entrar"
            onPress={() => {
              void savePendingInvite(token ?? '').then(() => router.replace('/entrar'));
            }}
          >
            <Text>Entrar ou criar conta</Text>
          </Button>
        </View>
      );
    }
    if (query.isPending) return <LoadingView />;
    if (query.isError || !query.data) {
      return isNotFound(query.error) ? (
        <EmptyView
          title="Convite não encontrado"
          description="Peça um novo link a quem convidou."
        />
      ) : (
        <ErrorView error={query.error} onRetry={() => void query.refetch()} />
      );
    }
    const invite = query.data;
    const { booking } = invite;
    const cancelled = booking.status === 'CANCELLED';
    const open = booking.status === 'CONFIRMED' && new Date(booking.endsAt) > new Date();
    const mine = invite.acceptedByMe;
    const taken = invite.slotTaken;
    const confirmedWithoutMe = invite.status === 'ACCEPTED' && !mine && !taken;
    const busy = accept.isPending || decline.isPending;
    return (
      <ScrollView contentContainerClassName="gap-4 p-4">
        <Text variant="h4">{booking.organizerName} convidou você para jogar</Text>
        <Card>
          <Text variant="large">{booking.space.name}</Text>
          <Text>{formatBookingWhen(booking.startsAt, booking.endsAt, booking.space.timeZone)}</Text>
          <Text variant="muted">
            {booking.court.name} · {booking.sport.name}
          </Text>
        </Card>
        <Card>
          <View className="flex-row items-center justify-between">
            <Text variant="muted">Sua parte</Text>
            <Text variant="large" className="tabular-nums">
              {formatCents(invite.shareCents)}
            </Text>
          </View>
          <Text variant="muted">Você paga direto no espaço, não pelo app.</Text>
        </Card>
        {cancelled ? (
          <Badge variant="destructive">
            <Text>Reserva cancelada</Text>
          </Badge>
        ) : null}
        {mine ? (
          <Badge variant="success">
            <Text>Você já aceitou</Text>
          </Badge>
        ) : null}
        {confirmedWithoutMe ? (
          <Badge variant="success">
            <Text>Presença confirmada</Text>
          </Badge>
        ) : null}
        {taken ? (
          <Badge variant="muted">
            <Text>Vaga ocupada</Text>
          </Badge>
        ) : null}
        {invite.status === 'DECLINED' ? (
          <Badge variant="muted">
            <Text>Convite recusado</Text>
          </Badge>
        ) : null}
        <InlineError message={notice} />
        {taken && open ? (
          <Text variant="muted">
            Esta vaga já foi preenchida. Se a presença é sua, use a conta com o e-mail ou o telefone
            que você informou. Se não, peça outro link a quem convidou.
          </Text>
        ) : null}
        {mine ? (
          <Button testID="convite-ver-reserva" onPress={() => done(booking.id)}>
            <Text>Ver reserva</Text>
          </Button>
        ) : confirmedWithoutMe && open ? (
          <View className="gap-2">
            <Text variant="muted">
              Esta presença foi confirmada sem conta. Use a sua para ver a reserva em Minhas
              reservas.
            </Text>
            <Button
              testID="convite-trazer-para-conta"
              size="lg"
              disabled={busy}
              onPress={() => {
                setNotice(null);
                accept.mutate({ token: token ?? '' });
              }}
            >
              <Text>{accept.isPending ? 'Salvando…' : 'Colocar na minha conta'}</Text>
            </Button>
          </View>
        ) : invite.status !== 'INVITED' || !open ? (
          // A reserva só abre para quem participa: sem aceite, aqui ela daria "não encontrada".
          <Button variant="outline" testID="convite-inicio" onPress={() => done(null)}>
            <Text>Voltar ao início</Text>
          </Button>
        ) : (
          <View className="gap-2">
            <Button
              testID="convite-aceitar"
              size="lg"
              disabled={busy}
              onPress={() => {
                setNotice(null);
                accept.mutate({ token: token ?? '' });
              }}
            >
              <Text>{accept.isPending ? 'Aceitando…' : 'Aceitar convite'}</Text>
            </Button>
            <Button
              testID="convite-recusar"
              variant="outline"
              disabled={busy}
              onPress={() => {
                setNotice(null);
                decline.mutate({ token: token ?? '' });
              }}
            >
              <Text>Recusar</Text>
            </Button>
          </View>
        )}
      </ScrollView>
    );
  };

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <ScreenHeader title="Convite" />
      {body()}
    </SafeAreaView>
  );
}
