import type { Metadata } from 'next';
import { Suspense } from 'react';
import { MerchantFormView } from '@/components/painel/online/merchant-form';
import { RouteLoading } from '@/components/shell/route-states';

export const metadata: Metadata = { title: 'Cadastro da conta de recebimento' };

export default function CadastroContaPage() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <MerchantFormView />
    </Suspense>
  );
}
