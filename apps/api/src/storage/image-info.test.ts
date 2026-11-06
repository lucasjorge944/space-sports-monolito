import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { imageInfo } from './image-info.js';

// Imagens mínimas geradas com o Pillow (cor Mar #03547D).
const fixture = (base64: string) => new Uint8Array(Buffer.from(base64, 'base64'));
const PNG_3x2 = fixture(
  'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAFUlEQVR4nGNkDqllYGBgYGBgYoABAA6qANj4KocdAAAAAElFTkSuQmCC',
);
const WEBP_LOSSY_3x2 = fixture(
  'UklGRjgAAABXRUJQVlA4ICwAAADQAQCdASoDAAIAAUAmJaACdLoB+AADsAD+9pWX/jdkKh9vP/zYGqLN8tAAAA==',
);
const WEBP_LOSSLESS_4x4 = fixture('UklGRiIAAABXRUJQVlA4TBUAAAAvA8AAAAdQKoUAAqCgaV//Y0RE/wMA');
const WEBP_EXTENDED_6x3 = fixture(
  'UklGRlwAAABXRUJQVlA4WAoAAAAQAAAABQAAAgAAQUxQSAoAAAABB1DAiAhERP8DVlA4ICwAAADQAQCdASoGAAMAAUAmJaACdLoB+AADsAD+9pWX/jdkKh9vP/zYGqLN8tAAAA==',
);

describe('imageInfo', () => {
  it('lê tipo e dimensões de PNG e WebP (com perdas, sem perdas e estendido)', () => {
    expect(imageInfo(PNG_3x2)).toEqual({ contentType: 'image/png', width: 3, height: 2 });
    expect(imageInfo(WEBP_LOSSY_3x2)).toEqual({ contentType: 'image/webp', width: 3, height: 2 });
    expect(imageInfo(WEBP_LOSSLESS_4x4)).toEqual({
      contentType: 'image/webp',
      width: 4,
      height: 4,
    });
    expect(imageInfo(WEBP_EXTENDED_6x3)).toEqual({
      contentType: 'image/webp',
      width: 6,
      height: 3,
    });
  });

  it('lê JPEG progressivo (logos dos parceiros, 150x150)', () => {
    const logo = readFileSync(new URL('../db/demo-assets/duna-sports.jpg', import.meta.url));
    expect(imageInfo(new Uint8Array(logo))).toEqual({
      contentType: 'image/jpeg',
      width: 150,
      height: 150,
    });
  });

  it('recusa o que não é imagem ou está truncado', () => {
    expect(imageInfo(new Uint8Array())).toBeNull();
    expect(imageInfo(new TextEncoder().encode('<html><body>oi</body></html>'))).toBeNull();
    expect(imageInfo(PNG_3x2.subarray(0, 20))).toBeNull();
    expect(imageInfo(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]))).toBeNull();
    expect(imageInfo(WEBP_LOSSY_3x2.subarray(0, 25))).toBeNull();
  });
});
