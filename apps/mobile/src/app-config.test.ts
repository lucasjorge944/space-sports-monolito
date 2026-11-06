import fs from 'node:fs';
import { brandColors } from '@space-sports/ui-tokens';
import type { ExpoConfig } from 'expo/config';

const VARS = [
  'EAS_PROJECT_ID',
  'EAS_BUILD_PROJECT_ID',
  'EXPO_OWNER',
  'GOOGLE_MAPS_ANDROID_API_KEY',
  'GOOGLE_SERVICES_JSON',
] as const;

/** Avalia o `app.config.ts` de novo com as variáveis dadas (as outras ficam vazias). */
function loadConfig(vars: Partial<Record<(typeof VARS)[number], string>> = {}): ExpoConfig {
  const saved = Object.fromEntries(VARS.map((name) => [name, process.env[name]]));
  for (const name of VARS) delete process.env[name];
  Object.assign(process.env, vars);
  try {
    let config: ExpoConfig | undefined;
    jest.isolateModules(() => {
      config = require('../app.config').default;
    });
    return config as ExpoConfig;
  } finally {
    for (const name of VARS) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
}

type PluginEntry = string | [string, Record<string, unknown>];
const pluginOptions = (config: ExpoConfig, name: string) => {
  const entry = (config.plugins as PluginEntry[]).find((p) => Array.isArray(p) && p[0] === name);
  return (entry as [string, Record<string, unknown>] | undefined)?.[1];
};

// O app só abre a tela de evento do sistema: nenhuma permissão de leitura/escrita do calendário
// pode ir para o manifesto (Android) nem pedir acesso total no Info.plist (iOS).
describe('permissões de calendário no app.config.ts', () => {
  const config = loadConfig();

  it('bloqueia READ_CALENDAR e WRITE_CALENDAR no Android', () => {
    expect(config.android?.blockedPermissions).toEqual(
      expect.arrayContaining([
        'android.permission.READ_CALENDAR',
        'android.permission.WRITE_CALENDAR',
      ]),
    );
  });

  it('usa só acesso de escrita (writeOnlyAccess) no iOS', () => {
    expect(pluginOptions(config, 'expo-calendar')?.writeOnlyAccess).toBe(true);
  });
});

// Foto do perfil (RF-AUTH-02): seletor do sistema com recorte, câmera opcional; nada de microfone
// nem de acesso ao armazenamento no Android.
describe('permissões da foto do perfil (expo-image-picker)', () => {
  const config = loadConfig();

  it('explica em português o uso da câmera e das fotos (iOS)', () => {
    const options = pluginOptions(config, 'expo-image-picker');
    expect(options?.photosPermission).toMatch(/foto do perfil/);
    expect(options?.cameraPermission).toMatch(/foto do perfil/);
    expect(options?.microphonePermission).toBe(false);
  });

  it('bloqueia microfone e leitura do armazenamento no Android', () => {
    expect(config.android?.blockedPermissions).toEqual(
      expect.arrayContaining([
        'android.permission.RECORD_AUDIO',
        'android.permission.READ_EXTERNAL_STORAGE',
      ]),
    );
  });

  it('mantém câmera e a escrita (até o Android 12) que a câmera exige no Android 7 a 9', () => {
    expect(config.android?.blockedPermissions).not.toContain('android.permission.CAMERA');
    expect(config.android?.blockedPermissions).not.toContain(
      'android.permission.WRITE_EXTERNAL_STORAGE',
    );
  });
});

describe('configuração de build (EAS)', () => {
  it('identifica o app e deixa o número do build com o EAS', () => {
    const config = loadConfig();
    expect(config.ios?.bundleIdentifier).toBe('br.com.spacesports.app');
    expect(config.android?.package).toBe('br.com.spacesports.app');
    expect(config.version).toBe('0.1.0');
    expect(config.runtimeVersion).toEqual({ policy: 'appVersion' });
    expect(config.scheme).toBe('spacesports');
  });

  it('sem as variáveis, projeto, dono e chave do Maps ficam de fora', () => {
    const config = loadConfig({ EAS_PROJECT_ID: ' ', EXPO_OWNER: '' });
    expect(config.extra?.eas).toBeUndefined();
    expect(config.owner).toBeUndefined();
    expect(config.android?.config?.googleMaps).toBeUndefined();
  });

  it('com as variáveis, preenche projeto, dono e a chave do Maps no Android', () => {
    const config = loadConfig({
      EAS_PROJECT_ID: 'proj-123',
      EXPO_OWNER: 'spacesports',
      GOOGLE_MAPS_ANDROID_API_KEY: 'maps-key',
    });
    expect(config.extra?.eas).toEqual({ projectId: 'proj-123' });
    expect(config.owner).toBe('spacesports');
    expect(config.android?.config?.googleMaps).toEqual({ apiKey: 'maps-key' });
    // iOS segue no Apple Maps (provedor padrão do react-native-maps).
    expect(config.ios?.config?.googleMapsApiKey).toBeUndefined();
  });

  it('no worker do EAS, sem EAS_PROJECT_ID, usa o id do projeto do próprio build', () => {
    expect(loadConfig({ EAS_BUILD_PROJECT_ID: 'proj-build' }).extra?.eas).toEqual({
      projectId: 'proj-build',
    });
  });

  it("nenhum plugin 'react-native-maps' (ele apagaria a chave do Maps do manifesto)", () => {
    const names = (loadConfig().plugins as PluginEntry[]).map((p) => (Array.isArray(p) ? p[0] : p));
    expect(names).not.toContain('react-native-maps');
  });

  it('cores do ícone, da splash e da notificação vêm dos tokens da marca', () => {
    const config = loadConfig();
    expect(config.android?.adaptiveIcon?.backgroundColor).toBe(brandColors.mar);
    const splash = pluginOptions(config, 'expo-splash-screen');
    expect(splash?.backgroundColor).toBe(brandColors.mar);
    expect(splash?.dark).toEqual(expect.objectContaining({ backgroundColor: brandColors.noite }));
    expect(pluginOptions(config, 'expo-notifications')).toEqual({
      icon: './assets/images/android-icon-monochrome.png',
      color: brandColors.mar,
    });
  });
});

describe('google-services.json (push no Android, FCM)', () => {
  const googleServicesPath = expect.stringMatching(/[/\\]google-services\.json$/);
  afterEach(() => jest.restoreAllMocks());

  it('usa o arquivo da variável GOOGLE_SERVICES_JSON (variável de arquivo do EAS)', () => {
    const exists = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    const config = loadConfig({ GOOGLE_SERVICES_JSON: '/eas/env/google-services.json' });
    expect(config.android?.googleServicesFile).toBe('/eas/env/google-services.json');
    expect(exists).not.toHaveBeenCalledWith(googleServicesPath);
  });

  it('sem a variável, usa ./google-services.json quando o arquivo existe', () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    expect(loadConfig().android?.googleServicesFile).toBe('./google-services.json');
  });

  it('sem variável nem arquivo, o campo fica de fora', () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    expect(loadConfig({ GOOGLE_SERVICES_JSON: ' ' }).android).not.toHaveProperty(
      'googleServicesFile',
    );
  });
});
