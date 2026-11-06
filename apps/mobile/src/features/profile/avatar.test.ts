import { ApiError } from '@space-sports/api-client';
import { AVATAR_MAX_BYTES } from '@space-sports/shared';
import { AvatarError, pickAvatar, uploadAvatar } from './avatar';

const mockCreateUpload = jest.fn();
const mockSetAvatar = jest.fn();
jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  createMyAvatarUpload: (...args: unknown[]) => mockCreateUpload(...args),
  setMyAvatar: (...args: unknown[]) => mockSetAvatar(...args),
  deleteMyAvatar: jest.fn(),
}));

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));
const mockPicker = jest.requireMock<{
  requestCameraPermissionsAsync: jest.Mock;
  launchCameraAsync: jest.Mock;
  launchImageLibraryAsync: jest.Mock;
}>('expo-image-picker');

// Contexto encadeável do expo-image-manipulator: registra as operações pedidas.
const mockOps: unknown[] = [];
jest.mock('expo-image-manipulator', () => {
  const context = {
    crop: (rect: unknown) => {
      mockOps.push({ crop: rect });
      return context;
    },
    resize: (size: unknown) => {
      mockOps.push({ resize: size });
      return context;
    },
    renderAsync: async () => ({
      saveAsync: async (options: unknown) => {
        mockOps.push({ save: options });
        return { uri: 'file:///cache/avatar.jpg', width: 512, height: 512 };
      },
      release: () => mockOps.push('release image'),
    }),
    release: () => mockOps.push('release context'),
  };
  return {
    ImageManipulator: { manipulate: () => context },
    SaveFormat: { JPEG: 'jpeg' },
  };
});

// Arquivos locais apagados (LGPD): o recorte do seletor e o JPEG enviado.
const mockDeleted: string[] = [];
jest.mock('expo-file-system', () => ({
  File: function MockFile(this: { exists: boolean; delete: () => void }, uri: string) {
    this.exists = true;
    this.delete = () => mockDeleted.push(uri);
  },
}));

const UPLOAD = {
  key: 'uploads/users/u1/avatar/abc.jpg',
  uploadUrl: 'https://bucket.s3.sa-east-1.amazonaws.com/uploads/users/u1/avatar/abc.jpg?X-Amz=1',
  method: 'PUT',
  headers: { 'Content-Type': 'image/jpeg' },
  expiresAt: '2026-11-03T15:05:00.000Z',
};

/** `fetch` falso: lê o arquivo local como blob e responde ao PUT do storage. */
function fakeFetch({ bytes = 1000, putStatus = 200 } = {}) {
  return jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).startsWith('file://')) {
      return { blob: async () => ({ size: bytes }) } as unknown as Response;
    }
    expect(init?.method).toBe('PUT');
    return { ok: putStatus < 400, status: putStatus } as Response;
  });
}

describe('foto do perfil: escolha e recorte', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOps.length = 0;
    mockDeleted.length = 0;
  });

  it('galeria com recorte quadrado; cancelar devolve null', async () => {
    mockPicker.launchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: null });
    await expect(pickAvatar('library')).resolves.toBeNull();
    expect(mockPicker.launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({ allowsEditing: true, aspect: [1, 1], mediaTypes: ['images'] }),
    );
    expect(mockPicker.requestCameraPermissionsAsync).not.toHaveBeenCalled();
  });

  it('corta o centro em quadrado exato e reduz para 512 px em JPEG', async () => {
    mockPicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///picked.jpg', width: 1001, height: 1000 }],
    });
    await expect(pickAvatar('library')).resolves.toEqual({ uri: 'file:///cache/avatar.jpg' });
    expect(mockOps).toEqual([
      { crop: { originX: 0, originY: 0, width: 1000, height: 1000 } },
      { resize: { width: 512, height: 512 } },
      { save: expect.objectContaining({ format: 'jpeg' }) },
      'release image',
      'release context',
    ]);
    // O recorte que o seletor gravou no cache sai logo; fica só o JPEG a enviar.
    expect(mockDeleted).toEqual(['file:///picked.jpg']);
  });

  it('câmera sem permissão explica o que fazer', async () => {
    mockPicker.requestCameraPermissionsAsync.mockResolvedValue({ granted: false });
    await expect(pickAvatar('camera')).rejects.toBeInstanceOf(AvatarError);
    expect(mockPicker.launchCameraAsync).not.toHaveBeenCalled();
  });
});

describe('foto do perfil: envio (POST uploads → PUT → PUT /v1/me/avatar)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDeleted.length = 0;
  });

  it('pede a URL na hora, envia com os headers devolvidos e registra a chave', async () => {
    mockCreateUpload.mockResolvedValue(UPLOAD);
    mockSetAvatar.mockResolvedValue({ avatarUrl: 'https://cdn.example/users/u1/avatar/abc.jpg' });
    const fetcher = fakeFetch({ bytes: 48_000 });

    await expect(uploadAvatar({ uri: 'file:///cache/avatar.jpg' }, fetcher)).resolves.toBe(
      'https://cdn.example/users/u1/avatar/abc.jpg',
    );
    expect(mockCreateUpload).toHaveBeenCalledWith({ contentType: 'image/jpeg', size: 48_000 });
    expect(fetcher).toHaveBeenLastCalledWith(UPLOAD.uploadUrl, {
      method: 'PUT',
      headers: UPLOAD.headers,
      body: { size: 48_000 },
    });
    expect(mockSetAvatar).toHaveBeenCalledWith({ key: UPLOAD.key });
    expect(mockDeleted).toEqual(['file:///cache/avatar.jpg']);
  });

  it('acima de 2 MB não chega a pedir a URL', async () => {
    const fetcher = fakeFetch({ bytes: AVATAR_MAX_BYTES + 1 });
    await expect(uploadAvatar({ uri: 'file:///x.jpg' }, fetcher)).rejects.toMatchObject({
      code: 'IMAGE_TOO_LARGE',
    });
    expect(mockCreateUpload).not.toHaveBeenCalled();
  });

  it('falha no PUT do storage não registra a chave', async () => {
    mockCreateUpload.mockResolvedValue(UPLOAD);
    await expect(
      uploadAvatar({ uri: 'file:///x.jpg' }, fakeFetch({ putStatus: 403 })),
    ).rejects.toMatchObject({ code: 'UPLOAD_FAILED' });
    expect(mockSetAvatar).not.toHaveBeenCalled();
    // Com falha, o JPEG local também é apagado.
    expect(mockDeleted).toEqual(['file:///x.jpg']);
  });

  it.each([
    ['STORAGE_UNAVAILABLE', 503],
    ['TOO_MANY_REQUESTS', 429],
  ])('erro %s no pedido da URL sobe para a tela', async (code, status) => {
    mockCreateUpload.mockRejectedValue(new ApiError({ status, code, message: 'x' }));
    await expect(uploadAvatar({ uri: 'file:///x.jpg' }, fakeFetch())).rejects.toMatchObject({
      code,
    });
  });

  it('IMAGE_NOT_SQUARE no registro sobe para a tela', async () => {
    mockCreateUpload.mockResolvedValue(UPLOAD);
    mockSetAvatar.mockRejectedValue(
      new ApiError({ status: 422, code: 'IMAGE_NOT_SQUARE', message: 'x' }),
    );
    await expect(uploadAvatar({ uri: 'file:///x.jpg' }, fakeFetch())).rejects.toMatchObject({
      code: 'IMAGE_NOT_SQUARE',
    });
  });
});
