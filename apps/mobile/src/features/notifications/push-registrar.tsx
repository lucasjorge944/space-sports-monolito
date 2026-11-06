import {
  getGetMyBookingPaymentQueryKey,
  getGetMyBookingQueryKey,
  getGetMySubscriptionChargePaymentQueryKey,
  getGetMySubscriptionQueryKey,
  getListNotificationsQueryKey,
} from '@space-sports/api-client';
import { useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { registerPushDevice } from './push-device';
import { pushTarget } from './push-route';

// Com o app aberto, mostra o aviso na tela (o padrão do Expo é silenciar).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/** Consultas que um aviso do pagamento online desatualiza (`onlineChargeId` nos dados). */
export function paymentQueryKeys(data: unknown): (readonly unknown[])[] {
  if (!data || typeof data !== 'object') return [];
  const { onlineChargeId, bookingId, subscriptionId, chargeId } = data as Record<string, unknown>;
  if (typeof onlineChargeId !== 'string') return [];
  const keys: (readonly unknown[])[] = [['/v1/me/payments'], [`/v1/me/payments/${onlineChargeId}`]];
  if (typeof bookingId === 'string') {
    keys.push(getGetMyBookingPaymentQueryKey(bookingId), getGetMyBookingQueryKey(bookingId), [
      '/v1/bookings',
    ]);
  }
  if (typeof subscriptionId === 'string' && typeof chargeId === 'string') {
    keys.push(
      getGetMySubscriptionChargePaymentQueryKey(subscriptionId, chargeId),
      getGetMySubscriptionQueryKey(subscriptionId),
    );
  }
  return keys;
}

// `getLastNotificationResponseAsync` devolve a mesma resposta enquanto o app vive: abre cada toque uma vez só.
let lastHandledId: string | null = null;

/**
 * Montado só com a sessão ativa: registra o token push depois do login, atualiza as listas quando
 * um aviso chega com o app aberto e leva a pessoa à reserva/mensalista/convite ao tocar nele.
 */
export function PushRegistrar({ userId }: { userId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  // Novo login (ou troca de conta) registra de novo; o servidor trata o token como único.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `userId` é o gatilho do registro.
  useEffect(() => {
    void registerPushDevice();
  }, [userId]);

  useEffect(() => {
    const open = (data: unknown) => {
      const target = pushTarget(data);
      if (target) router.push(target);
    };
    // App fechado e aberto pelo toque na notificação.
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response && response.notification.request.identifier !== lastHandledId) {
        lastHandledId = response.notification.request.identifier;
        open(response.notification.request.content.data);
      }
    });
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      lastHandledId = response.notification.request.identifier;
      open(response.notification.request.content.data);
    });
    const received = Notifications.addNotificationReceivedListener((notification) => {
      void queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
      const data = notification.request.content.data;
      for (const queryKey of paymentQueryKeys(data)) {
        // Pagamento confirmado, Pix vencido ou estorno: a tela do Pix e as listas mudam na hora.
        void queryClient.invalidateQueries({ queryKey });
      }
      const target = pushTarget(data);
      if (target?.pathname === '/reserva/[id]') {
        // Reserva vinculada à conta (Minhas reservas) ou convidado que respondeu (detalhe).
        void queryClient.invalidateQueries({ queryKey: ['/v1/bookings'] });
        void queryClient.invalidateQueries({ queryKey: getGetMyBookingQueryKey(target.params.id) });
      }
    });
    return () => {
      subscription.remove();
      received.remove();
    };
  }, [router, queryClient]);

  return null;
}
