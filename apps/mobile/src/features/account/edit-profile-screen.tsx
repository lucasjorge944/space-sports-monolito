import { maskPhone } from '@space-sports/shared';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Camera, ImageIcon } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BottomSheet, useMenuSheet } from '@/components/bottom-sheet';
import { ScreenHeader } from '@/components/screen-header';
import { InlineError } from '@/components/state-views';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { UserAvatar } from '@/components/user-avatar';
import { useAuthActions } from '@/features/auth/actions';
import { Field, FormError } from '@/features/auth/components/field';
import { useFormField, validateFields } from '@/features/auth/components/use-form-field';
import { authErrorField, authErrorMessage } from '@/features/auth/errors';
import { useMe, useSession } from '@/features/auth/session';
import { phoneToE164, validateName, validatePhone } from '@/features/auth/validation';
import { AboutYouFields, useAboutYou } from '@/features/profile/about-you';
import {
  AvatarError,
  type AvatarSource,
  pickAvatar,
  removeAvatar,
  uploadAvatar,
} from '@/features/profile/avatar';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';

/**
 * Editar perfil (RF-AUTH-02, decisões 67 a 69): foto, nome, telefone, e-mail (só leitura, com o
 * reenvio da verificação), nascimento, gênero e esportes favoritos com nível. A foto é salva na
 * hora; o resto vai num `PATCH /v1/me/profile` ao tocar em Salvar. O /me é relido para refletir
 * em todo o app.
 */
export function EditProfileScreen() {
  const router = useRouter();
  const me = useMe();
  const { refresh } = useSession();
  const { updateProfile } = useAuthActions();
  const name = useFormField({ initial: me.name, validate: validateName });
  const initialPhone = me.phone ? maskPhone(me.phone) : '';
  const phone = useFormField({
    initial: initialPhone,
    // Só valida o que a pessoa mudou: conta antiga com número estrangeiro não fica travada.
    validate: (value) => (value === initialPhone ? null : validatePhone(value)),
    format: maskPhone,
  });
  const about = useAboutYou(me);

  const mutation = useMutation({
    mutationFn: async () => {
      const nextName = name.value.trim();
      const nextPhone = phoneToE164(phone.value);
      await updateProfile({
        // Só o que mudou: reenviar o mesmo telefone não pode desfazer uma verificação.
        ...(nextName !== me.name ? { name: nextName } : {}),
        ...(nextPhone && nextPhone !== me.phone ? { phone: nextPhone } : {}),
        ...about.toInput(),
      });
      await refresh();
    },
    onSuccess: () => router.back(),
    onError: (error) => {
      if (authErrorField(error) === 'phone') phone.setError(authErrorMessage(error));
    },
  });

  const submit = () => {
    const fieldsOk = validateFields([name, phone]);
    const aboutOk = about.validate();
    if (fieldsOk && aboutOk) mutation.mutate();
  };

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <ScreenHeader title="Editar perfil" />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerClassName="gap-6 p-4 pb-10" keyboardShouldPersistTaps="handled">
          <AvatarSection />
          <FormError
            message={
              mutation.error && authErrorField(mutation.error) !== 'phone'
                ? authErrorMessage(mutation.error)
                : null
            }
          />
          <View className="gap-4">
            <Field
              label="Nome"
              {...name.bind}
              testID="editar-perfil-nome"
              autoComplete="name"
              textContentType="name"
              autoCapitalize="words"
              editable={!mutation.isPending}
            />
            <Field
              label="Telefone com DDD"
              {...phone.bind}
              testID="editar-perfil-telefone"
              placeholder="(31) 99999-8888"
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              editable={!mutation.isPending}
            />
            <EmailRow />
          </View>
          <AboutYouFields state={about} disabled={mutation.isPending} />
          <Button testID="editar-perfil-salvar" onPress={submit} disabled={mutation.isPending}>
            <Text>{mutation.isPending ? 'Salvando…' : 'Salvar'}</Text>
          </Button>
          <View className="gap-2 border-t border-border pt-4">
            <Text variant="small">Senha</Text>
            <Button
              variant="outline"
              testID="editar-perfil-alterar-senha"
              onPress={() => router.push('/alterar-senha')}
            >
              <Text>Alterar senha</Text>
            </Button>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Mensagem do erro da foto: as locais (permissão, tamanho) já vêm prontas; as da API, pelo code. */
function avatarErrorMessage(error: unknown): string {
  return error instanceof AvatarError ? error.message : authErrorMessage(error);
}

function AvatarSection() {
  const me = useMe();
  const { refresh } = useSession();
  const theme = useThemeName();
  // Prévia local enquanto a foto sobe; some quando o /me traz a URL nova (ou se falhar).
  const [preview, setPreview] = useState<string | null>(null);

  const change = useMutation({
    mutationFn: async (source: AvatarSource) => {
      const picked = await pickAvatar(source);
      if (!picked) return;
      setPreview(picked.uri);
      try {
        await uploadAvatar(picked);
        await refresh();
      } finally {
        setPreview(null);
      }
    },
  });
  const remove = useMutation({
    mutationFn: async () => {
      await removeAvatar();
      await refresh();
    },
  });
  const busy = change.isPending || remove.isPending;

  // O seletor de imagem abre só depois que a folha some: no iOS, ele não abre no mesmo toque em que
  // o Modal da folha está fechando. Toques durante o fechamento são ignorados (useMenuSheet).
  const sheet = useMenuSheet<AvatarSource>((source) => {
    remove.reset();
    change.mutate(source);
  });

  const confirmRemove = () =>
    Alert.alert('Remover foto?', 'Seu perfil volta a mostrar as iniciais do nome.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover',
        style: 'destructive',
        onPress: () => {
          change.reset();
          remove.mutate();
        },
      },
    ]);

  const error = change.error ?? remove.error;
  return (
    <View className="items-center gap-3">
      <UserAvatar
        name={me.name}
        avatarUrl={preview ?? me.avatarUrl}
        size={96}
        testID="editar-perfil-foto"
      />
      {change.isPending && preview ? <Text variant="muted">Enviando foto…</Text> : null}
      {remove.isPending ? <Text variant="muted">Removendo foto…</Text> : null}
      <View className="flex-row flex-wrap justify-center gap-2">
        <Button
          variant="outline"
          size="sm"
          testID="editar-perfil-foto-trocar"
          disabled={busy}
          onPress={sheet.open}
        >
          <Text>{me.avatarUrl ? 'Trocar foto' : 'Adicionar foto'}</Text>
        </Button>
        {me.avatarUrl ? (
          <Button
            variant="ghost"
            size="sm"
            testID="editar-perfil-foto-remover"
            disabled={busy}
            onPress={confirmRemove}
          >
            <Text>Remover foto</Text>
          </Button>
        ) : null}
      </View>
      {error ? <InlineError message={avatarErrorMessage(error)} /> : null}
      {sheet.mounted ? (
        <BottomSheet
          visible={sheet.visible}
          title="Foto do perfil"
          onClose={sheet.close}
          onDismissed={sheet.onDismissed}
        >
          <Text variant="muted">A foto é recortada em quadrado.</Text>
          <Button
            variant="outline"
            testID="editar-perfil-foto-camera"
            onPress={() => sheet.choose('camera')}
          >
            <Camera size={18} color={color(theme, 'foreground')} />
            <Text>Tirar foto</Text>
          </Button>
          <Button
            variant="outline"
            testID="editar-perfil-foto-galeria"
            onPress={() => sheet.choose('library')}
          >
            <ImageIcon size={18} color={color(theme, 'foreground')} />
            <Text>Escolher da galeria</Text>
          </Button>
        </BottomSheet>
      ) : null}
    </View>
  );
}

/** E-mail só leitura (decisão 67), com o selo da verificação e o reenvio do link. */
function EmailRow() {
  const me = useMe();
  const { resendVerificationEmail } = useAuthActions();
  const resend = useMutation({ mutationFn: resendVerificationEmail });
  if (!me.email) return null;

  return (
    <View className="gap-1.5" testID="editar-perfil-email">
      <Text variant="small">E-mail</Text>
      <View className="flex-row flex-wrap items-center gap-2">
        <Text className="text-muted-foreground" selectable>
          {me.email}
        </Text>
        <Badge
          variant={me.emailVerified ? 'success' : 'warning'}
          testID="editar-perfil-email-status"
        >
          <Text>{me.emailVerified ? 'Verificado' : 'Não verificado'}</Text>
        </Badge>
      </View>
      <Text variant="muted">O e-mail não pode ser alterado pelo app.</Text>
      {me.emailVerified ? null : (
        <View className="items-start gap-1">
          <Button
            variant="outline"
            size="sm"
            testID="editar-perfil-reenviar"
            disabled={resend.isPending}
            onPress={() => me.email && resend.mutate(me.email)}
          >
            <Text>{resend.isPending ? 'Enviando…' : 'Reenviar verificação'}</Text>
          </Button>
          {resend.isSuccess ? (
            <Text variant="muted" accessibilityLiveRegion="polite">
              E-mail reenviado. Confira sua caixa de entrada.
            </Text>
          ) : null}
          {resend.error ? <InlineError message={authErrorMessage(resend.error)} /> : null}
        </View>
      )}
    </View>
  );
}
