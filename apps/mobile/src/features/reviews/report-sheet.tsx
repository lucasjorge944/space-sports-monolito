import { useReportReview } from '@space-sports/api-client';
import { REVIEW_REPORT_DETAILS_MAX_LENGTH, type ReviewReportReason } from '@space-sports/shared';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { BottomSheet } from '@/components/bottom-sheet';
import { InlineError } from '@/components/state-views';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { cleanComment, REPORT_REASONS, reportErrorOutcome } from './format';

/**
 * Denunciar avaliação (docs/05, "Avaliações (9)"; RN-REVIEW-04), montada só enquanto aberta (cada
 * abertura começa limpa): motivo obrigatório, detalhes
 * opcionais. `onDone(message)` com o texto do aviso: sucesso e o 409 de denúncia repetida marcam o
 * item como denunciado só nesta tela (não vem da API).
 */
export function ReportSheet({
  reviewId,
  onClose,
  onReported,
}: {
  reviewId: string | null;
  onClose: () => void;
  onReported: (reviewId: string, message: string) => void;
}) {
  const [reason, setReason] = useState<ReviewReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [missingReason, setMissingReason] = useState(false);
  const report = useReportReview();

  const submit = () => {
    if (!reviewId) return;
    if (!reason) {
      setMissingReason(true);
      return;
    }
    setError(null);
    report.mutate(
      { reviewId, data: { reason, details: cleanComment(details) } },
      {
        onSuccess: () => onReported(reviewId, 'Denúncia enviada. Obrigado por avisar.'),
        onError: (err) => {
          const outcome = reportErrorOutcome(err);
          if (outcome.reported) onReported(reviewId, outcome.message);
          else setError(outcome.message);
        },
      },
    );
  };

  return (
    <BottomSheet visible={reviewId !== null} title="Denunciar avaliação" onClose={onClose}>
      <Text variant="muted">
        A equipe da Space Sports analisa cada denúncia. A avaliação continua no ar enquanto isso.
      </Text>
      <InlineError message={error} />
      <View role="radiogroup" accessibilityLabel="Motivo" className="gap-2">
        {REPORT_REASONS.map((option) => {
          const selected = reason === option.value;
          return (
            <Pressable
              key={option.value}
              testID={`denuncia-motivo-${option.value}`}
              role="radio"
              aria-checked={selected}
              accessibilityLabel={`${option.label}. ${option.description}`}
              onPress={() => {
                setReason(option.value);
                setMissingReason(false);
              }}
              className={cn(
                'min-h-12 flex-row items-center gap-3 rounded-md border-[1.5px] px-3 py-2 active:bg-accent',
                selected ? 'border-primary bg-accent' : 'border-border bg-card',
              )}
            >
              <View
                className={cn(
                  'h-5 w-5 items-center justify-center rounded-full border-2',
                  selected ? 'border-primary' : 'border-input',
                )}
              >
                {selected ? <View className="h-2.5 w-2.5 rounded-full bg-primary" /> : null}
              </View>
              <View className="flex-1">
                <Text>{option.label}</Text>
                <Text variant="muted">{option.description}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      {missingReason ? (
        <Text role="alert" className="text-sm font-medium text-input-error-foreground">
          Escolha um motivo
        </Text>
      ) : null}
      <View className="gap-1.5">
        <Text variant="small">
          Detalhes
          {reason === 'OTHER' ? null : (
            <Text className="font-normal text-muted-foreground"> (opcional)</Text>
          )}
        </Text>
        <Input
          testID="denuncia-detalhes"
          accessibilityLabel="Detalhes"
          value={details}
          onChangeText={setDetails}
          multiline
          numberOfLines={3}
          maxLength={REVIEW_REPORT_DETAILS_MAX_LENGTH}
          textAlignVertical="top"
          className="h-auto min-h-24 py-3"
          editable={!report.isPending}
        />
        <View className="flex-row justify-between gap-2">
          <Text className="flex-1 text-sm text-muted-foreground">
            {reason === 'OTHER' ? 'Conte o que há de errado' : ''}
          </Text>
          <Text className="text-sm tabular-nums text-muted-foreground">
            {details.length}/{REVIEW_REPORT_DETAILS_MAX_LENGTH}
          </Text>
        </View>
      </View>
      <Button testID="denuncia-enviar" disabled={report.isPending} onPress={submit}>
        <Text>{report.isPending ? 'Enviando…' : 'Enviar denúncia'}</Text>
      </Button>
      <Button variant="ghost" onPress={onClose}>
        <Text>Cancelar</Text>
      </Button>
    </BottomSheet>
  );
}
