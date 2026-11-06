import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Logo } from '@/components/logo';
import { Text } from '@/components/ui/text';

/** Casca das telas de auth: área segura, teclado e rolagem; logo vertical, título e subtítulo no topo. */
export function AuthLayout({
  title,
  subtitle,
  testID,
  children,
}: {
  title: string;
  subtitle?: string;
  testID?: string;
  children: ReactNode;
}) {
  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerClassName="flex-grow gap-6 px-6 py-8"
          keyboardShouldPersistTaps="handled"
        >
          <View className="items-center pt-2">
            <Logo variant="vertical" width={144} testID="auth-logo" />
          </View>
          <View className="gap-2">
            <Text variant="h3" testID={testID}>
              {title}
            </Text>
            {subtitle ? <Text variant="muted">{subtitle}</Text> : null}
          </View>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
