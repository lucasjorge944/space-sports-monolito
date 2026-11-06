import { Linking } from 'react-native';
import {
  adAccessibilityLabel,
  destinationHint,
  destinationLabel,
  externalAdUrl,
  isSafeHttpsUrl,
  isWhatsappUrl,
  openAdDestination,
  urlDomain,
} from './ad-destination';
import { makeAd, makeSpace } from './test-fixtures';

describe('destinos dos anúncios (RF-ADS-05)', () => {
  let openURL: jest.SpyInstance;
  beforeEach(() => {
    openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  });
  afterEach(() => openURL.mockRestore());

  it('URL externa abre no navegador do sistema, só https', async () => {
    const openSpace = jest.fn();
    await expect(
      openAdDestination({ type: 'URL', url: 'https://example.com/loja?x=1' }, openSpace),
    ).resolves.toBe(true);
    expect(openURL).toHaveBeenCalledWith('https://example.com/loja?x=1');
    expect(openSpace).not.toHaveBeenCalled();
  });

  it.each([
    'http://example.com',
    'javascript:alert(1)',
    'intent://x',
    'https://exa mple.com',
    'https://',
  ])('recusa %s', async (url) => {
    expect(isSafeHttpsUrl(url)).toBe(false);
    await expect(openAdDestination({ type: 'URL', url }, jest.fn())).resolves.toBe(false);
    expect(openURL).not.toHaveBeenCalled();
  });

  it('WhatsApp abre o link wa.me que a API entrega, sem remontar', async () => {
    const url =
      'https://wa.me/5531999998888?text=Oi!%20Vi%20o%20an%C3%BAncio%20no%20Space%20Sports';
    await expect(
      openAdDestination(
        { type: 'WHATSAPP', phone: '+55 31 99999-8888', message: 'outra mensagem', url },
        jest.fn(),
      ),
    ).resolves.toBe(true);
    expect(openURL).toHaveBeenCalledWith(url);
  });

  it.each([
    'https://example.com/5531999998888',
    'http://wa.me/5531999998888',
    'https://wa.me.evil.com/5531',
    'https://wa.me/',
    'whatsapp://send?phone=5531999998888',
  ])('WhatsApp recusa %s', async (url) => {
    expect(isWhatsappUrl(url)).toBe(false);
    await expect(
      openAdDestination({ type: 'WHATSAPP', phone: '+5531999998888', message: '', url }, jest.fn()),
    ).resolves.toBe(false);
    expect(openURL).not.toHaveBeenCalled();
  });

  it('espaço abre pela rota interna', async () => {
    const openSpace = jest.fn();
    await openAdDestination({ type: 'SPACE', space: makeSpace(1) }, openSpace);
    expect(openSpace).toHaveBeenCalledWith('espaco-1');
    expect(openURL).not.toHaveBeenCalled();
    expect(externalAdUrl({ type: 'SPACE', space: makeSpace(1) })).toBeNull();
  });

  it('sem app para o link, devolve false sem quebrar', async () => {
    openURL.mockRejectedValueOnce(new Error('no handler'));
    await expect(
      openAdDestination({ type: 'URL', url: 'https://example.com' }, jest.fn()),
    ).resolves.toBe(false);
  });

  it('rótulos do rodapé e dicas de acessibilidade', () => {
    expect(urlDomain('https://www.Example.com/a')).toBe('example.com');
    expect(destinationLabel({ type: 'URL', url: 'https://www.example.com/a' })).toBe('example.com');
    expect(
      destinationLabel({ type: 'WHATSAPP', phone: '+55', message: '', url: 'https://wa.me/55' }),
    ).toBe('WhatsApp');
    expect(destinationLabel({ type: 'SPACE', space: makeSpace(1) })).toBe(
      'Savassi · Belo Horizonte',
    );
    expect(destinationHint({ type: 'URL', url: 'https://example.com' })).toBe(
      'Abre o site do anunciante',
    );
  });

  it('rótulo da peça começa com "Patrocinado, <anunciante>"', () => {
    expect(adAccessibilityLabel(makeAd('a'), { index: 0, total: 3 })).toBe(
      'Patrocinado, Anunciante a. Título a. Texto a. Ver ofertas. Anúncio 1 de 3',
    );
    expect(adAccessibilityLabel(makeAd('a', { body: null }))).toBe(
      'Patrocinado, Anunciante a. Título a. Ver ofertas',
    );
  });
});
