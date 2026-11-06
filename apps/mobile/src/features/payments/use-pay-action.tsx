import {
  type OpenOnlineCharge,
  type PaymentOption,
  useGetSpaceBySlug,
} from '@space-sports/api-client';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { PaymentMethodOptions } from './components/payment-method-options';
import { nowWithOffset, remainingMs } from './countdown';
import { bookingOnlineOptions, classOnlineOptions, type OnlineOption } from './options';
import { type Payable, paymentHref } from './payable';

export const ONLINE_OFF_MESSAGE = 'O pagamento pelo app está indisponível agora. Pague no espaço.';

/** Pix aberto e no prazo: o "Pagar" volta para o mesmo código, sem gerar outro. */
export function hasOpenPix(open: OpenOnlineCharge | null | undefined, now?: number): boolean {
  return Boolean(
    open && open.method === 'PIX' && open.expiresAt && remainingMs(open.expiresAt, now) > 0,
  );
}

/**
 * "Pagar" de uma reserva ou mensalidade (docs/05, "App — (4)" e "(5)"): com um Pix aberto e no
 * prazo, abre a tela dele; senão, a folha "Como você quer pagar?" (sem "No local") e depois a tela
 * do meio escolhido. As formas vêm do espaço (por serviço).
 */
export function usePayAction({
  payable,
  spaceSlug,
  service,
  openCharge,
  enabled = true,
  clockOffsetMs,
}: {
  payable: Payable;
  spaceSlug: string;
  service: 'rental' | 'classes';
  openCharge: OpenOnlineCharge | null | undefined;
  /** Só quem pode pagar (o organizador, o aluno) busca as formas do espaço. */
  enabled?: boolean;
  /** Diferença servidor − aparelho do item (o `serverTime` da reserva). */
  clockOffsetMs?: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<OnlineOption | null>(null);
  const space = useGetSpaceBySlug(spaceSlug, {
    query: { enabled: enabled && Boolean(spaceSlug), staleTime: 60_000 },
  });
  const options =
    service === 'rental' ? bookingOnlineOptions(space.data) : classOnlineOptions(space.data);
  // Pré-seleção: Pix (ou o único meio).
  const selected =
    choice && options.includes(choice)
      ? choice
      : options.includes('ONLINE_PIX')
        ? 'ONLINE_PIX'
        : (options[0] ?? null);

  const go = (option: OnlineOption) => {
    setOpen(false);
    router.push(paymentHref(payable, { forma: option === 'ONLINE_PIX' ? 'pix' : 'cartao' }));
  };

  const start = () => {
    if (hasOpenPix(openCharge, nowWithOffset(clockOffsetMs))) {
      router.push(paymentHref(payable, { forma: 'pix' }));
      return;
    }
    if (space.data && options.length === 0) {
      Alert.alert('Pagamento indisponível', ONLINE_OFF_MESSAGE);
      return;
    }
    if (options.length === 1 && options[0]) {
      go(options[0]);
      return;
    }
    setChoice(null);
    setOpen(true);
  };

  const sheet = (
    <BottomSheet visible={open} title="Como você quer pagar?" onClose={() => setOpen(false)}>
      {space.isPending ? (
        <Text variant="muted">Carregando as formas de pagamento…</Text>
      ) : (
        <PaymentMethodOptions
          options={options as PaymentOption[]}
          value={selected}
          onChange={(option) => setChoice(option as OnlineOption)}
          testIDPrefix="pagar-opcao"
        />
      )}
      <Button
        testID="pagar-continuar"
        size="lg"
        disabled={!selected}
        onPress={() => selected && go(selected)}
      >
        <Text>{selected === 'ONLINE_CARD' ? 'Pagar com cartão' : 'Pagar com Pix'}</Text>
      </Button>
    </BottomSheet>
  );

  return { start, sheet, loadingOptions: space.isPending };
}
