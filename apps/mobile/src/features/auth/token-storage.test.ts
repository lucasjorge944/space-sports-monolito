import * as SecureStore from 'expo-secure-store';
import {
  clearSessionToken,
  getSessionToken,
  resetSessionTokenCache,
  SESSION_TOKEN_KEY,
  setSessionToken,
} from './token-storage';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const store = jest.mocked(SecureStore);

beforeEach(() => {
  jest.clearAllMocks();
  resetSessionTokenCache();
});

describe('token da sessão', () => {
  it('lê do SecureStore na primeira vez e depois usa o cache', async () => {
    store.getItemAsync.mockResolvedValue('abc.def');
    expect(await getSessionToken()).toBe('abc.def');
    expect(await getSessionToken()).toBe('abc.def');
    expect(store.getItemAsync).toHaveBeenCalledTimes(1);
    expect(store.getItemAsync).toHaveBeenCalledWith(SESSION_TOKEN_KEY);
  });

  it('sem token guardado devolve null', async () => {
    store.getItemAsync.mockResolvedValue(null);
    expect(await getSessionToken()).toBeNull();
  });

  it('keystore com falha na leitura vale como sem sessão', async () => {
    store.getItemAsync.mockRejectedValue(new Error('keystore'));
    expect(await getSessionToken()).toBeNull();
  });

  it('grava no SecureStore e já responde com o novo valor', async () => {
    await setSessionToken('novo.token');
    expect(store.setItemAsync).toHaveBeenCalledWith(SESSION_TOKEN_KEY, 'novo.token');
    expect(await getSessionToken()).toBe('novo.token');
    expect(store.getItemAsync).not.toHaveBeenCalled();
  });

  it('limpar apaga do SecureStore e do cache', async () => {
    await setSessionToken('x.y');
    await clearSessionToken();
    expect(store.deleteItemAsync).toHaveBeenCalledWith(SESSION_TOKEN_KEY);
    expect(await getSessionToken()).toBeNull();
  });

  it('limpar zera o cache mesmo se apagar do SecureStore falhar', async () => {
    await setSessionToken('x.y');
    store.deleteItemAsync.mockRejectedValue(new Error('keystore'));
    await expect(clearSessionToken()).resolves.toBeUndefined();
    expect(await getSessionToken()).toBeNull();
  });
});
