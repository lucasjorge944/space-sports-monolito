import { instagramHandle, instagramUrl, telUrl, wazeUrl, whatsappUrl } from './links';

describe('links do espaço', () => {
  it('tel e WhatsApp ignoram máscara', () => {
    expect(telUrl('+55 (31) 99999-8888')).toBe('tel:+5531999998888');
    expect(whatsappUrl('+5531999998888')).toBe('https://wa.me/5531999998888');
  });

  it('WhatsApp sem DDI assume o Brasil', () => {
    expect(whatsappUrl('(31) 99999-8888')).toBe('https://wa.me/5531999998888');
  });

  it('Instagram aceita @, nome puro e URL', () => {
    expect(instagramUrl('@arena')).toBe('https://instagram.com/arena');
    expect(instagramUrl('arena')).toBe('https://instagram.com/arena');
    expect(instagramUrl('https://instagram.com/arena/')).toBe('https://instagram.com/arena/');
    expect(instagramHandle('https://www.instagram.com/arena/')).toBe('@arena');
    expect(instagramHandle('arena')).toBe('@arena');
  });

  it('Waze leva às coordenadas', () => {
    expect(wazeUrl({ lat: -19.9, lng: -43.9 })).toBe(
      'https://waze.com/ul?ll=-19.9,-43.9&navigate=yes',
    );
  });
});
