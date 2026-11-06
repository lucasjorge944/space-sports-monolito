'use client';

import {
  type CepAddress,
  type MerchantAccount,
  useChangeMerchantPayout,
  useGetMerchantAccount,
  useSubmitMerchantAccount,
} from '@space-sports/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, Check, KeyRound, Landmark, Loader2, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/auth/form-alert';
import { CepField } from '@/components/painel/cep-field';
import { ConfirmDialog } from '@/components/painel/confirm-dialog';
import { Field } from '@/components/painel/field';
import { OptionCards } from '@/components/painel/option-cards';
import { SpaceGate, type SpaceScope } from '@/components/painel/space-scope';
import { ErrorState, LoadingBlock, NoPermission, PageHeader } from '@/components/painel/states';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MaskedInput } from '@/components/ui/masked-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select-menu';
import type { MaskName } from '@/lib/masks';
import { apiErrorMessage } from '@/lib/painel/errors';
import {
  COMMON_BANKS,
  type DraftErrors,
  EMPTY_MERCHANT_DRAFT,
  MERCHANT_STEPS,
  type MerchantDraft,
  merchantFormMode,
  merchantPayload,
  ONLINE_PAYMENTS_PATH,
  PIX_KEY_LABEL,
  type PixKeyType,
  payoutFromDraft,
  payoutSummary,
  validateMerchantStep,
} from '@/lib/painel/online-payments';
import { invalidateSpace } from '@/lib/painel/query';
import { cn, overline, textLink } from '@/lib/utils';
import { useMerchantAccess } from './online-view';
import { isSandbox, SandboxBanner } from './sandbox';

/** Cadastro da conta de recebimento em etapas (RF-ONPAY-01): só o Dono, fora do modo suporte. */
export function MerchantFormView() {
  return <SpaceGate permission="merchant.manage">{(scope) => <Gate scope={scope} />}</SpaceGate>;
}

function Gate({ scope }: { scope: SpaceScope }) {
  const params = useSearchParams();
  const merchant = useGetMerchantAccount(scope.spaceId);
  const enabled = merchant.data?.paymentEnvironment.enabled ?? true;
  const access = useMerchantAccess(scope, enabled);

  if (merchant.isPending) return <LoadingBlock rows={4} />;
  if (merchant.isError) {
    return <ErrorState error={merchant.error} onRetry={() => void merchant.refetch()} />;
  }
  if (!access.canSubmit) {
    return (
      <NoPermission
        message={
          access.support
            ? 'No modo suporte, o cadastro e a conta bancária não podem ser alterados.'
            : !enabled
              ? 'O pagamento pelo app está desligado na plataforma.'
              : 'Só o dono do espaço pode fazer o cadastro da conta de recebimento.'
        }
      />
    );
  }
  const status = merchant.data.status;
  // Decisão 98: espaço já aprovado (approvedAt) nunca refaz o cadastro inteiro, só troca a conta.
  const mode = merchantFormMode(merchant.data, params.get('troca') === '1');
  if (mode === 'change' || mode === 'submit') {
    return <MerchantForm scope={scope} merchant={merchant.data} mode={mode} />;
  }
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Cadastro da conta de recebimento" />
      <p className="text-muted-foreground text-sm">
        {status === 'PENDING'
          ? 'O cadastro está em análise. Avisamos assim que o parceiro responder.'
          : 'O cadastro já foi aprovado.'}{' '}
        <Link href={ONLINE_PAYMENTS_PATH} className={textLink}>
          Voltar para Recebimentos online
        </Link>
      </p>
    </div>
  );
}

function MerchantForm({
  scope,
  merchant,
  mode,
}: {
  scope: SpaceScope;
  merchant: MerchantAccount;
  mode: 'submit' | 'change';
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  // Troca de conta: só "Onde receber" e a revisão (decisão 95).
  const steps = mode === 'change' ? [2, 3] : [0, 1, 2, 3];
  const [index, setIndex] = useState(0);
  const step = steps[index] as number;
  const [draft, setDraft] = useState<MerchantDraft>(() =>
    // Reenvio: os dados não sensíveis voltam preenchidos; documento e conta são digitados de novo.
    merchant.status === 'REJECTED'
      ? {
          ...EMPTY_MERCHANT_DRAFT,
          documentType: merchant.documentType ?? 'CNPJ',
          legalName: merchant.legalName ?? '',
          responsibleName: merchant.responsibleName ?? '',
          email: merchant.email ?? '',
        }
      : EMPTY_MERCHANT_DRAFT,
  );
  const [errors, setErrors] = useState<DraftErrors>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const submit = useSubmitMerchantAccount();
  const changePayout = useChangeMerchantPayout();
  const pending = submit.isPending || changePayout.isPending;
  const error = submit.error ?? changePayout.error;

  // Os dados ficam só na memória: fechar a aba pede a confirmação do navegador.
  useEffect(() => {
    if (sent) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [sent]);

  const set = <K extends keyof MerchantDraft>(key: K, value: MerchantDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  function focusFirstError(found: DraftErrors) {
    const first = Object.keys(found)[0];
    if (first) requestAnimationFrame(() => document.getElementById(`m-${first}`)?.focus());
  }

  function next() {
    const found = validateMerchantStep(step, draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return focusFirstError(found);
    if (index < steps.length - 1) {
      setIndex(index + 1);
      window.scrollTo({ top: 0 });
      return;
    }
    if (mode === 'change') setConfirmOpen(true);
    else send();
  }

  function done(message: string) {
    setSent(true);
    toast.success(message);
    void invalidateSpace(queryClient, scope.spaceId);
    router.push(
      mode === 'change' ? `${ONLINE_PAYMENTS_PATH}?aba=configuracao` : ONLINE_PAYMENTS_PATH,
    );
  }

  function send() {
    if (mode === 'change') {
      changePayout.mutate(
        {
          spaceId: scope.spaceId,
          data: { payout: payoutFromDraft(draft), acceptTerms: true },
        },
        {
          onSuccess: () => {
            setConfirmOpen(false);
            done('Nova conta enviada para análise');
          },
        },
      );
      return;
    }
    submit.mutate(
      { spaceId: scope.spaceId, data: merchantPayload(draft) },
      { onSuccess: () => done('Cadastro enviado') },
    );
  }

  const sandbox = merchant.paymentEnvironment.sandbox;

  return (
    <div className="flex max-w-[640px] flex-col gap-4">
      <PageHeader
        title={
          mode === 'change' ? 'Trocar conta de recebimento' : 'Cadastro da conta de recebimento'
        }
      />
      <Link href={ONLINE_PAYMENTS_PATH} className={cn(textLink, 'w-fit text-sm')}>
        ← Recebimentos online
      </Link>

      <ol className="flex flex-wrap gap-x-4 gap-y-2 text-sm" aria-label="Etapas do cadastro">
        {steps.map((s, i) => (
          <li
            key={s}
            aria-current={i === index ? 'step' : undefined}
            className={cn(
              'flex items-center gap-2 pb-1',
              i === index ? 'border-primary border-b-2 font-medium' : 'text-muted-foreground',
            )}
          >
            <span className="grid size-6 place-content-center rounded-full border text-xs">
              {i < index ? <Check className="size-3.5" aria-hidden /> : i + 1}
            </span>
            {MERCHANT_STEPS[s]}
          </li>
        ))}
      </ol>

      {isSandbox(merchant.paymentEnvironment) ? (
        <SandboxBanner>
          <p>Ambiente de teste: o cadastro é aprovado sozinho em alguns segundos.</p>
          {sandbox?.rejectedDocument.hint ? <p>{sandbox.rejectedDocument.hint}</p> : null}
        </SandboxBanner>
      ) : null}

      {mode === 'change' && merchant.lastRejectedPayoutChange ? (
        // Decisão 98: a conta anterior continua valendo; o Dono só tenta outra conta.
        <Alert variant="warning" data-testid="payout-change-rejected">
          <p className="font-medium">
            A troca para a conta {merchant.lastRejectedPayoutChange.payoutMasked} foi recusada. A
            conta anterior continua valendo.
          </p>
          {merchant.lastRejectedPayoutChange.reason ? (
            <p>Motivo: {merchant.lastRejectedPayoutChange.reason}</p>
          ) : null}
        </Alert>
      ) : null}
      <FormError message={error ? apiErrorMessage(error) : undefined} />

      <Card>
        <CardHeader>
          <CardTitle>{MERCHANT_STEPS[step]}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              next();
            }}
          >
            {step === 0 ? <WhoStep draft={draft} set={set} errors={errors} /> : null}
            {step === 1 ? <AddressStep draft={draft} set={set} errors={errors} /> : null}
            {step === 2 ? <PayoutStep draft={draft} set={set} errors={errors} /> : null}
            {step === 3 ? (
              <ReviewStep
                draft={draft}
                mode={mode}
                set={set}
                errors={errors}
                onEdit={(target) => setIndex(steps.indexOf(target))}
              />
            ) : null}
            <div className="flex justify-end gap-2">
              {index === 0 ? (
                <Button type="button" variant="outline" asChild>
                  <Link href={ONLINE_PAYMENTS_PATH}>Cancelar</Link>
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    setErrors({});
                    setIndex(index - 1);
                  }}
                >
                  Voltar
                </Button>
              )}
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {step === 3
                  ? pending
                    ? 'Enviando…'
                    : mode === 'change'
                      ? 'Trocar conta'
                      : 'Enviar cadastro'
                  : 'Continuar'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Trocar a conta de recebimento?"
        description="O cadastro volta para análise e os repasses ficam pausados até a aprovação da nova conta. Todos os donos do espaço recebem um aviso."
        confirmLabel="Trocar conta"
        destructive={false}
        pending={changePayout.isPending}
        error={changePayout.error}
        onConfirm={send}
      />
    </div>
  );
}

type StepProps = {
  draft: MerchantDraft;
  set: <K extends keyof MerchantDraft>(key: K, value: MerchantDraft[K]) => void;
  errors: DraftErrors;
};

function TextField({
  name,
  label,
  draft,
  set,
  errors,
  mask,
  optional,
  hint,
  type,
  autoComplete,
  list,
}: StepProps & {
  name: keyof MerchantDraft;
  label: string;
  mask?: MaskName;
  optional?: boolean;
  hint?: string;
  type?: string;
  autoComplete?: string;
  /** `id` de um `datalist` com sugestões (busca nativa). */
  list?: string;
}) {
  const id = `m-${name}`;
  const value = String(draft[name] ?? '');
  return (
    <Field label={label} htmlFor={id} error={errors[name]} optional={optional} hint={hint}>
      {mask ? (
        <MaskedInput
          mask={mask}
          id={id}
          value={value}
          onValueChange={(v) => set(name, v as never)}
          autoComplete={autoComplete}
          list={list}
        />
      ) : (
        <Input
          id={id}
          type={type}
          value={value}
          autoComplete={autoComplete}
          onChange={(e) => set(name, e.target.value as never)}
        />
      )}
    </Field>
  );
}

function WhoStep(props: StepProps) {
  const { draft, set } = props;
  const company = draft.documentType === 'CNPJ';
  return (
    <>
      <Field label="Tipo" group>
        <OptionCards
          label="Tipo"
          name="document-type"
          value={draft.documentType}
          onChange={(v) => {
            set('documentType', v);
            set('document', '');
          }}
          options={[
            {
              value: 'CNPJ',
              label: 'Empresa (CNPJ)',
              description: 'Recebe na conta da empresa.',
              icon: Building2,
            },
            {
              value: 'CPF',
              label: 'Pessoa física (CPF)',
              description: 'Recebe na conta de uma pessoa.',
              icon: UserRound,
            },
          ]}
        />
      </Field>
      <TextField
        {...props}
        name="document"
        label={company ? 'CNPJ' : 'CPF'}
        mask={company ? 'cnpj' : 'cpf'}
      />
      <TextField
        {...props}
        name="legalName"
        label={company ? 'Razão social' : 'Nome completo'}
        autoComplete={company ? 'organization' : 'name'}
      />
      {company ? (
        <>
          <TextField
            {...props}
            name="responsibleName"
            label="Responsável pela conta"
            autoComplete="name"
          />
          <TextField
            {...props}
            name="responsibleCpf"
            label="CPF do responsável"
            mask="cpf"
            hint="Pedido pelo parceiro de pagamentos. Fica guardado protegido e só aparece mascarado."
          />
        </>
      ) : null}
      <TextField {...props} name="phone" label="Telefone" mask="phone" autoComplete="tel" />
      <TextField {...props} name="email" label="E-mail" type="email" autoComplete="email" />
    </>
  );
}

function AddressStep(props: StepProps) {
  const { draft, set, errors } = props;
  function fill(address: CepAddress) {
    if (address.street) set('street', address.street);
    if (address.neighborhood) set('neighborhood', address.neighborhood);
    set('city', address.city);
    set('state', address.state);
    requestAnimationFrame(() =>
      document.getElementById(address.street ? 'm-number' : 'm-street')?.focus(),
    );
    return undefined;
  }
  return (
    <div className="grid gap-4 sm:grid-cols-6">
      <div className="sm:col-span-3">
        <CepField
          id="m-postalCode"
          value={draft.postalCode}
          onValueChange={(v) => set('postalCode', v)}
          onFound={fill}
          error={errors.postalCode}
        />
      </div>
      <div className="sm:col-span-6">
        <TextField {...props} name="street" label="Rua" autoComplete="address-line1" />
      </div>
      <div className="sm:col-span-2">
        <TextField {...props} name="number" label="Número" />
      </div>
      <div className="sm:col-span-4">
        <TextField {...props} name="complement" label="Complemento" optional />
      </div>
      <div className="sm:col-span-6">
        <TextField {...props} name="neighborhood" label="Bairro" />
      </div>
      <div className="sm:col-span-4">
        <TextField {...props} name="city" label="Cidade" autoComplete="address-level2" />
      </div>
      <div className="sm:col-span-2">
        <TextField {...props} name="state" label="UF" autoComplete="address-level1" />
      </div>
    </div>
  );
}

const PIX_KEY_MASK: Partial<Record<PixKeyType, MaskName>> = {
  CPF: 'cpf',
  CNPJ: 'cnpj',
  PHONE: 'phone',
};

function PayoutStep(props: StepProps) {
  const { draft, set } = props;
  return (
    <>
      <Field label="Onde receber" group hint="A conta precisa estar no CPF/CNPJ informado.">
        <OptionCards
          label="Onde receber"
          name="payout-kind"
          value={draft.payoutKind}
          onChange={(v) => set('payoutKind', v)}
          options={[
            {
              value: 'BANK_ACCOUNT',
              label: 'Conta bancária',
              description: 'Banco, agência e conta.',
              icon: Landmark,
            },
            {
              value: 'PIX_KEY',
              label: 'Chave Pix',
              description: 'CPF/CNPJ, e-mail, telefone ou aleatória.',
              icon: KeyRound,
            },
          ]}
        />
      </Field>
      {draft.payoutKind === 'BANK_ACCOUNT' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <TextField
              {...props}
              name="bankCode"
              label="Banco"
              mask="integer"
              list="m-banks"
              hint={bankHint(draft.bankCode)}
            />
            <datalist id="m-banks">
              {COMMON_BANKS.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.code} · {b.name}
                </option>
              ))}
            </datalist>
          </div>
          <TextField {...props} name="agency" label="Agência" mask="integer" />
          <TextField {...props} name="account" label="Conta com dígito" hint="Ex.: 12345-6" />
          <fieldset className="grid gap-2 sm:col-span-2">
            <legend className="mb-1.5 text-sm font-medium">Tipo de conta</legend>
            <div className="flex gap-4 text-sm">
              {(
                [
                  ['CHECKING', 'Corrente'],
                  ['SAVINGS', 'Poupança'],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="account-type"
                    value={value}
                    checked={draft.accountType === value}
                    onChange={() => set('accountType', value)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
          <Field label="Tipo de chave" htmlFor="m-pixKeyType">
            <Select
              value={draft.pixKeyType}
              onValueChange={(v) => {
                set('pixKeyType', v as PixKeyType);
                set('pixKey', '');
              }}
            >
              <SelectTrigger id="m-pixKeyType" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PIX_KEY_LABEL) as PixKeyType[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {PIX_KEY_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <TextField
            {...props}
            name="pixKey"
            label="Chave Pix"
            mask={PIX_KEY_MASK[draft.pixKeyType]}
          />
        </div>
      )}
    </>
  );
}

function bankHint(code: string): string {
  const bank = COMMON_BANKS.find((b) => b.code === code.trim());
  return bank ? `${bank.code} · ${bank.name}` : 'Código de 3 dígitos, ex.: 260 (Nu Pagamentos)';
}

function ReviewBlock({
  title,
  children,
  onEdit,
}: {
  title: string;
  children: React.ReactNode;
  onEdit?: () => void;
}) {
  return (
    <div className="grid gap-1 border-b pb-3 text-sm">
      <div className="flex items-center justify-between">
        <p className={overline}>{title}</p>
        {onEdit ? (
          <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
            Editar
          </Button>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function ReviewStep({
  draft,
  mode,
  set,
  errors,
  onEdit,
}: StepProps & { mode: 'submit' | 'change'; onEdit: (step: number) => void }) {
  return (
    <div className="grid gap-3">
      {mode === 'submit' ? (
        <>
          <ReviewBlock title="Quem recebe" onEdit={() => onEdit(0)}>
            <p>
              {draft.documentType === 'CNPJ' ? 'Empresa' : 'Pessoa física'} · {draft.document} ·{' '}
              {draft.legalName}
            </p>
            {draft.documentType === 'CNPJ' ? (
              <p className="text-muted-foreground">
                Responsável: {draft.responsibleName} · CPF {draft.responsibleCpf}
              </p>
            ) : null}
            <p className="text-muted-foreground">
              {draft.phone} · {draft.email}
            </p>
          </ReviewBlock>
          <ReviewBlock title="Endereço" onEdit={() => onEdit(1)}>
            <p>
              {draft.street}, {draft.number}
              {draft.complement ? ` – ${draft.complement}` : ''} · {draft.neighborhood}
            </p>
            <p className="text-muted-foreground">
              {draft.city} - {draft.state.toUpperCase()} · CEP {draft.postalCode}
            </p>
          </ReviewBlock>
        </>
      ) : null}
      <ReviewBlock title="Onde receber" onEdit={() => onEdit(2)}>
        <p>{payoutSummary(draft)}</p>
      </ReviewBlock>
      <Field label="Termos" group error={errors.acceptTerms}>
        <div className="flex items-start gap-2">
          <Checkbox
            id="m-acceptTerms"
            checked={draft.acceptTerms}
            onCheckedChange={(checked) => set('acceptTerms', checked === true)}
          />
          <Label htmlFor="m-acceptTerms" className="leading-5 font-normal">
            Li e aceito os termos do parceiro de pagamentos e as condições de recebimento do Space
            Sports.
          </Label>
        </div>
      </Field>
    </div>
  );
}
