'use client';

import {
  type MerchantAccount,
  type SpacePaymentSettings,
  useUpdateSpacePaymentModes,
} from '@space-sports/api-client';
import {
  type BookingPaymentMode,
  type ClassPaymentMode,
  formatBpsPercent,
} from '@space-sports/shared';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, CreditCard, Info, Loader2, Smartphone, Store } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/auth/form-alert';
import { OptionCards } from '@/components/painel/option-cards';
import type { SpaceScope } from '@/components/painel/space-scope';
import { StatusBadge } from '@/components/painel/status-badge';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate, formatMoney } from '@/lib/format';
import { apiErrorMessage } from '@/lib/painel/errors';
import { BOOKING_MODE_LABEL, CLASS_MODE_LABEL, MERCHANT_STATUS } from '@/lib/painel/labels';
import { feeExample, ONLINE_PAYMENTS_PATH } from '@/lib/painel/online-payments';
import { invalidateSpace } from '@/lib/painel/query';
import { overline } from '@/lib/utils';

/** Quem pode o quê na conta de recebimento (decisão 95). */
export type MerchantAccess = {
  /** Dono, fora do modo suporte, com o espaço ativo e o pagamento online ligado. */
  canSubmit: boolean;
  isOwner: boolean;
  support: boolean;
  enabled: boolean;
};

const SUPPORT_NOTICE = 'No modo suporte, o cadastro e a conta bancária não podem ser alterados.';

function AccessNote({ access, admin }: { access: MerchantAccess; admin: string }) {
  if (!access.enabled) return null;
  const text = access.support ? SUPPORT_NOTICE : !access.isOwner ? admin : null;
  return text ? (
    <p className="text-muted-foreground text-sm" data-testid="merchant-access-note">
      {text}
    </p>
  ) : null;
}

/** Card "Conta de recebimento" (RF-ONPAY-01): status, resumo mascarado e as ações do Dono. */
export function MerchantCard({
  merchant,
  access,
}: {
  merchant: MerchantAccount;
  access: MerchantAccess;
}) {
  const status = merchant.status;
  const summary = [merchant.documentMasked, merchant.payoutMasked].filter(Boolean).join(' · ');
  // CPF do responsável só no cadastro com CNPJ, sempre mascarado (decisão 97).
  const responsible = merchant.responsibleCpfMasked
    ? [merchant.responsibleName, `CPF ${merchant.responsibleCpfMasked}`].filter(Boolean).join(' · ')
    : null;
  const details =
    summary || responsible ? (
      <div
        className="text-muted-foreground grid gap-0.5 tabular-nums"
        data-testid="merchant-summary"
      >
        {summary ? <p>{summary}</p> : null}
        {responsible ? <p>Responsável: {responsible}</p> : null}
      </div>
    ) : null;
  const rejectedChange = merchant.lastRejectedPayoutChange;

  return (
    <Card data-testid="merchant-card">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Conta de recebimento</CardTitle>
        <StatusBadge info={MERCHANT_STATUS[status]} />
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {status === 'NOT_STARTED' ? (
          <>
            <p>
              Para receber pelo app, o espaço precisa de uma conta no nosso parceiro de pagamentos.
              As vendas caem nela e são repassadas todo dia para a conta bancária do espaço.
            </p>
            <div>
              <p className="font-medium">Você vai precisar de:</p>
              <ul className="text-muted-foreground list-disc pl-5">
                <li>CPF ou CNPJ e os dados de quem responde pelo espaço</li>
                <li>Endereço</li>
                <li>Conta bancária ou chave Pix no mesmo CPF/CNPJ</li>
              </ul>
            </div>
            {access.canSubmit ? (
              <Button asChild className="w-fit">
                <Link href={`${ONLINE_PAYMENTS_PATH}/cadastro`}>Começar cadastro</Link>
              </Button>
            ) : (
              <AccessNote access={access} admin="Só o dono do espaço pode fazer o cadastro." />
            )}
          </>
        ) : null}

        {status === 'PENDING' ? (
          <>
            {merchant.payoutsPaused ? (
              <Alert variant="warning" role="status">
                Repasses pausados até a aprovação da nova conta. As vendas continuam entrando no
                saldo.
              </Alert>
            ) : null}
            <p>
              Recebemos o cadastro
              {merchant.submittedAt ? ` em ${formatDate(merchant.submittedAt)}` : ''}. Avisamos
              assim que o parceiro responder.
            </p>
            {details}
          </>
        ) : null}

        {status === 'APPROVED' ? (
          <>
            <p>Aprovado{merchant.approvedAt ? ` em ${formatDate(merchant.approvedAt)}` : ''}.</p>
            {rejectedChange ? (
              // Decisão 98: a troca recusada volta para a conta anterior, sem refazer o cadastro.
              <Alert variant="warning" role="status" data-testid="payout-change-rejected">
                <p className="font-medium">
                  O parceiro recusou a troca para a conta {rejectedChange.payoutMasked} em{' '}
                  {formatDate(rejectedChange.rejectedAt)}. A conta anterior continua valendo.
                </p>
                {rejectedChange.reason ? <p>Motivo: {rejectedChange.reason}</p> : null}
                <p>Os repasses e o pagamento pelo app seguem normalmente.</p>
              </Alert>
            ) : null}
            {details}
            {access.canSubmit ? (
              <Button asChild variant="outline" className="w-fit">
                <Link href={`${ONLINE_PAYMENTS_PATH}/cadastro?troca=1`}>Trocar conta bancária</Link>
              </Button>
            ) : (
              <AccessNote access={access} admin="Só o dono do espaço pode trocar a conta." />
            )}
          </>
        ) : null}

        {status === 'REJECTED' ? (
          // Só o primeiro cadastro é recusado assim: a troca recusada volta para APPROVED (decisão 98).
          <>
            <Alert variant="destructive" data-testid="merchant-rejection">
              <p className="font-medium">O parceiro recusou o cadastro.</p>
              {merchant.rejectionReason ? <p>Motivo: {merchant.rejectionReason}</p> : null}
            </Alert>
            {access.canSubmit ? (
              <Button asChild className="w-fit">
                <Link href={`${ONLINE_PAYMENTS_PATH}/cadastro`}>Corrigir e reenviar</Link>
              </Button>
            ) : (
              <AccessNote
                access={access}
                admin="Só o dono do espaço pode corrigir e reenviar o cadastro."
              />
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

const BOOKING_MODES: { value: BookingPaymentMode; description: string; icon: typeof Store }[] = [
  { value: 'ON_SITE', description: 'Como hoje: o jogador paga no espaço.', icon: Store },
  {
    value: 'ONLINE_OPTIONAL',
    description: 'O jogador escolhe Pix, cartão ou no local. A reserva é confirmada na hora.',
    icon: Smartphone,
  },
  {
    value: 'ONLINE_REQUIRED',
    description:
      'Pagamento na reserva. O horário fica guardado por 15 min; sem pagamento, a reserva é cancelada sozinha. Ajuda contra faltas.',
    icon: CalendarCheck,
  },
];

const CLASS_MODES: { value: ClassPaymentMode; description: string; icon: typeof Store }[] = [
  { value: 'ON_SITE', description: 'O aluno paga no espaço.', icon: Store },
  {
    value: 'ONLINE_OPTIONAL',
    description: 'O aluno pode pagar a mensalidade com Pix ou cartão pelo app.',
    icon: Smartphone,
  },
];

/** Card "Formas de pagamento no app" (RF-ONPAY-02): bloqueado sem cadastro aprovado. */
export function ModesCard({
  scope,
  settings,
  merchant,
}: {
  scope: SpaceScope;
  settings: SpacePaymentSettings;
  merchant: MerchantAccount;
}) {
  const queryClient = useQueryClient();
  const enabled = settings.paymentEnvironment.enabled;
  // A regra é da API (`onlineReady`): gateway ligado, espaço ativo e cadastro já aprovado.
  const blocked = !settings.onlineReady;
  // Bloqueado, mostra o modo em vigor ("Só no local"); liberado, o gravado pelo espaço.
  const initialBooking = blocked ? settings.effectiveBookingMode : settings.bookingMode;
  const initialClass = blocked ? settings.effectiveClassMode : settings.classMode;
  const [booking, setBooking] = useState(initialBooking);
  const [klass, setKlass] = useState(initialClass);
  const update = useUpdateSpacePaymentModes();

  useEffect(() => {
    setBooking(initialBooking);
    setKlass(initialClass);
  }, [initialBooking, initialClass]);

  const changed = booking !== initialBooking || klass !== initialClass;
  const disabled = blocked || !scope.canWrite('payments.online.manage') || update.isPending;

  return (
    <Card data-testid="modes-card">
      <CardHeader>
        <CardTitle>Formas de pagamento no app</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        {enabled && blocked && !scope.readOnly ? (
          <Alert variant="info" role="status">
            <Info aria-hidden />
            <p>
              {merchant.approvedAt === null
                ? 'Disponível depois que a conta de recebimento for aprovada.'
                : 'O pagamento pelo app não está disponível para o espaço agora. Fale com o suporte.'}
            </p>
          </Alert>
        ) : null}
        <FormError message={update.error ? apiErrorMessage(update.error) : undefined} />
        <div className="grid gap-2">
          <p className={overline}>Reservas pelo app</p>
          <OptionCards
            label="Reservas pelo app"
            name="booking-mode"
            value={booking}
            onChange={setBooking}
            disabled={disabled}
            className="lg:grid-cols-3"
            options={BOOKING_MODES.map((m) => ({ ...m, label: BOOKING_MODE_LABEL[m.value] }))}
          />
        </div>
        <div className="grid gap-2">
          <p className={overline}>Mensalidades de aulas</p>
          <OptionCards
            label="Mensalidades de aulas"
            name="class-mode"
            value={klass}
            onChange={setKlass}
            disabled={disabled}
            className="lg:grid-cols-3"
            options={CLASS_MODES.map((m) => ({ ...m, label: CLASS_MODE_LABEL[m.value] }))}
          />
        </div>
        <p className="text-muted-foreground">
          Reservas de balcão e de mensalistas continuam pagas no local.
        </p>
        {!blocked && scope.canWrite('payments.online.manage') ? (
          <Button
            className="w-fit justify-self-end"
            disabled={!changed || update.isPending}
            onClick={() =>
              update.mutate(
                { spaceId: scope.spaceId, data: { bookingMode: booking, classMode: klass } },
                {
                  onSuccess: () => {
                    toast.success('Formas de pagamento salvas');
                    void invalidateSpace(queryClient, scope.spaceId);
                  },
                },
              )
            }
          >
            {update.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Salvar alterações
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Card "Taxa de serviço" (somente leitura): a taxa vigente do espaço e como ela funciona. */
export function FeeCard({ fee }: { fee: SpacePaymentSettings['fee'] }) {
  const { example, minimumNote } = feeExample(fee);
  return (
    <Card data-testid="fee-card">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="size-4" aria-hidden />
          Taxa de serviço
        </CardTitle>
        {fee.custom ? <Badge variant="info">Condição especial</Badge> : null}
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <dl className="grid gap-1 tabular-nums">
          <div className="flex justify-between">
            <dt>Pix</dt>
            <dd>{formatBpsPercent(fee.pixFeeBps)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Cartão de crédito</dt>
            <dd>{formatBpsPercent(fee.cardFeeBps)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Mínimo por pagamento</dt>
            <dd>{formatMoney(fee.minFeeCents)}</dd>
          </div>
        </dl>
        <div className="text-muted-foreground grid gap-1 border-t pt-3">
          <p>
            Só nos pagamentos online. O jogador paga o preço normal, sem acréscimo; a taxa sai do
            valor que o espaço recebe e já inclui o custo do Pix e do cartão. Se houver estorno, a
            taxa volta na mesma proporção. Pagamentos no local não têm taxa.
          </p>
          <p data-testid="fee-example">{example}</p>
          {minimumNote ? <p>{minimumNote}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}
