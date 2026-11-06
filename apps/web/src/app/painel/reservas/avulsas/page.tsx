import type { Metadata } from 'next';
import { BookingsList } from '@/components/painel/reservas/bookings-list';

export const metadata: Metadata = { title: 'Reservas avulsas' };

export default function AvulsasPage() {
  return <BookingsList />;
}
