import { describe, expect, it } from 'vitest';
import {
  isPublishedKeyOf,
  isScopedUploadKey,
  newPublishedKey,
  newScopedUploadKey,
  publishedPrefix,
} from './uploads.js';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.source;
const SCOPE = 'users/0190a1b2-0000-7000-8000-000000000001/avatar';

describe('chaves de upload', () => {
  it('upload sob uploads/<escopo>/; só o formato gerado é aceito no escopo', () => {
    const key = newScopedUploadKey(SCOPE, 'image/png');
    expect(key).toMatch(new RegExp(`^uploads/${SCOPE}/${UUID}\\.png$`));
    expect(isScopedUploadKey(SCOPE, key)).toBe(true);
    expect(isScopedUploadKey('users/outro/avatar', key)).toBe(false);
    expect(isScopedUploadKey(SCOPE, `uploads/${SCOPE}/../x/${key.split('/').at(-1)}`)).toBe(false);
  });

  it('chave publicada nova a cada registro, fora de uploads/, com o uuid do upload', () => {
    const key = newScopedUploadKey(SCOPE, 'image/webp');
    const uploadUuid = key.split('/').at(-1)?.replace('.webp', '');
    const [a, b] = [newPublishedKey(key), newPublishedKey(key)];
    expect(a).not.toBe(b);
    for (const published of [a, b]) {
      expect(published).toMatch(new RegExp(`^${SCOPE}/${uploadUuid}-${UUID}\\.webp$`));
      expect(published.startsWith(publishedPrefix(key))).toBe(true);
      expect(isPublishedKeyOf(SCOPE, published)).toBe(true);
    }
    // Outro upload do mesmo escopo tem outro prefixo.
    const other = newScopedUploadKey(SCOPE, 'image/webp');
    expect(a.startsWith(publishedPrefix(other))).toBe(false);
    // Formato anterior (`<uuid>.<ext>`) segue reconhecido; o de outro escopo, não.
    expect(isPublishedKeyOf(SCOPE, `${SCOPE}/${uploadUuid}.webp`)).toBe(true);
    expect(isPublishedKeyOf('users/outro/avatar', a)).toBe(false);
    expect(() => newPublishedKey(`${SCOPE}/x.jpg`)).toThrow();
  });
});
