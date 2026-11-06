import { fireEvent, render, screen } from '@testing-library/react-native';
import { Share } from 'react-native';
import {
  PaymentReceiptScreen,
  receiptShareText,
  shortTransactionId,
} from './payment-receipt-screen';
import { myPaymentDetail, NONE_ENV } from './test-fixtures';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({ id: 'oc1' }),
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  SafeAreaView: jest.requireActual('react-native').View,
}));
jest.mock('@/theme/theme-provider', () => ({ useThemeName: () => 'light' }));
const mockCopy = jest.fn();
jest.mock('expo-clipboard', () => ({ setStringAsync: (v: string) => mockCopy(v) }));

let mockPayment = myPaymentDetail();
jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  useGetMyPayment: () => ({
    data: mockPayment,
    isPending: false,
    isError: false,
    dataUpdatedAt: 0,
  }),
}));

describe('comprovante (RF-ONPAY-06)', () => {
  it('valor, status, linhas e o selo de teste', async () => {
    mockPayment = myPaymentDetail({ payerName: 'Ana Pagadora' });
    await render(<PaymentReceiptScreen />);
    expect(screen.getByTestId('comprovante-valor')).toHaveTextContent(/R\$\s120,00/);
    expect(screen.getByTestId('comprovante-status')).toHaveTextContent('Pago');
    expect(screen.getByText('Pago em 08/11/2026 às 18:42')).toBeTruthy();
    expect(screen.getByTestId('comprovante-teste')).toHaveTextContent(
      'Comprovante de teste, sem valor',
    );
    expect(screen.getByText('Arena Beira-Mar')).toBeTruthy();
    // O pagador vem da API (`payerName`), não do usuário logado.
    expect(screen.getByText('Ana Pagadora')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('comprovante-transacao'));
    expect(mockCopy).toHaveBeenCalledWith('a8f3c0d1e2f3a4b591c2');
    expect(shortTransactionId('a8f3c0d1e2f3a4b591c2')).toBe('a8f3…91c2');
  });

  it('estornos com o motivo (manual entre aspas, automático explicado) e o destino', async () => {
    mockPayment = myPaymentDetail({
      status: 'PARTIALLY_REFUNDED',
      refundedCents: 4_000,
      paymentEnvironment: NONE_ENV,
      refunds: [
        {
          id: 'r1',
          kind: 'REFUND',
          status: 'SUCCEEDED',
          amountCents: 4_000,
          reason: 'Quadra sem iluminação',
          reasonCode: 'MANUAL',
          createdAt: '2026-11-09T12:00:00.000Z',
        },
        {
          id: 'r2',
          kind: 'REFUND',
          status: 'PENDING',
          amountCents: 8_000,
          reason: null,
          reasonCode: 'PAID_AFTER_DEADLINE',
          createdAt: '2026-11-09T13:00:00.000Z',
        },
      ],
    });
    await render(<PaymentReceiptScreen />);
    const refunds = screen.getByTestId('comprovante-estornos');
    expect(refunds).toHaveTextContent(/“Quadra sem iluminação”/);
    expect(refunds).toHaveTextContent(/Estorno automático: o pagamento chegou depois do prazo/);
    expect(refunds).toHaveTextContent(/em processamento/);
    expect(refunds).toHaveTextContent(/Volta para o mesmo Pix\./);
    expect(refunds).toHaveTextContent(/−\sR\$\s40,00/);
    expect(screen.queryByTestId('comprovante-teste')).toBeNull();
  });

  it('compartilha o texto do comprovante (sem saldo, sem PDF)', async () => {
    mockPayment = myPaymentDetail();
    const share = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    await render(<PaymentReceiptScreen />);
    await fireEvent.press(screen.getByTestId('comprovante-compartilhar'));
    expect(share).toHaveBeenCalledWith({
      message: receiptShareText(mockPayment),
    });
    expect(receiptShareText(mockPayment)).toMatch(/Recebido por: Arena Beira-Mar/);
    share.mockRestore();
  });

  it('"Ver reserva" abre a reserva do pagamento', async () => {
    mockPayment = myPaymentDetail();
    await render(<PaymentReceiptScreen />);
    await fireEvent.press(screen.getByTestId('comprovante-ver-item'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/reserva/[id]', params: { id: 'b1' } });
  });
});
