import { SlidersHorizontal } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';
import { FiltersSheet } from './filters-sheet';
import {
  countActiveFilters,
  type FiltersContext,
  type SpaceFilters,
  setFilters,
} from './filters-store';

/** Busca por nome + botão de filtros; compartilhado por Explorar e Mapa (`context: 'map'`). */
export function SearchHeader({
  filters,
  context = 'list',
}: {
  filters: SpaceFilters;
  context?: FiltersContext;
}) {
  const name = useThemeName();
  const [open, setOpen] = useState(false);
  const active = countActiveFilters(filters, context);

  return (
    <View className="flex-row items-center gap-2">
      <Input
        testID="busca-espaco-input"
        className="flex-1"
        placeholder="Buscar espaço pelo nome"
        accessibilityLabel="Buscar espaço pelo nome"
        value={filters.q}
        onChangeText={(q) => setFilters({ q })}
        returnKeyType="search"
        autoCorrect={false}
        clearButtonMode="while-editing"
      />
      <Pressable
        testID="busca-filtros"
        role="button"
        accessibilityLabel={
          active > 0 ? `Filtros, ${active} ${active === 1 ? 'ativo' : 'ativos'}` : 'Filtros'
        }
        className="h-11 w-11 items-center justify-center rounded-md border border-input bg-background active:bg-accent"
        onPress={() => setOpen(true)}
      >
        <SlidersHorizontal size={20} color={color(name, 'foreground')} />
        {active > 0 ? (
          <Badge variant="default" className="absolute -right-1.5 -top-1.5 px-1.5 py-0.5">
            <Text>{active}</Text>
          </Badge>
        ) : null}
      </Pressable>
      <FiltersSheet
        visible={open}
        onClose={() => setOpen(false)}
        filters={filters}
        context={context}
      />
    </View>
  );
}
