import { type Device, registerDevice, removeDevice } from '@space-sports/api-client';
import Constants from 'expo-constants';
import * as ExpoDevice from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { getStored, removeStored, STORAGE_KEYS, setStored } from '@/lib/storage';

const ANDROID_CHANNEL_ID = 'default';

/** `projectId` do EAS (necessário para o token push em builds próprios); ausente em dev local. */
function easProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

/**
 * Pede a permissão de notificações (uma vez) e devolve o token Expo, ou `null` se não der:
 * simulador, permissão negada ou projeto EAS ainda não configurado.
 */
async function getPushToken(): Promise<string | null> {
  if (Platform.OS === 'web' || !ExpoDevice.isDevice) return null;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: 'Notificações',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    ({ status } = await Notifications.requestPermissionsAsync());
  }
  if (status !== 'granted') return null;
  const projectId = easProjectId();
  const token = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  return token.data;
}

/**
 * Registra o aparelho para push (`PUT /v1/me/devices`, idempotente por token) e guarda o id para
 * remover no logout. Nunca lança: push é um extra, não pode travar o login.
 */
export async function registerPushDevice(): Promise<Device | null> {
  try {
    const token = await getPushToken();
    if (!token) return null;
    const device = await registerDevice({
      expoPushToken: token,
      platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID',
    });
    await setStored(STORAGE_KEYS.pushDeviceId, device.id);
    return device;
  } catch {
    return null;
  }
}

/**
 * Remove o token deste aparelho (`DELETE /v1/me/devices/:id`) para a conta que sai não receber
 * mais push dele. Chamar ANTES de apagar o token da sessão. Nunca lança.
 */
export async function unregisterPushDevice(): Promise<void> {
  const id = await getStored(STORAGE_KEYS.pushDeviceId);
  if (!id) return;
  try {
    await removeDevice(id);
  } catch (error) {
    // 404: já não existia (limpo pelo servidor). Outras falhas (sem rede): o servidor limpa o
    // token quando o Expo devolver DeviceNotRegistered.
    void error;
  }
  await removeStored(STORAGE_KEYS.pushDeviceId);
}
