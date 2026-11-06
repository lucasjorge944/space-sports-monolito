import { SpaceAvatar } from './space-avatar';

/**
 * Foto do perfil (RF-AUTH-02) em círculo, pelo expo-image (com cache); sem foto, ou se ela não
 * carregar, as iniciais do nome. Mesmo visual da logo do espaço. Decorativa: o nome aparece ao lado.
 */
export function UserAvatar({
  name,
  avatarUrl,
  size = 64,
  testID = 'perfil-foto',
}: {
  name: string;
  avatarUrl: string | null;
  size?: number;
  testID?: string;
}) {
  return <SpaceAvatar name={name} logoUrl={avatarUrl} size={size} testID={testID} />;
}
