import { ApiError, requestMyAccountDeletion } from '@space-sports/api-client';
import {
  deleteAccountErrorMessage,
  deletionReceiptMessage,
  formatDueDate,
  passwordFieldError,
  requestAccountDeletion,
} from './delete-account';

jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  requestMyAccountDeletion: jest.fn(),
}));
const requestMock = requestMyAccountDeletion as jest.Mock;

beforeEach(() => jest.resetAllMocks());

const err = (status: number, code: string) => new ApiError({ status, code, message: 'English' });

describe('pedido de exclusão de conta (decisão 40)', () => {
  it('chama POST /v1/me/deletion-request com a senha e o motivo e devolve o prazo', async () => {
    const receipt = {
      requestId: 'r1',
      requestedAt: '2026-10-29T15:00:00.000Z',
      dueAt: '2026-11-13T15:00:00.000Z',
    };
    requestMock.mockResolvedValue(receipt);
    await expect(
      requestAccountDeletion({ password: 'segredo123', reason: ' Não uso ' }),
    ).resolves.toBe(receipt);
    expect(requestMock).toHaveBeenCalledWith({ password: 'segredo123', reason: 'Não uso' });
  });

  it('não envia senha nem motivo em branco', async () => {
    requestMock.mockResolvedValue({});
    await requestAccountDeletion({ password: '  ', reason: ' ' });
    expect(requestMock).toHaveBeenCalledWith({});
  });

  it('propaga o erro da API para a tela mostrar', async () => {
    const error = err(409, 'LAST_OWNER');
    requestMock.mockRejectedValue(error);
    await expect(requestAccountDeletion({})).rejects.toBe(error);
  });

  it('traduz cada código da API', () => {
    expect(deleteAccountErrorMessage(err(403, 'INVALID_PASSWORD'))).toMatch(/Senha incorreta/);
    expect(deleteAccountErrorMessage(err(403, 'REAUTHENTICATION_REQUIRED'))).toMatch(
      /digite a senha/,
    );
    expect(deleteAccountErrorMessage(err(409, 'DELETION_REQUEST_PENDING'))).toMatch(
      /em análise.*atendimento/,
    );
    expect(deleteAccountErrorMessage(err(409, 'LAST_OWNER'))).toMatch(/único Dono/);
    expect(deleteAccountErrorMessage(err(409, 'SUPER_ACCOUNT'))).toMatch(/plataforma/);
    expect(deleteAccountErrorMessage(err(403, 'USER_BLOCKED'))).toMatch(/bloqueada/);
    expect(deleteAccountErrorMessage(err(429, 'TOO_MANY_REQUESTS'))).toMatch(/Muitas tentativas/);
    expect(deleteAccountErrorMessage(new TypeError('Network request failed'))).toMatch(
      /Sem conexão/,
    );
    expect(deleteAccountErrorMessage(err(400, 'ALGO_NOVO'))).toBe(
      'Algo deu errado. Tente novamente.',
    );
  });

  it('o campo de senha só mostra erro de senha errada ou de sessão antiga', () => {
    expect(passwordFieldError(err(403, 'INVALID_PASSWORD'))).toBe('Senha incorreta');
    expect(passwordFieldError(err(403, 'REAUTHENTICATION_REQUIRED'))).toBe(
      'Digite a senha da sua conta',
    );
    expect(passwordFieldError(err(409, 'LAST_OWNER'))).toBeNull();
    expect(passwordFieldError(new TypeError('x'))).toBeNull();
    expect(passwordFieldError(null)).toBeNull();
  });

  it('mostra o prazo no fuso de São Paulo (23h de SP já é o dia seguinte em UTC)', () => {
    expect(formatDueDate('2026-11-14T02:30:00.000Z')).toBe('13/11/2026');
    expect(deletionReceiptMessage({ dueAt: '2026-11-13T15:00:00.000Z' })).toMatch(
      /até 13\/11\/2026/,
    );
  });
});
