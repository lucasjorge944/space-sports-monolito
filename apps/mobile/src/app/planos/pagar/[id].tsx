import { useLocalSearchParams } from 'expo-router';
import { PaymentScreen } from '@/features/payments/payment-screen';

/** Pagamento online da mensalidade (RF-ONPAY-05): `id` = mensalidade, `plano` = assinatura. */
export default function PagarMensalidadeScreen() {
  const { id, plano } = useLocalSearchParams<{ id: string; plano: string }>();
  return (
    <PaymentScreen payable={{ type: 'SUBSCRIPTION_CHARGE', subscriptionId: plano, chargeId: id }} />
  );
}
