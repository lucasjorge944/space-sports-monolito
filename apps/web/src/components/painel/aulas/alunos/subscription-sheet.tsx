'use client';

import { type StaffSubscriptionDetail, useGetSpaceSubscription } from '@space-sports/api-client';
import { ArrowLeftRight, Check, Plus, RotateCcw, UserMinus, X } from 'lucide-react';
import { useState } from 'react';
import type { SpaceScope } from '@/components/painel/space-scope';
import { ErrorState, LoadingBlock } from '@/components/painel/states';
import { StatusBadge } from '@/components/painel/status-badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { formatLocalDate, formatMoney, todayLocal } from '@/lib/format';
import { teacherNames } from '@/lib/painel/aulas';
import {
  CHARGE_STATUS,
  ENROLLMENT_STATUS,
  PAYMENT_METHOD_LABEL,
  SUBSCRIPTION_STATUS,
} from '@/lib/painel/labels';
import {
  canAddEnrollment,
  canCancelSubscription,
  cancelledAccessLabel,
  canEditEnrollments,
  canResumeCancel,
  chargeMonth,
  classSlotShort,
  isChargeOpen,
  waiveNote,
} from '@/lib/painel/subscriptions';
import { overline } from '@/lib/utils';
import type { ReviewableSubscription } from './approve-dialogs';
import { AttendanceHistory } from './attendance-history';
import { CancelSubscriptionDialog, ResumeCancelDialog } from './cancel-dialogs';
import {
  AddEnrollmentDialog,
  type EnrollmentTarget,
  SwapDialog,
  UnenrollDialog,
} from './enrollment-dialogs';

/** Ficha do aluno: assinatura, turmas (trocar/desmatricular), mensalidades e presença. */
export function SubscriptionSheet({
  scope,
  subscriptionId,
  onClose,
  onApprove,
  onReject,
}: {
  scope: SpaceScope;
  subscriptionId: string | null;
  onClose: () => void;
  onApprove: (s: ReviewableSubscription) => void;
  onReject: (s: ReviewableSubscription) => void;
}) {
  return (
    <Sheet open={subscriptionId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Aluno</SheetTitle>
          <SheetDescription>Assinatura, turmas, mensalidades e presença.</SheetDescription>
        </SheetHeader>
        {subscriptionId ? (
          <Body
            scope={scope}
            subscriptionId={subscriptionId}
            onApprove={onApprove}
            onReject={onReject}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Body({
  scope,
  subscriptionId,
  onApprove,
  onReject,
}: {
  scope: SpaceScope;
  subscriptionId: string;
  onApprove: (s: ReviewableSubscription) => void;
  onReject: (s: ReviewableSubscription) => void;
}) {
  const query = useGetSpaceSubscription(scope.spaceId, subscriptionId);
  if (query.isPending)
    return (
      <div className="px-4">
        <LoadingBlock rows={5} />
      </div>
    );
  if (query.isError)
    return (
      <div className="px-4">
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  return <Detail scope={scope} item={query.data} onApprove={onApprove} onReject={onReject} />;
}

function Detail({
  scope,
  item,
  onApprove,
  onReject,
}: {
  scope: SpaceScope;
  item: StaffSubscriptionDetail;
  onApprove: (s: ReviewableSubscription) => void;
  onReject: (s: ReviewableSubscription) => void;
}) {
  const canManage = scope.canWrite('enrollment.manage');
  const editable = canManage && canEditEnrollments(item.status);
  const [swap, setSwap] = useState<{ id: string; name: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [unenroll, setUnenroll] = useState<{ id: string; name: string } | null>(null);
  const [resuming, setResuming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const today = todayLocal();
  const cancelledAccess = cancelledAccessLabel(item);

  const visible = item.enrollments.filter((e) => e.status !== 'ENDED');
  const target: EnrollmentTarget = {
    subscriptionId: item.id,
    studentName: item.student.name,
    sportId: item.plan.sport.id,
    enrolledGroupIds: item.enrollments
      .filter((e) => e.status !== 'ENDED')
      .map((e) => e.classGroup.id),
  };

  return (
    <div className="flex flex-col gap-5 px-4 pb-6" data-testid="subscription-detail">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-lg font-semibold">{item.student.name}</h2>
        <p className="text-muted-foreground text-sm">
          {item.plan.name} · {formatMoney(item.priceCents)}/mês · vence todo dia{' '}
          {item.plan.billingDay}
        </p>
        <div className="mt-1 flex items-center gap-2">
          <StatusBadge
            info={
              cancelledAccess
                ? { label: cancelledAccess, tone: 'warning' }
                : SUBSCRIPTION_STATUS[item.status]
            }
          />
          {item.status === 'PENDING_APPROVAL' && canManage ? (
            <>
              <Button size="sm" onClick={() => onApprove(item)}>
                <Check /> Aprovar
              </Button>
              <Button size="sm" variant="outline" onClick={() => onReject(item)}>
                <X /> Recusar
              </Button>
            </>
          ) : null}
        </div>
        {canManage ? (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {canResumeCancel(item, today) ? (
              <Button size="sm" variant="outline" onClick={() => setResuming(true)}>
                <RotateCcw /> Desfazer cancelamento
              </Button>
            ) : null}
            {canCancelSubscription(item) ? (
              <Button size="sm" variant="outline" onClick={() => setCancelling(true)}>
                <X /> Cancelar assinatura
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {item.startsOn ? <Info label="Início" value={formatLocalDate(item.startsOn)} /> : null}
        {item.currentPeriodStart && item.currentPeriodEnd ? (
          <Info
            label="Ciclo atual"
            value={`${formatLocalDate(item.currentPeriodStart)} a ${formatLocalDate(item.currentPeriodEnd)}`}
          />
        ) : null}
        {item.status === 'CANCELLED' && item.accessUntil ? (
          <Info label="Acesso até" value={formatLocalDate(item.accessUntil)} />
        ) : null}
        {item.intendedPaymentMethod ? (
          <Info label="Forma preferida" value={PAYMENT_METHOD_LABEL[item.intendedPaymentMethod]} />
        ) : null}
        {item.overdueCents > 0 ? (
          <Info label="Vencido" value={formatMoney(item.overdueCents)} tone="destructive" />
        ) : null}
        {item.statusReason ? <Info label="Motivo" value={item.statusReason} /> : null}
      </dl>

      <section className="flex flex-col gap-2" aria-labelledby="turmas-title">
        <div className="flex items-center justify-between gap-2">
          <h3 id="turmas-title" className={overline}>
            Turmas
          </h3>
          {canManage && canAddEnrollment(item) ? (
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <Plus /> Matricular em outra
            </Button>
          ) : null}
        </div>
        {visible.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nenhuma turma.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {visible.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                data-testid="enrollment-row"
              >
                <div>
                  <div className="font-medium">{e.classGroup.name}</div>
                  <div className="text-muted-foreground text-xs">
                    {classSlotShort(e.classGroup)} · {e.classGroup.court.name} ·{' '}
                    {teacherNames(e.classGroup.teachers)}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <StatusBadge info={ENROLLMENT_STATUS[e.status]} />
                  {editable && e.status === 'ACTIVE' ? (
                    <>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Trocar ${e.classGroup.name}`}
                        onClick={() => setSwap({ id: e.classGroup.id, name: e.classGroup.name })}
                      >
                        <ArrowLeftRight />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Desmatricular de ${e.classGroup.name}`}
                        onClick={() => setUnenroll({ id: e.id, name: e.classGroup.name })}
                      >
                        <UserMinus />
                      </Button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {scope.can('payment.record') ? (
        <section className="flex flex-col gap-2" aria-labelledby="mens-title">
          <h3 id="mens-title" className={overline}>
            Mensalidades
          </h3>
          {item.charges.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhuma mensalidade gerada ainda.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {item.charges.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  data-testid="sheet-charge-row"
                >
                  <div>
                    <div className="font-medium tabular-nums">{chargeMonth(c.periodStart)}</div>
                    <div className="text-muted-foreground text-xs">
                      vence {formatLocalDate(c.dueDate)}
                    </div>
                    {waiveNote(c) ? (
                      <div className="text-muted-foreground text-xs">{waiveNote(c)}</div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-right tabular-nums">
                      {formatMoney(c.amountCents)}
                      {isChargeOpen(c.status) && c.paidCents > 0 && c.dueCents > 0 ? (
                        <span
                          className="text-muted-foreground block text-xs"
                          data-testid="sheet-charge-due"
                        >
                          faltam {formatMoney(c.dueCents)}
                        </span>
                      ) : null}
                    </span>
                    <StatusBadge info={CHARGE_STATUS[c.status]} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <AttendanceHistory spaceId={scope.spaceId} userId={item.student.userId} />

      <SwapDialog
        scope={scope}
        target={swap ? { ...target, fromGroup: swap } : null}
        onClose={() => setSwap(null)}
      />
      <AddEnrollmentDialog
        scope={scope}
        target={adding ? target : null}
        onClose={() => setAdding(false)}
      />
      <UnenrollDialog
        scope={scope}
        target={
          unenroll
            ? {
                subscriptionId: item.id,
                enrollmentId: unenroll.id,
                studentName: item.student.name,
                groupName: unenroll.name,
              }
            : null
        }
        onClose={() => setUnenroll(null)}
      />
      <ResumeCancelDialog
        scope={scope}
        target={resuming ? item : null}
        onClose={() => setResuming(false)}
      />
      <CancelSubscriptionDialog
        scope={scope}
        target={cancelling ? item : null}
        onClose={() => setCancelling(false)}
      />
    </div>
  );
}

function Info({ label, value, tone }: { label: string; value: string; tone?: 'destructive' }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className={tone === 'destructive' ? 'text-destructive font-medium' : 'font-medium'}>
        {value}
      </dd>
    </div>
  );
}
