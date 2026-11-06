import { DarkTheme, DefaultTheme, ThemeProvider as NavThemeProvider } from 'expo-router';
import { useColorScheme, vars } from 'nativewind';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { color, cssVars, type ThemeName } from './theme';

/** Tema ativo, seguindo o esquema de cores do sistema. */
export function useThemeName(): ThemeName {
  return useColorScheme().colorScheme === 'dark' ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const name = useThemeName();
  const base = name === 'dark' ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: {
      ...base.colors,
      background: color(name, 'background'),
      card: color(name, 'background'),
      text: color(name, 'foreground'),
      border: color(name, 'border'),
      primary: color(name, 'primary'),
    },
  };

  return (
    <View style={vars(cssVars(name))} className="flex-1 bg-background">
      <NavThemeProvider value={navTheme}>{children}</NavThemeProvider>
    </View>
  );
}
