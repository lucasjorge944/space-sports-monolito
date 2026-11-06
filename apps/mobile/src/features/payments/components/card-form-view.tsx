import { formatCents } from '@space-sports/shared';
import { Lock } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Text } from '@/components/ui/text';
import { Field, FormError } from '@/features/auth/components/field';
import { testIdPart } from '@/lib/test-ids';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';
import {
  type CardErrors,
  type CardField,
  type CardFormValues,
  EMPTY_CARD,
  formatCardNumber,
  formatCvc,
  formatExpiry,
  formatHolderName,
  type PaymentEnvironmentLike,
  testCardValues,
  validateCard,
  validateCardField,
} from '../card-form';
import { SandboxBadge } from './sandbox-badge';

export interface DeclineNotice {
  title: string;
  message: string;
}

/**
 * Formulário "Pagar com cartão" (docs/05, "App — (3)"; RN-ONPAY-10): máscara, validação ao sair do
 * campo e ao enviar, cartões de teste da API (só no fake) e nada salvo. `onSubmit` recebe os dados
 * já validados; quem chama gera o token e manda só ele.
 */
export function CardFormView({
  amountCents,
  environment,
  processing,
  decline,
  error,
  onSubmit,
  onPayWithPix,
  resetKey,
}: {
  amountCents: number;
  environment: PaymentEnvironmentLike | null | undefined;
  processing: boolean;
  /** Recusa da última tentativa (o código de segurança é limpo). */
  decline: DeclineNotice | null;
  /** Erro geral (rede, indisponível). */
  error: string | null;
  onSubmit: (values: CardFormValues) => void;
  onPayWithPix?: () => void;
  /** Muda a cada recusa: limpa o código de segurança. */
  resetKey?: string | null;
}) {
  const name = useThemeName();
  const [values, setValues] = useState<CardFormValues>(EMPTY_CARD);
  const [errors, setErrors] = useState<CardErrors>({});

  useEffect(() => {
    if (!resetKey) return;
    setValues((v) => ({ ...v, cvc: '' }));
  }, [resetKey]);

  // A recusa ganha o foco do leitor de tela.
  const lastDecline = useRef<DeclineNotice | null>(null);
  useEffect(() => {
    if (decline && decline !== lastDecline.current) {
      AccessibilityInfo.announceForAccessibility(`${decline.title}. ${decline.message}`);
    }
    lastDecline.current = decline;
  }, [decline]);

  const set = (field: CardField, raw: string) => {
    const formatters: Record<CardField, (v: string) => string> = {
      number: formatCardNumber,
      name: formatHolderName,
      expiry: formatExpiry,
      cvc: formatCvc,
    };
    const next = { ...values, [field]: formatters[field](raw) };
    setValues(next);
    if (errors[field])
      setErrors((e) => ({ ...e, [field]: validateCardField(field, next) ?? undefined }));
  };
  const blur = (field: CardField) => {
    setErrors((e) => ({ ...e, [field]: validateCardField(field, values) ?? undefined }));
  };
  const submit = () => {
    const found = validateCard(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    onSubmit(values);
  };

  const testCards = environment?.sandbox?.testCards ?? [];
  const disabled = processing;

  return (
    <View className="gap-4">
      {decline ? (
        <View
          testID="cartao-recusado"
          role="alert"
          accessibilityLiveRegion="assertive"
          className="gap-1 rounded-md border border-destructive-subtle-border bg-destructive-subtle p-3"
        >
          <Text className="font-semibold text-destructive-subtle-foreground">{decline.title}</Text>
          <Text className="text-sm text-destructive-subtle-foreground">{decline.message}</Text>
        </View>
      ) : null}
      <FormError message={error} />

      {testCards.length > 0 ? (
        <View testID="cartao-testes" className="gap-2 rounded-lg bg-muted p-3">
          <View className="flex-row items-center justify-between gap-2">
            <Text variant="small">Cartões de teste</Text>
            <SandboxBadge testID="cartao-testes-selo" />
          </View>
          <View className="flex-row flex-wrap gap-2">
            {testCards.map((card) => (
              <Chip
                key={card.number}
                role="button"
                testID={`cartao-teste-${testIdPart(card.label)}`}
                disabled={disabled}
                accessibilityLabel={`Preencher com o cartão de teste: ${card.label}`}
                onPress={() => {
                  setValues(testCardValues(card));
                  setErrors({});
                }}
              >
                <Text>{card.label}</Text>
              </Chip>
            ))}
          </View>
        </View>
      ) : null}

      <Field
        testID="cartao-numero"
        label="Número do cartão"
        value={values.number}
        onChangeText={(v) => set('number', v)}
        onBlur={() => blur('number')}
        error={errors.number}
        keyboardType="number-pad"
        autoComplete="cc-number"
        textContentType="creditCardNumber"
        placeholder="0000 0000 0000 0000"
        maxLength={23}
        editable={!disabled}
      />
      <Field
        testID="cartao-nome"
        label="Nome impresso no cartão"
        value={values.name}
        onChangeText={(v) => set('name', v)}
        onBlur={() => blur('name')}
        error={errors.name}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="cc-name"
        textContentType="name"
        editable={!disabled}
      />
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Field
            testID="cartao-validade"
            label="Validade"
            hint="MM/AA"
            value={values.expiry}
            onChangeText={(v) => set('expiry', v)}
            onBlur={() => blur('expiry')}
            error={errors.expiry}
            keyboardType="number-pad"
            autoComplete="cc-exp"
            placeholder="MM/AA"
            maxLength={5}
            editable={!disabled}
          />
        </View>
        <View className="flex-1">
          <Field
            testID="cartao-cvv"
            label="Código de segurança"
            hint="3 dígitos no verso"
            value={values.cvc}
            onChangeText={(v) => set('cvc', v)}
            onBlur={() => blur('cvc')}
            error={errors.cvc}
            keyboardType="number-pad"
            autoComplete="cc-csc"
            maxLength={4}
            editable={!disabled}
          />
        </View>
      </View>

      <View className="flex-row items-center gap-2">
        <Lock size={16} color={color(name, 'mutedForeground')} aria-hidden />
        <Text variant="muted">O Space Sports não guarda seu cartão.</Text>
      </View>
      <Button testID="cartao-pagar" size="lg" disabled={disabled} onPress={submit}>
        {processing ? <ActivityIndicator color={color(name, 'primaryForeground')} /> : null}
        <Text className="tabular-nums">
          {processing ? 'Processando…' : `Pagar ${formatCents(amountCents)}`}
        </Text>
      </Button>
      {onPayWithPix ? (
        <Button
          testID="cartao-pagar-pix"
          variant="ghost"
          disabled={disabled}
          onPress={onPayWithPix}
        >
          <Text>Pagar com Pix</Text>
        </Button>
      ) : null}
    </View>
  );
}
