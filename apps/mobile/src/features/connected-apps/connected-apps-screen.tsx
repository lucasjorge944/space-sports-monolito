import type { ConnectedAppListItemsItem } from '@space-sports/api-client';
import * as Clipboard from 'expo-clipboard';
import { Bot, Check, Copy } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Alert, FlatList, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/screen-header';
import { ErrorView, InlineError } from '@/components/state-views';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { useIsManager } from '@/features/auth/session';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';
import {
  connectedAtLabel,
  disconnectConfirmation,
  expiresAtLabel,
  lastUsedLabel,
  MCP_CONNECT_URL,
  scopeGroups,
  showScopeGroupTitles,
} from './labels';
import { useConnectedApps, useDisconnectApp } from './use-connected-apps';

function ConnectedAppCard({
  app,
  disconnecting,
  onDisconnect,
}: {
  app: ConnectedAppListItemsItem;
  disconnecting: boolean;
  onDisconnect: (app: ConnectedAppListItemsItem) => void;
}) {
  const name = useThemeName();
  const groups = scopeGroups(app.scopes);
  const titles = showScopeGroupTitles(groups);
  const expires = expiresAtLabel(app.expiresAt);
  return (
    <View
      testID={`apps-conectados-item-${app.id}`}
      className="gap-3 rounded-lg border border-border bg-card p-4"
    >
      <View className="flex-row items-center gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-full bg-muted">
          <Bot size={20} color={color(name, 'mutedForeground')} aria-hidden />
        </View>
        <View className="flex-1">
          <Text numberOfLines={2} className="text-base font-semibold text-foreground">
            {app.name}
          </Text>
          {app.host ? (
            <Text variant="muted" numberOfLines={1} testID={`apps-conectados-host-${app.id}`}>
              {app.host}
            </Text>
          ) : (
            <Text
              variant="muted"
              numberOfLines={1}
              testID={`apps-conectados-sem-dominio-${app.id}`}
            >
              Domínio não verificado
            </Text>
          )}
        </View>
      </View>
      <View
        testID={`apps-conectados-conector-${app.id}`}
        className="self-start rounded-full bg-muted px-3 py-1"
      >
        <Text className="text-xs font-medium text-foreground">Conector: {app.resource.name}</Text>
      </View>
      <View className="gap-2">
        <Text variant="overline">Pode</Text>
        {groups.map(({ group, title, labels }) => (
          <View key={group} testID={`apps-conectados-grupo-${group}-${app.id}`} className="gap-1">
            {titles ? <Text className="text-sm font-semibold text-foreground">{title}</Text> : null}
            {labels.map((label) => (
              <Text key={label} className="text-sm">
                • {label}
              </Text>
            ))}
          </View>
        ))}
      </View>
      <View className="gap-0.5">
        <Text variant="muted" testID={`apps-conectados-conectado-${app.id}`}>
          {connectedAtLabel(app.authorizedAt)}
        </Text>
        <Text variant="muted" testID={`apps-conectados-ultimo-uso-${app.id}`}>
          {lastUsedLabel(app.lastUsedAt)}
        </Text>
        {expires ? (
          <Text
            variant="muted"
            testID={`apps-conectados-expira-${app.id}`}
            className={expires.expired ? 'text-destructive' : undefined}
          >
            {expires.text}
          </Text>
        ) : null}
      </View>
      <Button
        testID={`apps-conectados-desconectar-${app.id}`}
        variant="outline"
        className="border-destructive"
        disabled={disconnecting}
        accessibilityLabel={`Desconectar ${app.name}`}
        onPress={() => onDisconnect(app)}
      >
        <Text className="text-destructive">{disconnecting ? 'Desconectando…' : 'Desconectar'}</Text>
      </Button>
    </View>
  );
}

/** Estado vazio: explica o que dá para fazer e mostra o link do conector para copiar. */
function EmptyConnectedApps() {
  const name = useThemeName();
  const isManager = useIsManager();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = () => {
    void Clipboard.setStringAsync(MCP_CONNECT_URL);
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };
  const Icon = copied ? Check : Copy;

  return (
    <View testID="apps-conectados-vazio" className="gap-4 p-4">
      <View className="items-center gap-2">
        <Text variant="large" className="text-center">
          Nenhum app conectado
        </Text>
        <Text variant="muted" className="text-center">
          Você pode usar o Space Sports pelo Claude e por outros assistentes: buscar espaços, ver
          horários, reservar e cancelar quadras e confirmar presença em aulas, só conversando. Para
          conectar, adicione o conector abaixo no assistente e entre com a sua conta do Space
          Sports.
        </Text>
        {isManager ? (
          <Text variant="muted" testID="apps-conectados-vazio-equipe" className="text-center">
            Como você faz parte da equipe de um espaço, pelo mesmo conector também dá para consultar
            os dados do espaço, como agenda, reservas e aulas. O assistente só mostra o que a sua
            função já permite ver no painel.
          </Text>
        ) : null}
      </View>
      <View className="gap-2 rounded-lg border border-border bg-card p-4">
        <Text variant="overline">Link do conector</Text>
        <Text selectable testID="apps-conectados-link" className="text-sm text-link">
          {MCP_CONNECT_URL}
        </Text>
        <Button
          testID="apps-conectados-copiar"
          variant="outline"
          onPress={copy}
          accessibilityLabel="Copiar link do conector"
        >
          <Icon size={18} color={color(name, 'foreground')} aria-hidden />
          <Text>{copied ? 'Copiado!' : 'Copiar link'}</Text>
        </Button>
      </View>
    </View>
  );
}

/**
 * Apps conectados (RF-MCP-05; docs/14-mcp.md, 3.4), na Conta: os assistentes que a pessoa
 * autorizou a usar o Space Sports (MCP), com o que cada um pode fazer, quando conectou e quando
 * usou por último, e "Desconectar" (com confirmação), que corta o acesso na hora.
 */
export function ConnectedAppsScreen() {
  const query = useConnectedApps();
  const disconnect = useDisconnectApp();
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const items = query.data?.items ?? [];

  const confirmDisconnect = (app: ConnectedAppListItemsItem) => {
    const { title, message } = disconnectConfirmation(app.name);
    Alert.alert(title, message, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Desconectar',
        style: 'destructive',
        onPress: () => {
          setError(null);
          setPendingId(app.id);
          disconnect.mutate(app.id, {
            onError: () => setError('Não foi possível desconectar agora. Tente de novo.'),
            onSettled: () => setPendingId(null),
          });
        },
      },
    ]);
  };

  const empty = query.isPending ? (
    <View className="gap-3" accessibilityLabel="Carregando apps conectados">
      {[0, 1].map((i) => (
        <Skeleton key={i} className="h-48 rounded-lg" />
      ))}
    </View>
  ) : query.isError ? (
    <ErrorView error={query.error} onRetry={() => void query.refetch()} />
  ) : (
    <EmptyConnectedApps />
  );

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <ScreenHeader title="Apps conectados" testID="apps-conectados" />
      <FlatList
        testID="apps-conectados-lista"
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, paddingTop: 8 }}
        ListHeaderComponent={
          items.length > 0 || error ? (
            <View className="gap-3 pb-3">
              {items.length > 0 ? (
                <Text variant="muted">
                  Assistentes que você autorizou a usar o Space Sports em seu nome. Desconectar
                  corta o acesso na hora.
                </Text>
              ) : null}
              <InlineError message={error} />
            </View>
          ) : undefined
        }
        ListEmptyComponent={empty}
        ItemSeparatorComponent={() => <View className="h-3" />}
        renderItem={({ item }) => (
          <ConnectedAppCard
            app={item}
            disconnecting={pendingId === item.id}
            onDisconnect={confirmDisconnect}
          />
        )}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching && pendingId === null}
            onRefresh={() => {
              setError(null);
              void query.refetch();
            }}
          />
        }
      />
    </SafeAreaView>
  );
}
