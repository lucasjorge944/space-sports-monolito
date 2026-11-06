import type { Metadata } from 'next';
import { DeleteAccountRequest } from '@/components/account/delete-account-request';

export const metadata: Metadata = {
  title: 'Excluir minha conta',
  description: 'Como pedir a exclusão da sua conta e dos seus dados no Space Sports.',
};

export default function ExcluirContaPage() {
  return <DeleteAccountRequest />;
}
