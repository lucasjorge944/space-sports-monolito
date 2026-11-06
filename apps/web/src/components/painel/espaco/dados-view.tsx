'use client';

import {
  type CepAddress,
  type ManagedSpace,
  useGetManagedSpace,
  useListAmenities,
  useListCities,
  useReplaceSpaceAmenities,
  useUpdateManagedSpace,
} from '@space-sports/api-client';
import { maskCep, normalizeCep, normalizePhone } from '@space-sports/shared';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleAlert, ExternalLink, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/auth/form-alert';
import { CepField } from '@/components/painel/cep-field';
import { Field } from '@/components/painel/field';
import { ReadOnlyNotice, SpaceGate, type SpaceScope } from '@/components/painel/space-scope';
import { ErrorState, LoadingBlock, PageHeader } from '@/components/painel/states';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Textarea } from '@/components/ui/textarea';
import { formatPhone } from '@/lib/format';
import { apiErrorMessage } from '@/lib/painel/errors';
import { invalidateSpace } from '@/lib/painel/query';
import { findCity, normalizeInstagram } from '@/lib/painel/space-data';
import { focusFirstInvalid } from '@/lib/utils';
import { LogoCard } from './logo-card';
import { OpeningHoursEditor } from './opening-hours-editor';

export function DadosView() {
  return <SpaceGate permission="schedule.view">{(scope) => <Dados scope={scope} />}</SpaceGate>;
}

const SHOWCASE_MISSING: Record<string, string> = {
  ACTIVE_STATUS: 'o espaço precisa estar ativo',
  ACTIVE_COURT: 'cadastre ao menos uma quadra ativa',
  PRICE_PER_HOUR: 'defina o preço por hora nas configurações',
};

function Dados({ scope }: { scope: SpaceScope }) {
  const query = useGetManagedSpace(scope.spaceId);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Espaço"
        description="Dados, contatos, infraestrutura e funcionamento."
        actions={
          <Button variant="outline" asChild>
            <Link href={`/espacos/${scope.slug}`} target="_blank">
              <ExternalLink /> Ver página pública
            </Link>
          </Button>
        }
      />
      <ReadOnlyNotice scope={scope} />
      {query.isPending ? (
        <LoadingBlock rows={5} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <Showcase space={query.data} />
          <LogoCard scope={scope} space={query.data} />
          <DadosForm scope={scope} space={query.data} />
          <AmenitiesForm scope={scope} space={query.data} />
          <OpeningHoursEditor scope={scope} initial={query.data.openingHours} />
        </>
      )}
    </div>
  );
}

function Showcase({ space }: { space: ManagedSpace }) {
  const { visible, missing } = space.showcase;
  return (
    <Alert variant={visible ? 'success' : 'warning'} role="status">
      {visible ? <CheckCircle2 aria-hidden /> : <CircleAlert aria-hidden />}
      <p>
        {visible
          ? 'O espaço aparece na vitrine do app.'
          : `O espaço ainda não aparece na vitrine: ${missing.map((m) => SHOWCASE_MISSING[m] ?? m).join('; ')}.`}
      </p>
    </Alert>
  );
}

function DadosForm({ scope, space }: { scope: SpaceScope; space: ManagedSpace }) {
  const queryClient = useQueryClient();
  const editable = scope.canWrite('space.edit');
  const cities = useListCities();
  const save = useUpdateManagedSpace();

  const [description, setDescription] = useState(space.description ?? '');
  const [phone, setPhone] = useState(formatPhone(space.phone));
  const [whatsapp, setWhatsapp] = useState(formatPhone(space.whatsapp));
  const [instagram, setInstagram] = useState(space.instagram ?? '');
  const [cityId, setCityId] = useState(space.address.city.id);
  const [street, setStreet] = useState(space.address.street ?? '');
  const [number, setNumber] = useState(space.address.number ?? '');
  const [neighborhood, setNeighborhood] = useState(space.address.neighborhood ?? '');
  const [postalCode, setPostalCode] = useState(maskCep(space.address.postalCode ?? ''));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const streetRef = useRef<HTMLInputElement>(null);
  const numberRef = useRef<HTMLInputElement>(null);

  function fillAddress(address: CepAddress) {
    if (address.street) setStreet(address.street);
    if (address.neighborhood) setNeighborhood(address.neighborhood);
    (address.street ? numberRef : streetRef).current?.focus();
    const city = findCity(cities.data?.items ?? [], address);
    if (city) setCityId(city.id);
    return city
      ? undefined
      : `${address.city} - ${address.state} não está na lista. Escolha a cidade`;
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    const phoneE164 = phone.trim() ? normalizePhone(phone) : null;
    const whatsappE164 = whatsapp.trim() ? normalizePhone(whatsapp) : null;
    const insta = normalizeInstagram(instagram);
    if (phone.trim() && !phoneE164) next.phone = 'Informe o telefone com DDD';
    if (whatsapp.trim() && !whatsappE164) next.whatsapp = 'Informe o WhatsApp com DDD';
    if (insta && !/^[A-Za-z0-9._]{1,30}$/.test(insta))
      next.instagram = 'Usuário do Instagram inválido';

    const addressTouched = [street, number, neighborhood, postalCode].some((v) => v.trim());
    const cep = normalizeCep(postalCode);
    if (addressTouched) {
      if (!street.trim()) next.street = 'Informe a rua';
      if (!number.trim()) next.number = 'Informe o número';
      if (!neighborhood.trim()) next.neighborhood = 'Informe o bairro';
      if (!cep) next.postalCode = 'Informe o CEP com 8 dígitos';
    }
    setErrors(next);
    if (Object.keys(next).length > 0)
      return focusFirstInvalid(event.currentTarget as HTMLFormElement);

    save.mutate(
      {
        spaceId: scope.spaceId,
        data: {
          description: description.trim() || null,
          phone: phoneE164,
          whatsapp: whatsappE164,
          instagram: insta,
          cityId,
          ...(addressTouched && cep
            ? {
                address: {
                  street: street.trim(),
                  number: number.trim(),
                  neighborhood: neighborhood.trim(),
                  postalCode: cep,
                },
              }
            : {}),
        },
      },
      {
        onSuccess: () => {
          toast.success('Dados do espaço salvos.');
          void invalidateSpace(queryClient, scope.spaceId);
        },
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dados do espaço</CardTitle>
        <CardDescription>
          O endereço é localizado no mapa ao salvar.{' '}
          {space.location ? 'Localização já definida.' : 'Ainda sem localização no mapa.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <FormError message={save.error ? apiErrorMessage(save.error) : undefined} />
          <Field label="Nome" htmlFor="sp-name" hint="O nome é alterado pela plataforma.">
            <Input id="sp-name" value={space.name} disabled readOnly />
          </Field>
          <Field label="Descrição" htmlFor="sp-description">
            <Textarea
              id="sp-description"
              rows={4}
              maxLength={2000}
              disabled={!editable}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Telefone" htmlFor="sp-phone" error={errors.phone}>
              <MaskedInput
                mask="phone"
                id="sp-phone"
                disabled={!editable}
                value={phone}
                onValueChange={setPhone}
              />
            </Field>
            <Field label="WhatsApp" htmlFor="sp-whatsapp" error={errors.whatsapp}>
              <MaskedInput
                mask="phone"
                id="sp-whatsapp"
                disabled={!editable}
                value={whatsapp}
                onValueChange={setWhatsapp}
              />
            </Field>
            <Field label="Instagram" htmlFor="sp-instagram" error={errors.instagram}>
              <Input
                id="sp-instagram"
                placeholder="@usuario"
                disabled={!editable}
                value={instagram}
                onChange={(e) => setInstagram(e.target.value)}
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-6">
            <div className="sm:col-span-2">
              <CepField
                id="sp-postal"
                value={postalCode}
                onValueChange={setPostalCode}
                onFound={fillAddress}
                error={errors.postalCode}
                disabled={!editable}
              />
            </div>
            <div className="sm:col-span-4">
              <Field label="Rua" htmlFor="sp-street" error={errors.street}>
                <Input
                  ref={streetRef}
                  id="sp-street"
                  disabled={!editable}
                  value={street}
                  onChange={(e) => setStreet(e.target.value)}
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Número" htmlFor="sp-number" error={errors.number}>
                <Input
                  ref={numberRef}
                  id="sp-number"
                  disabled={!editable}
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Bairro" htmlFor="sp-neighborhood" error={errors.neighborhood}>
                <Input
                  id="sp-neighborhood"
                  disabled={!editable}
                  value={neighborhood}
                  onChange={(e) => setNeighborhood(e.target.value)}
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Cidade" htmlFor="sp-city">
                <Select value={cityId} onValueChange={setCityId} disabled={!editable}>
                  <SelectTrigger id="sp-city" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(cities.data?.items ?? [space.address.city]).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} - {c.state}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </div>
          {editable ? (
            <Button type="submit" className="w-fit" disabled={save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Salvar dados
            </Button>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

function AmenitiesForm({ scope, space }: { scope: SpaceScope; space: ManagedSpace }) {
  const queryClient = useQueryClient();
  const editable = scope.canWrite('space.edit');
  const catalog = useListAmenities();
  const save = useReplaceSpaceAmenities();
  const [selected, setSelected] = useState<Set<string>>(new Set(space.amenities.map((a) => a.id)));

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Infraestrutura</CardTitle>
        <CardDescription>O que o espaço oferece aos jogadores.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {catalog.isPending ? (
          <LoadingBlock rows={2} />
        ) : catalog.isError ? (
          <ErrorState error={catalog.error} onRetry={() => void catalog.refetch()} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {catalog.data.items.map((a) => (
              <div key={a.id} className="flex items-center gap-2">
                <Checkbox
                  id={`amenity-${a.id}`}
                  disabled={!editable}
                  checked={selected.has(a.id)}
                  onCheckedChange={(v) => toggle(a.id, v === true)}
                />
                <Label htmlFor={`amenity-${a.id}`}>{a.name}</Label>
              </div>
            ))}
          </div>
        )}
        <FormError message={save.error ? apiErrorMessage(save.error) : undefined} />
        {editable ? (
          <Button
            className="w-fit"
            disabled={save.isPending || !catalog.isSuccess}
            onClick={() =>
              save.mutate(
                { spaceId: scope.spaceId, data: { amenityIds: [...selected] } },
                {
                  onSuccess: () => {
                    toast.success('Infraestrutura salva.');
                    void invalidateSpace(queryClient, scope.spaceId);
                  },
                },
              )
            }
          >
            {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Salvar infraestrutura
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
