import { useLocalSearchParams } from 'expo-router';
import { PaymentScreen } from '@/features/payments/payment-screen';

/** Pagamento online da reserva (RF-ONPAY-03/04): `?forma=pix|cartao`. */
export default function PagarReservaScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PaymentScreen payable={{ type: 'BOOKING', bookingId: id }} />;
}
