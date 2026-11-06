import { ApiError, deactivateMe } from '@space-sports/api-client';
import { deactivateAccountErrorMessage, requestAccountDeactivation } from './deactivate-account';

jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  deactivateMe: jest.fn(),
}));
const deactivateMock = deactivateMe as jest.Mock;

beforeEach(() => jest.resetAllMocks());

describe('inativação de conta', () => {
  it('chama POST /v1/me/deactivate sem corpo nem senha', async () => {
    deactivateMock.mockResolvedValue(undefined);
    await expect(requestAccountDeactivation()).resolves.toBeUndefined();
    expect(deactivateMock).toHaveBeenCalledTimes(1);
    expect(deactivateMock).toHaveBeenCalledWith();
  });

  it('propaga o erro da API para a tela mostrar', async () => {
    const error = new ApiError({ status: 409, code: 'LAST_OWNER', message: 'x' });
    deactivateMock.mockRejectedValue(error);
    await expect(requestAccountDeactivation()).rejects.toBe(error);
  });

  it('traduz cada código da API', () => {
    const err = (status: number, code: string) => new ApiError({ status, code, message: 'x' });
    expect(deactivateAccountErrorMessage(err(409, 'LAST_OWNER'))).toMatch(
      /transfira a titularidade/i,
    );
    expect(deactivateAccountErrorMessage(err(409, 'SUPER_ACCOUNT'))).toMatch(/plataforma/);
    expect(deactivateAccountErrorMessage(err(403, 'USER_BLOCKED'))).toMatch(/bloqueada/);
    expect(deactivateAccountErrorMessage(err(403, 'ACCOUNT_INACTIVE'))).toMatch(/inativa/i);
  });

  it('erro desconhecido cai na mensagem genérica em PT-BR', () => {
    const unknown = new ApiError({ status: 400, code: 'ALGO_NOVO', message: 'English' });
    expect(deactivateAccountErrorMessage(unknown)).toBe('Algo deu errado. Tente novamente.');
  });
});
