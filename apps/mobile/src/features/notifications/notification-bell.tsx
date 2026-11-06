import { useFocusEffect, useRouter } from 'expo-router';
import { Bell } from 'lucide-react-native';
import { useCallback } from 'react';
import { Pressable } from 'react-native';
import { Badge } from '@/components/ui/badge';
import { Text } from '@/components/ui/text';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';
import { useRefreshUnreadCount, useUnreadCount } from './use-notifications';

/** Rótulo do selo: acima de 99, "99+", para caber no sino. */
export function unreadBadge(count: number): string {
  return count > 99 ? '99+' : String(count);
}

/** Sino do cabeçalho das abas (RF-NOTIF-04): abre a central e relê o contador ao voltar. */
export function NotificationBell() {
  const router = useRouter();
  const name = useThemeName();
  const unread = useUnreadCount();
  const refresh = useRefreshUnreadCount();
  useFocusEffect(useCallback(() => void refresh(), [refresh]));

  return (
    <Pressable
      testID="notificacoes-sino"
      role="button"
      accessibilityLabel={
        unread > 0 ? `Notificações, ${unread} não lida${unread > 1 ? 's' : ''}` : 'Notificações'
      }
      className="h-11 w-11 items-center justify-center rounded-full active:bg-accent"
      onPress={() => router.push('/notificacoes')}
    >
      <Bell size={24} color={color(name, 'foreground')} />
      {unread > 0 ? (
        <Badge variant="default" className="absolute right-0 top-0 px-1.5 py-0">
          <Text testID="notificacoes-contador" className="text-xs">
            {unreadBadge(unread)}
          </Text>
        </Badge>
      ) : null}
    </Pressable>
  );
}
