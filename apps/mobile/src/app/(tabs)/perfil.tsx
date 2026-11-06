import { useRouter } from 'expo-router';
import {
  CalendarClock,
  GraduationCap,
  Heart,
  KeyRound,
  Receipt,
  SlidersHorizontal,
  Star,
  Trash2,
  UserPen,
  UserX,
} from 'lucide-react-native';
import type { ComponentType } from 'react';
import { ScrollView, View } from 'react-native';
import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { UserAvatar } from '@/components/user-avatar';
import { MenuRow } from '@/features/account/menu-row';
import { useMe, useSession } from '@/features/auth/session';
import { formatPhone } from '@/features/auth/validation';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';

type Icon = ComponentType<{ size?: number; color?: string }>;

export default function PerfilScreen() {
  const router = useRouter();
  const me = useMe();
  const { signOut } = useSession();
  const name = useThemeName();
  const icon = (Icon: Icon, token: 'foreground' | 'destructive' = 'foreground') => (
    <Icon size={20} color={color(name, token)} />
  );

  return (
    <Screen>
      <ScrollView contentContainerClassName="gap-4 pb-8">
        <View className="flex-row items-center gap-4">
          <UserAvatar name={me.name} avatarUrl={me.avatarUrl} size={64} />
          <View className="flex-1 gap-1">
            <Text variant="large" testID="perfil-nome">
              {me.name}
            </Text>
            {me.email ? <Text variant="muted">{me.email}</Text> : null}
            {me.phone ? <Text variant="muted">{formatPhone(me.phone)}</Text> : null}
          </View>
        </View>
        {me.email && !me.emailVerified ? (
          <Button variant="outline" onPress={() => router.push('/verificar-email')}>
            <Text>Confirmar e-mail</Text>
          </Button>
        ) : null}
        <View className="rounded-lg border border-border bg-card px-3 py-1">
          <MenuRow
            icon={icon(UserPen)}
            label="Editar perfil"
            testID="perfil-editar"
            onPress={() => router.push('/editar-perfil')}
          />
          <MenuRow
            icon={icon(KeyRound)}
            label="Alterar senha"
            testID="perfil-alterar-senha"
            onPress={() => router.push('/alterar-senha')}
          />
          <MenuRow icon={icon(Heart)} label="Favoritos" onPress={() => router.push('/favoritos')} />
          <MenuRow
            icon={icon(CalendarClock)}
            label="Meus mensalistas"
            onPress={() => router.push('/mensalistas')}
          />
          <MenuRow
            icon={icon(GraduationCap)}
            label="Meus planos de aula"
            testID="perfil-meus-planos"
            onPress={() => router.push('/planos')}
          />
          <MenuRow
            icon={icon(Receipt)}
            label="Meus pagamentos"
            testID="perfil-meus-pagamentos"
            onPress={() => router.push('/meus-pagamentos')}
          />
          <MenuRow
            icon={icon(Star)}
            label="Minhas avaliações"
            testID="perfil-minhas-avaliacoes"
            onPress={() => router.push('/minhas-avaliacoes')}
          />
          <MenuRow
            icon={icon(SlidersHorizontal)}
            label="Preferências de notificação"
            onPress={() => router.push('/preferencias-notificacoes')}
          />
        </View>
        <Button variant="outline" onPress={() => void signOut()} accessibilityLabel="Sair da conta">
          <Text>Sair</Text>
        </Button>
        <View className="rounded-lg border border-border bg-card px-3 py-1">
          <MenuRow
            icon={icon(UserX, 'destructive')}
            label="Inativar minha conta"
            destructive
            onPress={() => router.push('/inativar-conta')}
          />
          <MenuRow
            icon={icon(Trash2, 'destructive')}
            label="Excluir minha conta"
            destructive
            onPress={() => router.push('/excluir-conta')}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}
