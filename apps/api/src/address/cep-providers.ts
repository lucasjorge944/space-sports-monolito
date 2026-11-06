import type { CepAddress } from '@space-sports/shared';
import { z } from 'zod';

/** Timeout curto por provedor: quem preenche o formulário não pode ficar esperando. */
const PROVIDER_TIMEOUT_MS = 2_500;

const optionalText = z.string().nullish();
const uf = z.string().length(2);

/** O provedor devolve o endereço, ou `null` se o CEP não existe; lança se estiver indisponível. */
export type CepProvider = { name: string; lookup: (cep: string) => Promise<CepAddress | null> };

const textOrNull = (value: string | null | undefined) => value?.trim() || null;

const get = (url: string) =>
  fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });

const viaCepBody = z.object({
  logradouro: optionalText,
  bairro: optionalText,
  localidade: z.string().min(1),
  uf,
});

/** https://viacep.com.br: CEP inexistente é 200 com `{ erro: true }` (ou `"true"`). */
const viaCep: CepProvider = {
  name: 'viacep',
  async lookup(cep) {
    const res = await get(`https://viacep.com.br/ws/${cep}/json/`);
    if (!res.ok) throw new Error(`ViaCEP respondeu ${res.status}`);
    const body: unknown = await res.json();
    if (z.object({ erro: z.unknown() }).safeParse(body).data?.erro) return null;
    const address = viaCepBody.parse(body);
    return {
      postalCode: cep,
      street: textOrNull(address.logradouro),
      neighborhood: textOrNull(address.bairro),
      city: address.localidade,
      state: address.uf,
    };
  },
};

const brasilApiBody = z.object({
  street: optionalText,
  neighborhood: optionalText,
  city: z.string().min(1),
  state: uf,
});

/** https://brasilapi.com.br: CEP inexistente é 404. */
const brasilApi: CepProvider = {
  name: 'brasilapi',
  async lookup(cep) {
    const res = await get(`https://brasilapi.com.br/api/cep/v1/${cep}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`BrasilAPI respondeu ${res.status}`);
    const address = brasilApiBody.parse(await res.json());
    return {
      postalCode: cep,
      street: textOrNull(address.street),
      neighborhood: textOrNull(address.neighborhood),
      city: address.city,
      state: address.state,
    };
  },
};

/** Na ordem de consulta: o seguinte só entra se o anterior estiver indisponível (decisão 52). */
export const CEP_PROVIDERS: readonly CepProvider[] = [viaCep, brasilApi];
