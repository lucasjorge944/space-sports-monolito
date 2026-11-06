import { brandLogos, logoClearSpace, logoMinWidth } from '@space-sports/ui-tokens';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Logo } from './logo';

function asset(layout: 'horizontal' | 'vertical', tone: 'positive' | 'negative') {
  const found = brandLogos[layout][tone];
  if (!found) throw new Error(`sem ${layout} ${tone}`);
  return found;
}

const html = (props: Parameters<typeof Logo>[0]) =>
  renderToStaticMarkup(createElement(Logo, props));

describe('Logo', () => {
  it('renderiza o SVG inline com o rótulo "Space Sports" só no invólucro', () => {
    const out = html({ layout: 'horizontal', tone: 'positive' });
    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="Space Sports"');
    expect(out.match(/aria-label="Space Sports"/g)).toHaveLength(1);
    expect(out).toContain('<svg');
  });

  it('nunca fica abaixo do mínimo digital da marca', () => {
    expect(html({ layout: 'horizontal', tone: 'positive', width: 100 })).toContain(
      `width:${logoMinWidth.horizontal}px`,
    );
    expect(html({ layout: 'symbol', tone: 'positive', width: 16 })).toContain(
      `width:${logoMinWidth.symbol}px`,
    );
  });

  it('reserva a área de proteção (meia bola) em volta, a menos que se peça o contrário', () => {
    const pad = logoClearSpace(asset('horizontal', 'positive'), 200);
    expect(html({ layout: 'horizontal', tone: 'positive', width: 200 })).toContain(
      `padding:${pad}px`,
    );
    expect(
      html({ layout: 'horizontal', tone: 'positive', width: 200, protect: false }),
    ).not.toContain('padding');
  });

  it('no tom automático traz as versões positiva e negativa, trocadas pelo tema', () => {
    const out = html({ layout: 'vertical', tone: 'auto' });
    expect(out.match(/<svg/g)).toHaveLength(2);
    expect(out).toContain('dark:hidden');
    expect(out).toContain('dark:block');
    expect(out).toContain(asset('vertical', 'negative').svg.slice(0, 40));
  });

  it('usa a versão pedida (negativa, sobre Sol, monocromática)', () => {
    expect(html({ layout: 'horizontal', tone: 'negative' })).toContain('#FFFFFF');
    expect(html({ layout: 'horizontal', tone: 'mono-dark' }).match(/<svg/g)).toHaveLength(1);
    // Sem versão monocromática na vertical: cai na positiva.
    expect(html({ layout: 'vertical', tone: 'mono-white' }).match(/<svg/g)).toHaveLength(1);
  });

  it('deixa único o id do clipPath quando a mesma versão aparece duas vezes', () => {
    const wrap = renderToStaticMarkup(
      createElement(
        'div',
        null,
        createElement(Logo, { layout: 'horizontal', tone: 'positive' }),
        createElement(Logo, { layout: 'horizontal', tone: 'positive' }),
      ),
    );
    const ids = [...wrap.matchAll(/<clipPath id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
