import { Tabs } from 'expo-router';
import {
  Building2,
  CalendarDays,
  Compass,
  Map as MapIcon,
  Trophy,
  User,
} from 'lucide-react-native';
import { TabHeader } from '@/components/tab-header';
import { useIsManager } from '@/features/auth/session';
import { NotificationBell } from '@/features/notifications/notification-bell';
import { EntryGate } from '@/features/onboarding/entry-gate';
import { FEATURES } from '@/lib/features';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';

export default function TabsLayout() {
  const name = useThemeName();
  const isManager = useIsManager();

  return (
    <>
      <EntryGate />
      <Tabs
        screenOptions={{
          // Mesmo cabeçalho em todas as abas; só Explorar troca o título pela logo.
          header: ({ route, options }) => (
            <TabHeader
              title={options.title ?? ''}
              logo={route.name === 'index'}
              right={<NotificationBell />}
              testID={route.name === 'index' ? 'explorar-logo' : `${route.name}-titulo`}
            />
          ),
          tabBarActiveTintColor: color(name, 'primary'),
          tabBarInactiveTintColor: color(name, 'mutedForeground'),
          // Ativo em `primary` (Mar no claro, Sol no escuro, como a ação principal da prancha 07);
          // a barra fica na superfície `card`, acima do fundo.
          tabBarLabelStyle: { fontFamily: 'InterMedium', fontSize: 12 },
          tabBarStyle: {
            backgroundColor: color(name, 'card'),
            borderTopColor: color(name, 'border'),
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            tabBarButtonTestID: 'tab-explorar',
            title: 'Explorar',
            tabBarIcon: ({ color, size }) => <Compass color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="mapa"
          options={{
            tabBarButtonTestID: 'tab-mapa',
            title: 'Mapa',
            tabBarIcon: ({ color, size }) => <MapIcon color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="agenda"
          options={{
            tabBarButtonTestID: 'tab-agenda',
            title: 'Agenda',
            tabBarIcon: ({ color, size }) => <CalendarDays color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="torneios"
          options={{
            tabBarButtonTestID: 'tab-torneios',
            title: 'Torneios',
            href: FEATURES.tournaments ? undefined : null,
            tabBarIcon: ({ color, size }) => <Trophy color={color} size={size} />,
          }}
        />
        {/* Só aparece para gestão; `href: null` esconde a aba (a autorização real é da API). */}
        <Tabs.Screen
          name="meu-espaco"
          options={{
            tabBarButtonTestID: 'tab-meu-espaco',
            title: 'Meu Espaço',
            href: isManager ? undefined : null,
            tabBarIcon: ({ color, size }) => <Building2 color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="perfil"
          options={{
            tabBarButtonTestID: 'tab-perfil',
            title: 'Perfil',
            tabBarIcon: ({ color, size }) => <User color={color} size={size} />,
          }}
        />
      </Tabs>
    </>
  );
}
