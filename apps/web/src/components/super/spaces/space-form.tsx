'use client';

import {
  type CepAddress,
  type SuperSpace,
  useSuperCreateSpace,
  useSuperListCities,
  useSuperUpdateSpace,
} from '@space-sports/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { FormError } from '@/components/auth/form-alert';
import { FormField } from '@/components/auth/form-field';
import { SubmitButton } from '@/components/auth/submit-button';
import { CepField } from '@/components/painel/cep-field';
import { Field } from '@/components/painel/field';
import { Button } from '@/components/ui/button';
import { MaskedInput } from '@/components/ui/masked-input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { findCity } from '@/lib/painel/space-data';
import { fieldErrorsFrom } from '@/lib/super/api-errors';
import { invalidateSuper } from '@/lib/super/invalidate';
import {
  emptySpaceForm,
  type SpaceFormField,
  type SpaceFormValues,
  spaceToForm,
  toCreateInput,
  toUpdateInput,
  validateSpaceForm,
} from '@/lib/super/space-form';
import { focusFirstInvalid } from '@/lib/utils';
import { describeError } from '../query-states';

type SpaceFormProps = { mode: 'create' } | { mode: 'edit'; space: SuperSpace };

const API_FIELD: Record<string, SpaceFormField> = {
  name: 'name',
  slug: 'slug',
  cityId: 'cityId',
  description: 'description',
  'address.street': 'street',
  'address.number': 'number',
  'address.neighborhood': 'neighborhood',
  'address.postalCode': 'postalCode',
  phone: 'phone',
  whatsapp: 'whatsapp',
  instagram: 'instagram',
  ownerEmail: 'ownerEmail',
};

export function SpaceForm(props: SpaceFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const cities = useSuperListCities();
  const create = useSuperCreateSpace();
  const update = useSuperUpdateSpace();
  const editing = props.mode === 'edit';

  const [values, setValues] = useState<SpaceFormValues>(
    props.mode === 'edit' ? spaceToForm(props.space) : emptySpaceForm,
  );
  const [errors, setErrors] = useState<Partial<Record<SpaceFormField, string>>>({});
  const [formError, setFormError] = useState<string>();
  const pending = create.isPending || update.isPending;
  const streetRef = useRef<HTMLInputElement>(null);
  const numberRef = useRef<HTMLInputElement>(null);

  const setValue = (field: SpaceFormField, value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  function fillAddress(address: CepAddress) {
    (address.street ? numberRef : streetRef).current?.focus();
    const city = findCity(cities.data?.items.filter((c) => c.active) ?? [], address);
    setValues((current) => ({
      ...current,
      street: address.street ?? current.street,
      neighborhood: address.neighborhood ?? current.neighborhood,
      cityId: city?.id ?? current.cityId,
    }));
    return city
      ? undefined
      : `${address.city} - ${address.state} não está na lista. Escolha a cidade`;
  }

  const set =
    (field: SpaceFormField) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setValue(field, event.target.value);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(undefined);
    const found = validateSpaceForm(values, props.mode);
    setErrors(found ?? {});
    if (found) return focusFirstInvalid(event.currentTarget);

    try {
      if (props.mode === 'edit') {
        await update.mutateAsync({ spaceId: props.space.id, data: toUpdateInput(values) });
        await invalidateSuper(queryClient);
        router.push(`/super/espacos/${props.space.id}`);
        return;
      }
      const created = await create.mutateAsync({ data: toCreateInput(values) });
      await invalidateSuper(queryClient);
      const invite = created.ownerInvite ? `?convite=${created.ownerInvite.status}` : '';
      router.push(`/super/espacos/${created.space.id}${invite}`);
    } catch (thrown) {
      const apiErrors = fieldErrorsFrom(thrown);
      const mapped: Partial<Record<SpaceFormField, string>> = {};
      for (const [path, message] of Object.entries(apiErrors)) {
        const field = API_FIELD[path];
        if (field) mapped[field] = message;
      }
      setErrors(mapped);
      setFormError(
        Object.keys(mapped).length > 0 ? 'Confira os campos destacados.' : describeError(thrown),
      );
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid max-w-2xl gap-6">
      <section className="grid gap-4" aria-labelledby="dados-basicos">
        <h2 id="dados-basicos" className="text-lg font-semibold">
          Dados básicos
        </h2>
        <FormField
          name="name"
          label="Nome do espaço"
          value={values.name}
          onChange={set('name')}
          error={errors.name}
          maxLength={120}
          autoComplete="off"
        />
        <FormField
          name="slug"
          label="Endereço na web (slug)"
          value={values.slug}
          onChange={set('slug')}
          error={errors.slug}
          placeholder={editing ? undefined : 'Gerado a partir do nome se vazio'}
          maxLength={80}
          autoComplete="off"
        />
        <Field
          htmlFor="cityId"
          label="Cidade"
          error={errors.cityId}
          hint={
            cities.isError ? 'Não foi possível carregar as cidades. Recarregue a página' : undefined
          }
        >
          <Select
            id="cityId"
            name="cityId"
            value={values.cityId}
            onChange={set('cityId')}
            disabled={cities.isPending}
          >
            <option value="">{cities.isPending ? 'Carregando…' : 'Selecione'}</option>
            {cities.data?.items
              .filter((city) => city.active || city.id === values.cityId)
              .map((city) => (
                <option key={city.id} value={city.id}>
                  {city.name} - {city.state}
                </option>
              ))}
          </Select>
        </Field>
        <Field htmlFor="description" label="Descrição" optional error={errors.description}>
          <Textarea
            id="description"
            name="description"
            value={values.description}
            onChange={set('description')}
            maxLength={2000}
            rows={4}
          />
        </Field>
      </section>

      <section className="grid gap-4" aria-labelledby="endereco">
        <h2 id="endereco" className="text-lg font-semibold">
          Endereço
        </h2>
        <p className="text-muted-foreground -mt-2 text-sm">
          Preencha todos os campos ou nenhum. O mapa é calculado a partir do endereço.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <CepField
            id="postalCode"
            value={values.postalCode}
            onValueChange={(value) => setValue('postalCode', value)}
            onFound={fillAddress}
            error={errors.postalCode}
          />
          <div className="sm:col-span-2">
            <FormField
              ref={streetRef}
              name="street"
              label="Rua"
              value={values.street}
              onChange={set('street')}
              error={errors.street}
              maxLength={200}
            />
          </div>
          <FormField
            ref={numberRef}
            name="number"
            label="Número"
            value={values.number}
            onChange={set('number')}
            error={errors.number}
            maxLength={20}
          />
          <div className="sm:col-span-2">
            <FormField
              name="neighborhood"
              label="Bairro"
              value={values.neighborhood}
              onChange={set('neighborhood')}
              error={errors.neighborhood}
              maxLength={100}
            />
          </div>
        </div>
      </section>

      <section className="grid gap-4" aria-labelledby="contato">
        <h2 id="contato" className="text-lg font-semibold">
          Contato
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field htmlFor="phone" label="Telefone" optional error={errors.phone}>
            <MaskedInput
              mask="phone"
              name="phone"
              value={values.phone}
              onValueChange={(value) => setValue('phone', value)}
            />
          </Field>
          <Field htmlFor="whatsapp" label="WhatsApp" optional error={errors.whatsapp}>
            <MaskedInput
              mask="phone"
              name="whatsapp"
              value={values.whatsapp}
              onValueChange={(value) => setValue('whatsapp', value)}
            />
          </Field>
        </div>
        <FormField
          name="instagram"
          label="Instagram"
          value={values.instagram}
          onChange={set('instagram')}
          error={errors.instagram}
          placeholder="usuario"
          autoComplete="off"
        />
      </section>

      {editing ? null : (
        <section className="grid gap-4" aria-labelledby="dono">
          <h2 id="dono" className="text-lg font-semibold">
            Dono
          </h2>
          <FormField
            name="ownerEmail"
            label="E-mail do Dono"
            optional
            type="email"
            value={values.ownerEmail}
            onChange={set('ownerEmail')}
            error={errors.ownerEmail}
            autoComplete="off"
            hint="Só contas com e-mail verificado viram Dono na hora. Você pode convidar depois, no detalhe do espaço."
          />
        </section>
      )}

      <FormError message={formError} />
      <div className="flex gap-2">
        <SubmitButton pending={pending} pendingLabel="Salvando…">
          {editing ? 'Salvar alterações' : 'Criar espaço'}
        </SubmitButton>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() =>
            router.push(editing ? `/super/espacos/${props.space.id}` : '/super/espacos')
          }
        >
          Cancelar
        </Button>
      </div>
    </form>
  );
}
