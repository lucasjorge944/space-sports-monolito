import type { PublicSpace } from '@space-sports/api-client';
import {
  bookingOnlineOptions,
  bookingPaymentChoices,
  classOnlineOptions,
  defaultPaymentOption,
} from './options';

type Online = PublicSpace['onlinePayments'];

const SANDBOX = { provider: 'fake', enabled: true, sandbox: { testCards: [] } };
const space = (
  rental: Online['rental'],
  classes: Online['classes'] = { mode: 'ON_SITE', options: ['ON_SITE'] },
  paymentEnvironment: unknown = SANDBOX,
) =>
  ({ onlinePayments: { rental, classes }, paymentEnvironment }) as Pick<
    PublicSpace,
    'onlinePayments' | 'paymentEnvironment'
  >;

describe('forma de pagamento pelo modo do espaço (RF-ONPAY-03)', () => {
  it('ON_SITE: só no local, sem a etapa nova', () => {
    expect(bookingPaymentChoices(space({ mode: 'ON_SITE', options: ['ON_SITE'] }), 10_000)).toEqual(
      {
        mode: 'ON_SITE',
        options: ['ON_SITE'],
        online: false,
      },
    );
  });

  it('ONLINE_OPTIONAL: Pix primeiro, depois cartão e "No local" por último', () => {
    const choices = bookingPaymentChoices(
      space({ mode: 'ONLINE_OPTIONAL', options: ['ON_SITE', 'ONLINE_CARD', 'ONLINE_PIX'] }),
      10_000,
    );
    expect(choices).toEqual({
      mode: 'ONLINE_OPTIONAL',
      options: ['ONLINE_PIX', 'ONLINE_CARD', 'ON_SITE'],
      online: true,
    });
    expect(defaultPaymentOption(choices.options)).toBe('ONLINE_PIX');
  });

  it('ONLINE_REQUIRED: sem "No local", mesmo se a API listasse', () => {
    const choices = bookingPaymentChoices(
      space({ mode: 'ONLINE_REQUIRED', options: ['ON_SITE', 'ONLINE_PIX', 'ONLINE_CARD'] }),
      10_000,
    );
    expect(choices.options).toEqual(['ONLINE_PIX', 'ONLINE_CARD']);
  });

  it('só os meios que o serviço aceita; com um só, ele vem marcado', () => {
    const choices = bookingPaymentChoices(
      space({ mode: 'ONLINE_REQUIRED', options: ['ONLINE_CARD'] }),
      10_000,
    );
    expect(choices.options).toEqual(['ONLINE_CARD']);
    expect(defaultPaymentOption(choices.options)).toBe('ONLINE_CARD');
  });

  it('reserva gratuita não tem o que pagar online', () => {
    expect(
      bookingPaymentChoices(space({ mode: 'ONLINE_REQUIRED', options: ['ONLINE_PIX'] }), 0).online,
    ).toBe(false);
  });

  it('espaço sem o campo (cache antigo) fica no local', () => {
    expect(bookingPaymentChoices({} as Pick<PublicSpace, 'onlinePayments'>, 10_000).online).toBe(
      false,
    );
  });

  it('folha "Pagar" da reserva criada: só as formas online', () => {
    expect(
      bookingOnlineOptions(
        space({ mode: 'ONLINE_OPTIONAL', options: ['ON_SITE', 'ONLINE_PIX', 'ONLINE_CARD'] }),
      ),
    ).toEqual(['ONLINE_PIX', 'ONLINE_CARD']);
    expect(bookingOnlineOptions(space({ mode: 'ON_SITE', options: ['ON_SITE'] }))).toEqual([]);
    expect(bookingOnlineOptions(undefined)).toEqual([]);
  });

  it('mensalidade: "Pagar agora" só com o modo de aulas opcional (RF-ONPAY-05)', () => {
    const rental = { mode: 'ON_SITE', options: ['ON_SITE'] } as Online['rental'];
    expect(
      classOnlineOptions(
        space(rental, {
          mode: 'ONLINE_OPTIONAL',
          options: ['ON_SITE', 'ONLINE_PIX', 'ONLINE_CARD'],
        }),
      ),
    ).toEqual(['ONLINE_PIX', 'ONLINE_CARD']);
    expect(classOnlineOptions(space(rental))).toEqual([]);
    expect(classOnlineOptions(undefined)).toEqual([]);
  });

  it('sem o tokenizador (gateway real sem SDK), o cartão nem aparece', () => {
    const real = { provider: 'acme', enabled: true, sandbox: null };
    const rental = {
      mode: 'ONLINE_REQUIRED',
      options: ['ONLINE_PIX', 'ONLINE_CARD'],
    } as Online['rental'];
    expect(bookingPaymentChoices(space(rental, undefined, real), 10_000).options).toEqual([
      'ONLINE_PIX',
    ]);
    expect(bookingOnlineOptions(space(rental, undefined, real))).toEqual(['ONLINE_PIX']);
    expect(
      classOnlineOptions(
        space(rental, { mode: 'ONLINE_OPTIONAL', options: ['ONLINE_CARD'] }, real),
      ),
    ).toEqual([]);
  });
});
