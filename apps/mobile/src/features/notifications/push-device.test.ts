import { registerPushDevice, unregisterPushDevice } from './push-device';

const mockRegister = jest.fn();
const mockRemove = jest.fn();
jest.mock('@space-sports/api-client', () => ({
  registerDevice: (...a: unknown[]) => mockRegister(...a),
  removeDevice: (...a: unknown[]) => mockRemove(...a),
}));

const mockStore = new Map<string, string>();
jest.mock('@/lib/storage', () => ({
  STORAGE_KEYS: { pushDeviceId: 'push-id' },
  getStored: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setStored: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  removeStored: jest.fn(async (k: string) => void mockStore.delete(k)),
}));

let mockIsDevice = true;
jest.mock('expo-device', () => ({
  get isDevice() {
    return mockIsDevice;
  },
}));
const mockGetPermissions = jest.fn();
const mockRequestPermissions = jest.fn();
const mockGetToken = jest.fn();
jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  setNotificationChannelAsync: jest.fn(),
  getPermissionsAsync: () => mockGetPermissions(),
  requestPermissionsAsync: () => mockRequestPermissions(),
  getExpoPushTokenAsync: (...a: unknown[]) => mockGetToken(...a),
}));
jest.mock('expo-constants', () => ({ expoConfig: { extra: {} }, easConfig: undefined }));

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  mockIsDevice = true;
  mockGetPermissions.mockResolvedValue({ status: 'granted' });
  mockGetToken.mockResolvedValue({ data: 'ExponentPushToken[abc]' });
  mockRegister.mockResolvedValue({ id: 'dev-1', expoPushToken: 'ExponentPushToken[abc]' });
});

describe('registerPushDevice', () => {
  it('registra o token no PUT /v1/me/devices e guarda o id', async () => {
    const device = await registerPushDevice();
    expect(mockRegister).toHaveBeenCalledWith({
      expoPushToken: 'ExponentPushToken[abc]',
      platform: expect.stringMatching(/^(IOS|ANDROID)$/),
    });
    expect(device?.id).toBe('dev-1');
    expect(mockStore.get('push-id')).toBe('dev-1');
  });

  it('pede a permissão quando ainda não foi dada', async () => {
    mockGetPermissions.mockResolvedValue({ status: 'undetermined' });
    mockRequestPermissions.mockResolvedValue({ status: 'granted' });
    await registerPushDevice();
    expect(mockRequestPermissions).toHaveBeenCalled();
    expect(mockRegister).toHaveBeenCalled();
  });

  it('permissão negada: não registra e não lança', async () => {
    mockGetPermissions.mockResolvedValue({ status: 'denied' });
    mockRequestPermissions.mockResolvedValue({ status: 'denied' });
    await expect(registerPushDevice()).resolves.toBeNull();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('simulador: não registra', async () => {
    mockIsDevice = false;
    await expect(registerPushDevice()).resolves.toBeNull();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('falha da API não derruba o login', async () => {
    mockRegister.mockRejectedValue(new TypeError('Network request failed'));
    await expect(registerPushDevice()).resolves.toBeNull();
  });
});

describe('unregisterPushDevice', () => {
  it('remove o token da API e apaga o id local', async () => {
    mockStore.set('push-id', 'dev-1');
    await unregisterPushDevice();
    expect(mockRemove).toHaveBeenCalledWith('dev-1');
    expect(mockStore.has('push-id')).toBe(false);
  });

  it('sem id guardado, não chama a API', async () => {
    await unregisterPushDevice();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('falha de rede no logout não impede o logout', async () => {
    mockStore.set('push-id', 'dev-1');
    mockRemove.mockRejectedValue(new TypeError('Network request failed'));
    await expect(unregisterPushDevice()).resolves.toBeUndefined();
    expect(mockStore.has('push-id')).toBe(false);
  });
});
