import { describe, expect, it } from 'vitest';
import {
  AVATAR_OUTPUT_SIZE,
  avatarFileName,
  cropRect,
  outputSize,
  outputTypeFor,
  panAfterDrag,
  producedType,
  validateAvatarSource,
} from './avatar';

describe('validateAvatarSource', () => {
  it('aceita JPEG, PNG e WebP e recusa o resto, vazio ou grande demais', () => {
    expect(validateAvatarSource({ type: 'image/png', size: 1000 })).toBeNull();
    expect(validateAvatarSource({ type: 'image/gif', size: 1000 })).toBe(
      'Use uma imagem JPEG, PNG ou WebP.',
    );
    expect(validateAvatarSource({ type: 'image/jpeg', size: 0 })).toBe('O arquivo está vazio.');
    expect(validateAvatarSource({ type: 'image/webp', size: 21 * 1024 * 1024 })).toBe(
      'A imagem passa de 20 MB.',
    );
  });
});

describe('recorte quadrado', () => {
  const landscape = { width: 1600, height: 900 };

  it('sem zoom: o maior quadrado, centralizado', () => {
    expect(cropRect(landscape, 1, { x: 0, y: 0 })).toEqual({ x: 350, y: 0, size: 900 });
  });

  it('o deslocamento leva o quadrado até a borda, sem sair da imagem', () => {
    expect(cropRect(landscape, 1, { x: -1, y: 0 })).toEqual({ x: 0, y: 0, size: 900 });
    expect(cropRect(landscape, 1, { x: 5, y: 0 })).toEqual({ x: 700, y: 0, size: 900 });
  });

  it('o zoom reduz o quadrado (limitado a 3×)', () => {
    expect(cropRect(landscape, 2, { x: 0, y: 0 })).toEqual({ x: 575, y: 225, size: 450 });
    expect(cropRect(landscape, 10, { x: 0, y: 0 }).size).toBe(300);
  });

  it('arrastar a prévia para a direita mostra mais da esquerda da imagem', () => {
    const pan = panAfterDrag(landscape, 1, { x: 0, y: 0 }, { dx: 50, dy: 0 }, 300);
    expect(pan.x).toBeLessThan(0);
    expect(pan.y).toBe(0);
    // Arrasto grande para no limite.
    expect(panAfterDrag(landscape, 1, { x: 0, y: 0 }, { dx: 5000, dy: 0 }, 300).x).toBe(-1);
  });

  it('o arquivo final é quadrado, sem ampliar imagem pequena', () => {
    expect(outputSize({ x: 0, y: 0, size: 900 })).toBe(AVATAR_OUTPUT_SIZE);
    expect(outputSize({ x: 0, y: 0, size: 200 })).toBe(200);
  });

  it('o recorte mantém o formato: PNG e WebP não perdem a transparência', () => {
    expect(outputTypeFor('image/png')).toBe('image/png');
    expect(outputTypeFor('image/webp')).toBe('image/webp');
    expect(outputTypeFor('image/jpeg')).toBe('image/jpeg');
  });

  it('navegador sem codificador WebP devolve PNG, que vale como está', () => {
    expect(producedType('image/webp', 'image/png')).toBe('image/png');
    expect(producedType('image/webp', 'image/webp')).toBe('image/webp');
    expect(producedType('image/jpeg', '')).toBe('image/jpeg');
    expect(avatarFileName('image/webp')).toBe('foto.webp');
  });
});
