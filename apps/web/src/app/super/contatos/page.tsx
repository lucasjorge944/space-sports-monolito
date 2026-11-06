import type { Metadata } from 'next';
import { ContactsView } from '@/components/super/contacts/contacts-view';

export const metadata: Metadata = { title: 'Contatos' };

export default function ContactsPage() {
  return <ContactsView />;
}
