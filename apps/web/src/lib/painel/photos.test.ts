import { describe, expect, it } from 'vitest';
import { moveItem, validatePhotoFile } from './photos';

describe('photos', () => {
  it('valida tipo e tamanho', () => {
    expect(validatePhotoFile({ type: 'image/png', size: 1000 })).toBeNull();
    expect(validatePhotoFile({ type: 'image/gif', size: 1000 })).toMatch(/JPEG/);
    expect(validatePhotoFile({ type: 'image/jpeg', size: 11 * 1024 * 1024 })).toMatch(/10 MB/);
    expect(validatePhotoFile({ type: 'image/jpeg', size: 0 })).toMatch(/vazio/);
  });

  it('move um item na lista', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
  });
});
