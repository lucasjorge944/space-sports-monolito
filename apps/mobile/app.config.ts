import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ExpoConfig } from 'expo/config';
// Fonte TS do token, não o `dist/` do pacote: o EAS lê esta config logo depois do `pnpm install`,
// antes do `eas-build-post-install` compilar o workspace. O Node (>= 22.18) remove os tipos sozinho.
import { brandColors } from '../../packages/ui-tokens/src/colors.ts';

/**
 * Configuração do app (Expo + EAS). Cores da marca de `packages/ui-tokens` (sem hex aqui).
 *
 * Variáveis lidas aqui (ver README, "Build (EAS)"); vazias, a chave correspondente fica de fora.
 * No build na nuvem vêm das variáveis do EAS (por environment); em `expo config` e no eas-cli
 * local precisam estar exportadas no shell (o eas-cli não lê o `.env`).
 * - `EAS_PROJECT_ID` / `EXPO_OWNER`: projeto no EAS (o push precisa do `projectId`; no worker do
 *   EAS, sem `EAS_PROJECT_ID`, vale o `EAS_BUILD_PROJECT_ID` que o build define);
 * - `GOOGLE_MAPS_ANDROID_API_KEY`: mapa no Android. Sem ela o build sai, só o mapa não carrega;
 * - `GOOGLE_SERVICES_JSON`: caminho do `google-services.json` (variável de arquivo do EAS), para o
 *   push no Android (FCM). Sem ela vale `./google-services.json` se existir (fora do git).
 */
function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

const APP_ID = 'br.com.spacesports.app';

// No worker do EAS vale também o id que o próprio build informa (`EAS_BUILD_PROJECT_ID`).
const projectId = env('EAS_PROJECT_ID') ?? env('EAS_BUILD_PROJECT_ID');
const owner = env('EXPO_OWNER');
const googleMapsApiKey = env('GOOGLE_MAPS_ANDROID_API_KEY');
const googleServicesFile =
  env('GOOGLE_SERVICES_JSON') ??
  (existsSync(join(__dirname, 'google-services.json')) ? './google-services.json' : undefined);

const config: ExpoConfig = {
  name: 'Space Sports',
  slug: 'space-sports',
  ...(owner ? { owner } : {}),
  // O número do build (versionCode/buildNumber) fica com o EAS (`appVersionSource: remote`).
  version: '0.1.0',
  runtimeVersion: { policy: 'appVersion' },
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'spacesports',
  userInterfaceStyle: 'automatic',
  // Mapa no iOS: Apple Maps, o provedor padrão do react-native-maps (nenhum MapView força o Google).
  ios: {
    bundleIdentifier: APP_ID,
  },
  android: {
    package: APP_ID,
    // O app só escreve no calendário (expo-calendar com `writeOnlyAccess`). A foto do perfil usa
    // o seletor de fotos do sistema, que não precisa de leitura do armazenamento, e não grava vídeo
    // (sem microfone). Ficam a câmera (CAMERA) e o WRITE_EXTERNAL_STORAGE que o expo-image-picker
    // declara só até o Android 12 (`maxSdkVersion` 32): a câmera dele exige essa permissão no
    // Android 7 a 9.
    blockedPermissions: [
      'android.permission.READ_CALENDAR',
      'android.permission.WRITE_CALENDAR',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.RECORD_AUDIO',
    ],
    adaptiveIcon: {
      backgroundColor: brandColors.mar,
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    // A chave vai em `android.config.googleMaps` (o Expo grava a meta-data no manifesto).
    ...(googleMapsApiKey ? { config: { googleMaps: { apiKey: googleMapsApiKey } } } : {}),
    ...(googleServicesFile ? { googleServicesFile } : {}),
  },
  web: {
    output: 'single',
    bundler: 'metro',
    favicon: './assets/images/favicon.png',
  },
  // Não adicione 'react-native-maps' aqui: sem a opção `androidGoogleMapsApiKey`, o config plugin
  // dele remove do manifesto a meta-data `com.google.android.geo.API_KEY` que o Expo gravou a
  // partir de `android.config.googleMaps.apiKey`, e o mapa Android fica em branco.
  plugins: [
    'expo-router',
    [
      'expo-build-properties',
      {
        android: {
          // O SDK 58 liga o R8 no release. Sem esta regra, ele remove o construtor
          // do banco Room do WorkManager (WorkDatabase_Impl), que é criado por
          // reflexão, e o app fecha ao abrir (androidx.startup.InitializationProvider).
          extraProguardRules: '-keep class * extends androidx.room.RoomDatabase { <init>(); }',
        },
      },
    ],
    [
      'expo-splash-screen',
      {
        image: './assets/images/splash-icon.png',
        imageWidth: 200,
        resizeMode: 'contain',
        backgroundColor: brandColors.mar,
        dark: {
          image: './assets/images/splash-icon.png',
          backgroundColor: brandColors.noite,
        },
      },
    ],
    'expo-secure-store',
    'expo-web-browser',
    'expo-image',
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'O Space Sports usa a sua localização para mostrar os espaços mais próximos e a distância até eles.',
      },
    ],
    [
      'expo-notifications',
      {
        // Ícone da barra de notificações do Android: o símbolo monocromático (branco com
        // transparência) do ícone adaptativo, tingido com a cor Mar.
        icon: './assets/images/android-icon-monochrome.png',
        color: brandColors.mar,
      },
    ],
    [
      // Foto do perfil (RF-AUTH-02): câmera ou fotos, com recorte quadrado. Só imagem: sem microfone.
      'expo-image-picker',
      {
        photosPermission:
          'O Space Sports acessa as suas fotos para você escolher a foto do perfil.',
        cameraPermission: 'O Space Sports usa a câmera para você tirar a foto do perfil.',
        microphonePermission: false,
      },
    ],
    [
      'expo-calendar',
      {
        writeOnlyAccess: true,
        writeOnlyCalendarPermission: 'O Space Sports adiciona suas reservas ao calendário.',
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  ...(projectId ? { extra: { eas: { projectId } } } : {}),
};

export default config;
