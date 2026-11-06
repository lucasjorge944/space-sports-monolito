'use client';

import {
  type Advertiser,
  useSuperCreateAdvertiser,
  useSuperUpdateAdvertiser,
} from '@space-sports/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, Store } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/auth/form-alert';
import { SubmitButton } from '@/components/auth/submit-button';
import { Field } from '@/components/painel/field';
import { OptionCards } from '@/components/painel/option-cards';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { MaskedInput } from '@/components/ui/masked-input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  AD_CATEGORIES,
  AD_CATEGORY_LABELS,
  type AdvertiserFormValues,
  adErrorField,
  adErrorMessage,
  advertiserFormFrom,
  advertiserKindLabel,
  advertiserPayload,
  emptyAdvertiserForm,
  validateAdvertiser,
} from '@/lib/super/ads';
import { fieldErrorsFrom } from '@/lib/super/api-errors';
import { invalidateSuper } from '@/lib/super/invalidate';
import { focusFirstInvalid } from '@/lib/utils';
import { SpacePicker } from './space-picker';

/** Criar ou editar anunciante (RF-ADS-01). Tipo e espaço não mudam depois de criado. */
export function AdvertiserDialog({
  open,
  advertiser,
  onClose,
}: {
  open: boolean;
  advertiser: Advertiser | undefined;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        {open ? (
          <AdvertiserForm key={advertiser?.id ?? 'new'} advertiser={advertiser} onClose={onClose} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function AdvertiserForm({
  advertiser,
  onClose,
}: {
  advertiser: Advertiser | undefined;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const create = useSuperCreateAdvertiser();
  const update = useSuperUpdateAdvertiser();
  const editing = advertiser !== undefined;
  const [values, setValues] = useState<AdvertiserFormValues>(() =>
    advertiser ? advertiserFormFrom(advertiser) : emptyAdvertiserForm(),
  );
  const [spaceName, setSpaceName] = useState(advertiser?.space?.name);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const pending = create.isPending || update.isPending;

  const set = <K extends keyof AdvertiserFormValues>(key: K, value: AdvertiserFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(undefined);
    const found = validateAdvertiser(values, editing);
    setErrors(found);
    if (Object.keys(found).length > 0) return focusFirstInvalid(event.currentTarget);
    try {
      if (advertiser) {
        await update.mutateAsync({ advertiserId: advertiser.id, data: advertiserPayload(values) });
        toast.success('Anunciante atualizado.');
      } else {
        await create.mutateAsync({
          data: {
            ...advertiserPayload(values),
            kind: values.kind,
            ...(values.kind === 'SPACE' ? { spaceId: values.spaceId } : {}),
          },
        });
        toast.success('Anunciante criado.');
      }
      await invalidateSuper(queryClient);
      onClose();
    } catch (error) {
      const fields = fieldErrorsFrom(error);
      const field = adErrorField(error);
      const message = adErrorMessage(error);
      if (field) fields[field] = message;
      setErrors(fields);
      setFormError(field ? 'Confira os campos destacados.' : message);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{editing ? 'Editar anunciante' : 'Novo anunciante'}</DialogTitle>
        <DialogDescription>
          Empresa ou espaço parceiro que compra anúncios. A cobrança acontece fora da plataforma.
        </DialogDescription>
      </DialogHeader>

      {editing ? (
        <p className="text-sm">
          <span className="text-muted-foreground">Tipo: </span>
          {advertiserKindLabel[values.kind]}
          {advertiser?.space ? ` · ${advertiser.space.name}` : null}
        </p>
      ) : (
        <Field label="Tipo" group>
          <OptionCards
            label="Tipo de anunciante"
            name="advertiser-kind"
            value={values.kind}
            onChange={(kind) => {
              set('kind', kind);
              if (kind === 'SPACE' && !values.category) set('category', 'SPORTS_SPACE');
            }}
            options={[
              {
                value: 'COMPANY',
                label: 'Empresa',
                description: 'Marca de fora da plataforma: loja, suplemento, evento, serviço.',
                icon: Store,
              },
              {
                value: 'SPACE',
                label: 'Espaço',
                description:
                  'Espaço parceiro da plataforma. Pode publicar sem imagem, com a capa dele.',
                icon: Building2,
              },
            ]}
          />
        </Field>
      )}

      {!editing && values.kind === 'SPACE' ? (
        <SpacePicker
          label="Espaço anunciante"
          value={values.spaceId}
          selectedName={spaceName}
          error={errors.spaceId}
          hint="Só espaços ativos; cada espaço tem um anunciante ativo."
          onChange={(spaceId, space) => {
            set('spaceId', spaceId);
            setSpaceName(space?.name);
            if (space && !values.name.trim()) set('name', space.name);
          }}
        />
      ) : null}

      <Field label="Nome" htmlFor="advertiser-name" error={errors.name}>
        <Input
          name="name"
          maxLength={120}
          value={values.name}
          onChange={(event) => set('name', event.target.value)}
          autoComplete="off"
        />
      </Field>

      <Field
        label="Categoria"
        htmlFor="advertiser-category"
        error={errors.category}
        hint="Apostas (bets) e bebidas alcoólicas não podem anunciar. Suplementos podem."
      >
        <Select
          name="category"
          value={values.category}
          onChange={(event) =>
            set('category', event.target.value as AdvertiserFormValues['category'])
          }
        >
          <option value="">Escolha a categoria</option>
          {AD_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {AD_CATEGORY_LABELS[category]}
            </option>
          ))}
        </Select>
      </Field>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-medium">Contato comercial</legend>
        <Field
          label="Nome do contato"
          htmlFor="advertiser-contact-name"
          optional
          error={errors.contactName}
        >
          <Input
            name="contactName"
            maxLength={120}
            value={values.contactName}
            onChange={(event) => set('contactName', event.target.value)}
            autoComplete="off"
          />
        </Field>
        <Field
          label="E-mail"
          htmlFor="advertiser-contact-email"
          optional
          error={errors.contactEmail}
        >
          <Input
            name="contactEmail"
            type="email"
            maxLength={254}
            value={values.contactEmail}
            onChange={(event) => set('contactEmail', event.target.value)}
            autoComplete="off"
          />
        </Field>
        <Field
          label="Telefone"
          htmlFor="advertiser-contact-phone"
          optional
          error={errors.contactPhone}
        >
          <MaskedInput
            mask="phone"
            name="contactPhone"
            value={values.contactPhone}
            onValueChange={(value) => set('contactPhone', value)}
            autoComplete="off"
          />
        </Field>
      </fieldset>

      <Field label="Observações" htmlFor="advertiser-notes" optional error={errors.notes}>
        <Textarea
          name="notes"
          rows={3}
          maxLength={2000}
          value={values.notes}
          onChange={(event) => set('notes', event.target.value)}
        />
      </Field>

      <FormError message={formError} />
      <DialogFooter>
        <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
          Cancelar
        </Button>
        <SubmitButton pending={pending} pendingLabel="Salvando…">
          {editing ? 'Salvar' : 'Criar anunciante'}
        </SubmitButton>
      </DialogFooter>
    </form>
  );
}
