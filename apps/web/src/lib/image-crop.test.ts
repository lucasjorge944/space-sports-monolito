import { describe, expect, it } from 'vitest';
import { cropBox, panAfterDragBox } from './image-crop';

describe('recorte numa proporção fixa', () => {
  it('2:1 numa foto 4:3: largura toda, centralizado na vertical', () => {
    expect(cropBox({ width: 1600, height: 1200 }, 2, 1, { x: 0, y: 0 })).toEqual({
      x: 0,
      y: 200,
      width: 1600,
      height: 800,
    });
  });

  it('4:5 numa foto paisagem: altura toda, o pan leva até a borda', () => {
    const image = { width: 2000, height: 1000 };
    expect(cropBox(image, 0.8, 1, { x: 1, y: 0 })).toEqual({
      x: 1200,
      y: 0,
      width: 800,
      height: 1000,
    });
    expect(cropBox(image, 0.8, 2, { x: -1, y: -1 })).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 500,
    });
  });

  it('arrastar para a direita mostra mais da esquerda', () => {
    const pan = panAfterDragBox(
      { width: 2000, height: 1000 },
      2,
      1,
      { x: 0, y: 0 },
      { dx: 0, dy: 40 },
      400,
    );
    expect(pan.x).toBe(0);
    expect(pan.y).toBe(0);
    expect(
      panAfterDragBox({ width: 2000, height: 600 }, 2, 1, { x: 0, y: 0 }, { dx: 50, dy: 0 }, 400).x,
    ).toBeLessThan(0);
  });
});
