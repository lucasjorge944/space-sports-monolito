'use client';

import { isApiError } from '@space-sports/api-client';
import {
  REVIEW_REPORT_DETAILS_MAX_LENGTH,
  type ReportReviewInput,
  type ReviewReportReason,
} from '@space-sports/shared';
import { EllipsisVertical, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/auth/form-alert';
import { Field } from '@/components/painel/field';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { REPORT_REASON_OPTIONS } from '@/lib/reviews';
import { cn } from '@/lib/utils';

const ALREADY_REPORTED = 'Você já denunciou esta avaliação.';
const SUCCESS = 'Denúncia enviada. Obrigado por avisar.';

/** A denúncia já existe (409): para a tela, é o mesmo que ter enviado agora. */
const isAlreadyReported = (error: unknown) =>
  isApiError(error) && error.code === 'REVIEW_ALREADY_REPORTED';

function reportErrorMessage(error: unknown): string {
  if (isApiError(error) && error.code === 'REVIEW_REPORT_OWN') {
    return 'Você não pode denunciar a sua avaliação.';
  }
  if (isApiError(error) && error.status === 401) return 'Sua sessão expirou. Entre novamente.';
  return 'Não foi possível enviar a denúncia. Tente de novo.';
}

type ReportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Painel: o texto lembra que o espaço não apaga avaliações. */
  context: 'public' | 'panel';
  /** Envia a denúncia; rejeitar mostra o erro (ou fecha, se já denunciada). */
  submit: (body: ReportReviewInput) => Promise<unknown>;
  /** Depois do sucesso ou do 409: o item passa a "Denúncia enviada" (estado local). */
  onReported: () => void;
};

/** Diálogo "Denunciar avaliação" (docs/05, "Avaliações" (9)): motivo obrigatório e detalhes. */
export function ReportReviewDialog(props: ReportDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>{props.open ? <ReportForm {...props} /> : null}</DialogContent>
    </Dialog>
  );
}

function ReportForm({ onOpenChange, context, submit, onReported }: ReportDialogProps) {
  const [reason, setReason] = useState<ReviewReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [reasonError, setReasonError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reason) {
      setReasonError('Escolha um motivo');
      return;
    }
    setPending(true);
    setFormError(undefined);
    try {
      await submit({ reason, details: details.trim() || null });
      toast.success(SUCCESS);
      onReported();
      onOpenChange(false);
    } catch (error) {
      if (isAlreadyReported(error)) {
        toast.info(ALREADY_REPORTED);
        onReported();
        onOpenChange(false);
        return;
      }
      setFormError(reportErrorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Denunciar avaliação</DialogTitle>
        <DialogDescription>
          {context === 'panel'
            ? 'A equipe da Space Sports analisa a denúncia. O espaço não apaga avaliações.'
            : 'A equipe da Space Sports analisa cada denúncia. A avaliação continua no ar enquanto isso.'}
        </DialogDescription>
      </DialogHeader>
      <FormError message={formError} />
      <Field label="Motivo" group error={reasonError}>
        <div role="radiogroup" aria-label="Motivo" className="flex flex-col gap-2">
          {REPORT_REASON_OPTIONS.map((option) => {
            const selected = option.value === reason;
            return (
              <label
                key={option.value}
                className={cn(
                  'flex min-h-12 cursor-pointer items-start gap-3 rounded-md border-[1.5px] px-3 py-2.5 transition-colors',
                  'has-focus-visible:ring-ring has-focus-visible:ring-offset-ring-offset has-focus-visible:ring-2 has-focus-visible:ring-offset-2',
                  selected
                    ? 'border-chip-selected-border bg-accent'
                    : 'border-border hover:bg-accent',
                )}
              >
                <input
                  type="radio"
                  name="report-reason"
                  value={option.value}
                  checked={selected}
                  onChange={() => {
                    setReason(option.value);
                    setReasonError(undefined);
                  }}
                  className="accent-primary mt-0.5 size-4 shrink-0"
                  data-testid={`denuncia-motivo-${option.value}`}
                />
                <span className="flex flex-col">
                  <span className="text-sm font-medium">{option.label}</span>
                  <span className="text-muted-foreground text-sm">{option.description}</span>
                </span>
              </label>
            );
          })}
        </div>
      </Field>
      <Field
        label="Detalhes"
        optional={reason !== 'OTHER'}
        htmlFor="report-details"
        hint={
          <span className="flex justify-between gap-2">
            <span>{reason === 'OTHER' ? 'Conte o que há de errado' : ''}</span>
            <span className="tabular-nums">
              {details.length}/{REVIEW_REPORT_DETAILS_MAX_LENGTH}
            </span>
          </span>
        }
      >
        <Textarea
          id="report-details"
          rows={3}
          value={details}
          maxLength={REVIEW_REPORT_DETAILS_MAX_LENGTH}
          onChange={(e) => setDetails(e.target.value)}
        />
      </Field>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={pending}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={pending} data-testid="denuncia-enviar">
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {pending ? 'Enviando…' : 'Enviar denúncia'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * Menu "⋮" do item com "Denunciar avaliação" (ou "Denúncia enviada", desabilitado, depois do envio:
 * estado local que não persiste ao recarregar). O diálogo fica fora do menu para manter o foco.
 */
export function ReviewReportMenu({
  reviewId,
  authorName,
  reported,
  context,
  submit,
  onReported,
}: {
  reviewId: string;
  authorName: string;
  reported: boolean;
  context: 'public' | 'panel';
  submit: (body: ReportReviewInput) => Promise<unknown>;
  onReported: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-11 shrink-0"
            aria-label={`Mais opções da avaliação de ${authorName}`}
            data-testid={`avaliacao-menu-${reviewId}`}
          >
            <EllipsisVertical className="size-5" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={reported} onSelect={() => setOpen(true)}>
            {reported ? 'Denúncia enviada' : 'Denunciar avaliação'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ReportReviewDialog
        open={open}
        onOpenChange={setOpen}
        context={context}
        submit={submit}
        onReported={onReported}
      />
    </>
  );
}
