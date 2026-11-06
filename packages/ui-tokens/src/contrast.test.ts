import { describe, expect, it } from 'vitest';
import {
  brandColors,
  type ColorToken,
  functionalColors,
  palette,
  type ThemeColors,
  themes,
} from './colors';
import { compositeOver, contrastRatio, relativeLuminance, splitAlpha } from './contrast';
import { exploreLayout, mediaOverlayOpacityAt, mediaOverlayStops } from './layout';
import { toHslChannels } from './native';

const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;

/** Texto sobre fundo: [fundo, texto]. */
const textPairs: [ColorToken, ColorToken][] = [
  ['background', 'foreground'],
  ['card', 'cardForeground'],
  ['popover', 'popoverForeground'],
  ['primary', 'primaryForeground'],
  ['secondary', 'secondaryForeground'],
  ['muted', 'mutedForeground'],
  ['background', 'mutedForeground'],
  ['card', 'mutedForeground'],
  ['sidebar', 'mutedForeground'], // rótulo de grupo da sidebar (tingida no Super)
  ['accent', 'accentForeground'],
  ['accent', 'mutedForeground'],
  ['destructive', 'destructiveForeground'],
  ['success', 'successForeground'],
  ['warning', 'warningForeground'],
  ['info', 'infoForeground'],
  // Status tingidos (badges de reserva, pagamento e mensalidade), no fundo e no card.
  ['destructiveSubtle', 'destructiveSubtleForeground'],
  ['successSubtle', 'successSubtleForeground'],
  ['warningSubtle', 'warningSubtleForeground'],
  ['infoSubtle', 'infoSubtleForeground'],
  // A agenda escreve texto `foreground` e `muted-foreground` sobre os -subtle.
  ['destructiveSubtle', 'foreground'],
  ['destructiveSubtle', 'mutedForeground'],
  ['successSubtle', 'foreground'],
  ['successSubtle', 'mutedForeground'],
  ['warningSubtle', 'foreground'],
  ['warningSubtle', 'mutedForeground'],
  ['infoSubtle', 'foreground'],
  ['infoSubtle', 'mutedForeground'],
  // Cores usadas como texto: links e mensagens de erro. Para sucesso, alerta e info em texto,
  // use os -subtle-foreground (no claro, o sólido do kit não chega a 4.5:1 no fundo).
  ['background', 'primary'],
  ['card', 'primary'],
  ['background', 'link'],
  ['card', 'link'],
  ['muted', 'link'],
  ['background', 'destructive'],
  ['card', 'destructive'],
  ['background', 'successSubtleForeground'],
  ['background', 'warningSubtleForeground'],
  ['background', 'destructiveSubtleForeground'],
  ['background', 'infoSubtleForeground'],
  ['card', 'successSubtleForeground'],
  ['card', 'warningSubtleForeground'],
  ['card', 'destructiveSubtleForeground'],
  ['card', 'infoSubtleForeground'],
  ['muted', 'mutedForeground'],
  ['sidebar', 'sidebarForeground'],
  ['sidebar', 'sidebarPrimary'],
  ['sidebarPrimary', 'sidebarPrimaryForeground'],
  ['sidebarAccent', 'sidebarAccentForeground'],
  // Acréscimos da auditoria do web (2.34): botão escuro, rótulo, hover de link, campos e chips.
  ['inverse', 'inverseForeground'],
  ['background', 'eyebrow'],
  ['card', 'eyebrow'],
  ['background', 'linkHover'],
  ['card', 'linkHover'],
  ['inputBackground', 'foreground'],
  ['inputBackground', 'mutedForeground'], // placeholder
  ['inputFocusBackground', 'foreground'],
  ['inputFocusBackground', 'mutedForeground'],
  ['chip', 'chipForeground'],
  ['chipHover', 'chipForeground'],
  ['chipSelected', 'chipSelectedForeground'],
  // Revisão da 2.35: texto da aba ativa. O botão de contorno tem teste próprio (fundo com alfa).
  ['tabActive', 'foreground'],
  // Anatomia de campo (A.2): valor e placeholder no campo com erro, mensagem em qualquer superfície.
  ['inputErrorBackground', 'foreground'],
  ['inputErrorBackground', 'mutedForeground'],
  ['background', 'inputErrorForeground'],
  ['card', 'inputErrorForeground'],
  ['popover', 'inputErrorForeground'],
  ['muted', 'inputErrorForeground'],
  ['sidebar', 'inputErrorForeground'],
  // Explorar e anúncios (AD.1): selo "Patrocinado" e botão sobre a foto.
  ['sponsored', 'sponsoredForeground'],
  ['mediaAction', 'mediaActionForeground'],
  // Pagamento online (PG.1): selo "Ambiente de teste" e valor de entrada em extratos e na carteira.
  ['sandbox', 'sandboxForeground'],
  ['background', 'amountPositive'],
  ['card', 'amountPositive'],
  ['popover', 'amountPositive'],
  ['muted', 'amountPositive'],
];

/** Elementos não textuais (WCAG 1.4.11): foco, borda de campo, séries de gráfico. */
const nonTextPairs: [ColorToken, ColorToken][] = [
  ['background', 'input'],
  ['card', 'input'],
  ['muted', 'input'],
  ['background', 'chart1'],
  ['background', 'chart2'],
  ['background', 'chart3'],
  ['background', 'chart4'],
  ['background', 'chart5'],
  ['card', 'chart1'],
  ['card', 'chart2'],
  ['card', 'chart3'],
  ['card', 'chart4'],
  ['card', 'chart5'],
  ['inputBackground', 'input'],
  ['inputFocusBackground', 'inputFocus'],
  ['card', 'inputFocus'],
  ['background', 'inputFocus'],
  // O chip selecionado precisa se distinguir da superfície (estado, WCAG 1.4.11): no claro quem
  // garante é a borda Noite, porque o Sol tem 1.6:1.
  ['background', 'chipSelectedBorder'],
  ['card', 'chipSelectedBorder'],
  ['muted', 'chipSelectedBorder'],
  ['chip', 'chipSelectedBorder'],
  // A borda de erro vale em qualquer superfície e sobre o fundo do próprio campo.
  ['background', 'inputError'],
  ['card', 'inputError'],
  ['muted', 'inputError'],
  ['inputBackground', 'inputError'],
  ['inputErrorBackground', 'inputError'],
  // O selo "Ambiente de teste" se separa de qualquer superfície (no claro, pela borda Noite).
  ['background', 'sandboxBorder'],
  ['card', 'sandboxBorder'],
  ['popover', 'sandboxBorder'],
  ['muted', 'sandboxBorder'],
  // Estrela das avaliações (AV.1): a cheia se separa da superfície pelo contorno (no claro o Sol
  // sozinho tem 1.6:1) e a vazia, que é só contorno, também passa os 3:1.
  ['background', 'ratingBorder'],
  ['card', 'ratingBorder'],
  ['popover', 'ratingBorder'],
  ['muted', 'ratingBorder'],
  ['background', 'ratingEmpty'],
  ['card', 'ratingEmpty'],
  ['popover', 'ratingEmpty'],
  ['muted', 'ratingEmpty'],
];

/**
 * Anel de foco (WCAG 2.4.11/1.4.11): o anel ou a faixa de offset entre o elemento e o anel
 * precisa de 3:1 com a superfície. No claro o anel Sol não chega lá e a faixa Mar garante.
 */
const focusSurfaces: [ColorToken, 'ring' | 'sidebarRing'][] = [
  ['background', 'ring'],
  ['card', 'ring'],
  ['muted', 'ring'],
  ['sidebar', 'sidebarRing'],
];

/** Onde o botão de contorno aparece: no escuro o fundo dele é transparente e vale a superfície. */
const outlineSurfaces: ColorToken[] = ['background', 'card', 'popover', 'muted', 'sidebar'];

const subtleStatuses = ['destructive', 'success', 'warning', 'info'] as const;

/** Converte de volta os canais HSL para hex, para validar o que o mobile recebe. */
function hslChannelsToHex(value: string): string {
  const [channels = '', alpha] = value.split(' / ');
  const [h, s, l] = channels.replaceAll('%', '').split(' ').map(Number) as [number, number, number];
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255)
      .toString(16)
      .padStart(2, '0');
  };
  const suffix = alpha
    ? Math.round(Number(alpha) * 255)
        .toString(16)
        .padStart(2, '0')
    : '';
  return `#${f(0)}${f(8)}${f(4)}${suffix}`;
}

const viaMobileHsl = (colors: ThemeColors) =>
  Object.fromEntries(
    Object.entries(colors).map(([k, v]) => [k, hslChannelsToHex(toHslChannels(v))]),
  ) as ThemeColors;

const variants: [string, ThemeColors][] = [
  ['claro', themes.light],
  ['escuro', themes.dark],
  ['claro (HSL do mobile)', viaMobileHsl(themes.light)],
  ['escuro (HSL do mobile)', viaMobileHsl(themes.dark)],
];

describe.each(variants)('contraste WCAG AA — tema %s', (name, colors) => {
  it.each(textPairs)('texto %s × %s ≥ 4.5:1', (bg, fg) => {
    expect(contrastRatio(colors[bg], colors[fg])).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(nonTextPairs)('não-texto %s × %s ≥ 3:1', (bg, fg) => {
    expect(contrastRatio(colors[bg], colors[fg])).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  it.each(focusSurfaces)('foco visível sobre %s (%s ou ringOffset ≥ 3:1)', (bg, ring) => {
    const best = Math.max(
      contrastRatio(colors[bg], colors[ring]),
      contrastRatio(colors[bg], colors.ringOffset),
    );
    expect(best).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  it('cores opacas em #RRGGBB; só o scrim e o contorno do escuro têm alfa', () => {
    for (const [token, value] of Object.entries(colors)) {
      const { alpha } = splitAlpha(value);
      if (token === 'scrim') expect(alpha).toBeGreaterThan(0.5);
      else if (token === 'outlineBackground' && name.includes('escuro')) expect(alpha).toBe(0);
      else expect(alpha).toBe(1);
    }
  });

  it('o scrim escurece o fundo e o diálogo (popover) se destaca dele', () => {
    const veiled = compositeOver(colors.scrim, colors.background);
    expect(contrastRatio(veiled, '#FFFFFF')).toBeGreaterThan(
      contrastRatio(colors.background, '#FFFFFF'),
    );
    // No claro o diálogo branco tem 4.6:1 com o fundo velado; no escuro a separação vem da
    // superfície e da borda (prancha 07: "elevação por superfície"), com o véu no máximo útil.
    if (name.includes('claro')) {
      expect(contrastRatio(colors.popover, veiled)).toBeGreaterThanOrEqual(AA_NON_TEXT);
    } else {
      expect(splitAlpha(colors.scrim).alpha).toBeGreaterThanOrEqual(0.79);
      expect(contrastRatio(colors.border, veiled)).toBeGreaterThan(
        contrastRatio(colors.border, colors.background),
      );
    }
  });

  it('desabilitado legível (≥ 3:1, embora a WCAG o dispense)', () => {
    expect(contrastRatio(colors.disabled, colors.disabledForeground)).toBeGreaterThanOrEqual(
      AA_NON_TEXT,
    );
  });

  it.each(subtleStatuses)('badge de status %s: a borda fica mais forte que o fundo', (status) => {
    const fill = colors[`${status}Subtle`];
    const border = colors[`${status}SubtleBorder`];
    for (const surface of [colors.background, colors.card]) {
      expect(contrastRatio(surface, border)).toBeGreaterThan(contrastRatio(surface, fill));
    }
    expect(contrastRatio(border, fill)).toBeGreaterThan(1.15);
  });

  it('chip neutro: Sol nenhum fora do selecionado', () => {
    for (const token of ['chip', 'chipBorder', 'chipHover'] as const) {
      expect(Object.values(palette.sol)).not.toContain(colors[token]);
    }
  });

  it.each(outlineSurfaces)('botão de contorno sobre %s', (surface) => {
    const fill = compositeOver(colors.outlineBackground, colors[surface]);
    expect(contrastRatio(fill, colors.foreground)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(colors[surface], colors.outlineBorder)).toBeGreaterThanOrEqual(
      AA_NON_TEXT,
    );
    expect(contrastRatio(fill, colors.disabledForeground)).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  it('campo desabilitado mais escuro que o ativo e com texto legível (≥ 3:1)', () => {
    expect(relativeLuminance(colors.inputDisabled)).toBeLessThan(
      relativeLuminance(colors.inputBackground),
    );
    expect(contrastRatio(colors.inputDisabled, colors.disabledForeground)).toBeGreaterThanOrEqual(
      AA_NON_TEXT,
    );
    if (name.includes('escuro')) {
      expect(relativeLuminance(colors.inputDisabled)).toBeLessThan(relativeLuminance(colors.card));
    }
  });

  it('aba ativa mais clara que o trilho; no escuro a borda dá os 3:1', () => {
    expect(relativeLuminance(colors.tabActive)).toBeGreaterThan(relativeLuminance(colors.muted));
    if (name.includes('escuro')) {
      expect(contrastRatio(colors.muted, colors.tabActiveBorder)).toBeGreaterThanOrEqual(
        AA_NON_TEXT,
      );
    }
  });
});

/** `#06202E` com opacidade 0.5 → `#06202E80`, para compor com `compositeOver`. */
const withOpacity = (hex: string, opacity: number) =>
  `${hex}${Math.round(opacity * 255)
    .toString(16)
    .padStart(2, '0')}`;

/** Pior caso de foto para texto branco (branca) e para o botão Sol (preta e branca). */
const LIGHTEST_PHOTO = '#FFFFFF';
const DARKEST_PHOTO = '#000000';

describe.each(variants)('peças sobre foto (AD.1) — tema %s', (_name, colors) => {
  const overlayOver = (photo: string, offset: number) =>
    compositeOver(withOpacity(colors.mediaOverlay, mediaOverlayOpacityAt(offset)), photo);
  const { hero } = exploreLayout;
  // Banner de 360 dp de largura (328 × 164): o selo ocupa o topo até 12 + 24 = 36, e o título
  // começa no mínimo 4 abaixo; o texto corrido, quando cabe, fica a 76 da base (16 + 32 + 8 + 20).
  const height = 164;
  const titleTop = (hero.badgeInset + exploreLayout.badge.minHeight + hero.badgeClearance) / height;
  const bodyTop = (height - (hero.padding + hero.ctaHeight + 8 + 20)) / height;

  it('o selo e o degradê não usam alfa no token: a opacidade vem de mediaOverlayStops', () => {
    expect(splitAlpha(colors.mediaOverlay).alpha).toBe(1);
    expect(mediaOverlayStops[0].offset).toBe(0);
    expect(mediaOverlayStops.at(-1)?.offset).toBe(1);
  });

  it('a opacidade só cresce de cima para baixo', () => {
    for (let i = 1; i < mediaOverlayStops.length; i++) {
      expect(mediaOverlayStops[i]?.opacity).toBeGreaterThan(mediaOverlayStops[i - 1]?.opacity ?? 1);
    }
  });

  it('título (texto grande, 20 px em negrito) ≥ 3:1 sobre foto branca', () => {
    expect(titleTop).toBeGreaterThanOrEqual(0.22);
    expect(
      contrastRatio(overlayOver(LIGHTEST_PHOTO, titleTop), colors.mediaForeground),
    ).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  it('texto corrido ≥ 4.5:1 sobre foto branca, mesmo no banner mais baixo que o mostra', () => {
    // No banner de 142 dp de altura (o mínimo com título de uma linha e texto: 12 + 24 + 4 do selo,
    // 24 + 2 + 20 + 8 + 32 + 16 do bloco), o texto começa a 66 do topo, em 46%.
    for (const top of [bodyTop, 66 / 142, 0.45]) {
      expect(
        contrastRatio(overlayOver(LIGHTEST_PHOTO, top), colors.mediaForeground),
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it('o botão Sol se destaca do degradê (≥ 3:1) sobre foto branca e preta', () => {
    // Borda de cima da pílula em banners de 320, 360 e 412 dp (144, 164 e 190 de altura), com a
    // fonte normal (32) e a 1.3× (20 × 1.3 + 12 = 38): o pior caso é 320 dp com 1.3× (~3.6:1).
    const ctaTops = [144, 164, 190].flatMap((h) =>
      [hero.ctaHeight, 20 * exploreLayout.mediaMaxFontSizeMultiplier + 12].map(
        (cta) => (h - hero.padding - cta) / h,
      ),
    );
    for (const photo of [LIGHTEST_PHOTO, DARKEST_PHOTO]) {
      for (const offset of [...ctaTops, 1]) {
        expect(
          contrastRatio(overlayOver(photo, offset), colors.mediaAction),
        ).toBeGreaterThanOrEqual(AA_NON_TEXT);
      }
    }
  });

  it('o selo opaco se destaca de foto clara (≥ 3:1) e o texto dele passa em qualquer foto', () => {
    expect(contrastRatio(LIGHTEST_PHOTO, colors.sponsored)).toBeGreaterThanOrEqual(AA_NON_TEXT);
    expect(contrastRatio(colors.sponsored, colors.sponsoredForeground)).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
  });

  it('o selo não usa o Sol (anúncio não chama mais atenção que a lista)', () => {
    expect(Object.values(palette.sol)).not.toContain(colors.sponsored);
  });
});

describe.each(variants)('pagamento online (PG.1) — tema %s', (_name, colors) => {
  it('QR do Pix: módulos escuros sobre placa clara, com folga para leitores de banco (≥ 7:1)', () => {
    expect(relativeLuminance(colors.qrPlate)).toBeGreaterThan(relativeLuminance(colors.qrModule));
    expect(contrastRatio(colors.qrPlate, colors.qrModule)).toBeGreaterThanOrEqual(7);
  });

  it('o selo "Ambiente de teste" não se confunde com Pendente, ação principal nem destaque', () => {
    for (const token of ['warningSubtle', 'primary', 'secondary', 'chipSelected'] as const) {
      expect(colors.sandbox).not.toBe(colors[token]);
    }
    expect(Object.values(palette.sol)).not.toContain(colors.sandbox);
  });
});

describe.each(variants)('avaliações (AV.1) — tema %s', (_name, colors) => {
  it('a estrela vazia não usa tom do Sol', () => {
    const sol = Object.values(palette.sol).map((hex) => hex.toUpperCase());
    expect(sol).not.toContain(colors.ratingEmpty.toUpperCase());
  });

  it('cheia e vazia se distinguem pelo contorno (≥ 1.5:1 entre elas), além do preenchimento', () => {
    expect(contrastRatio(colors.ratingBorder, colors.ratingEmpty)).toBeGreaterThanOrEqual(1.5);
  });
});

describe('marca', () => {
  it('pares do kit (prancha 04): Mar × branco, Sol × Noite, Mar × Sol', () => {
    expect(contrastRatio(brandColors.mar, brandColors.rede)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(brandColors.sol, brandColors.noite)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(brandColors.sol, brandColors.mar)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('Sol nunca como texto ou anel sem apoio no claro (1.6:1)', () => {
    expect(contrastRatio(themes.light.background, brandColors.sol)).toBeLessThan(AA_NON_TEXT);
  });

  it('tokens da auditoria seguem os valores do kit (pranchas 06 e 07)', () => {
    expect(themes.dark.chip).toBe('#12313F');
    expect(themes.dark.chipBorder).toBe('#1E4152');
    expect(themes.dark.chipSelected).toBe(brandColors.sol);
    expect(themes.light.inverse).toBe(brandColors.noite);
    expect(themes.light.inputFocus).toBe(brandColors.mar);
    expect(themes.light.inputFocusBackground).toBe(palette.sol[50]);
    expect(themes.dark.inputBackground).toBe('#12313F');
    expect(themes.light.linkHover).toBe(palette.mar[700]);
    expect(splitAlpha(themes.light.scrim)).toEqual({ hex: brandColors.noite, alpha: 0.6 });
  });

  it('divergências da A.2: chip selecionado em Sol + Noite nos dois temas e Pendente fora do kit', () => {
    expect(themes.light.chipSelected).toBe(brandColors.sol);
    expect(themes.light.chipSelectedForeground).toBe(brandColors.noite);
    expect(themes.light.chipSelectedBorder).toBe(brandColors.noite);
    expect(themes.light.chip).toBe(themes.light.muted);
    expect(themes.light.warningSubtleBorder).toBe(brandColors.sol);
    expect(themes.dark.warningSubtleForeground).toBe(palette.sol[300]);
    expect(themes.dark.warningSubtleBorder).toBe(palette.sol[700]);
  });

  it('campo com erro no escuro fica em bg/raised; a borda é o vermelho de erro', () => {
    expect(themes.dark.inputErrorBackground).toBe(themes.dark.inputBackground);
    expect(themes.light.inputError).toBe(themes.light.destructive);
    expect(themes.dark.inputError).toBe(themes.dark.destructive);
  });

  it('botão de contorno segue o kit: Noite sobre card (06), #A9BCC6 sobre transparente (07)', () => {
    expect(themes.light.outlineBorder).toBe(brandColors.noite);
    expect(themes.light.outlineBackground).toBe(themes.light.card);
    expect(themes.dark.outlineBorder).toBe('#A9BCC6');
    expect(splitAlpha(themes.dark.outlineBackground).alpha).toBe(0);
  });

  it('o campo desabilitado não mexe no botão desabilitado', () => {
    expect(themes.light.disabled).toBe(palette.neutral[200]);
    expect(themes.dark.disabled).toBe('#1E4152');
    expect(themes.light.inputDisabled).toBe(themes.light.disabled);
  });

  it('a aba ativa não muda no claro: branco sobre neutral-100, sem borda aparente', () => {
    expect(themes.light.tabActive).toBe(brandColors.rede);
    expect(themes.light.tabActiveBorder).toBe(themes.light.tabActive);
    expect(themes.light.muted).toBe(palette.neutral[100]);
  });

  it('no escuro o Sol é a ação principal e o Mar não serve de texto sobre Noite', () => {
    expect(themes.dark.primary).toBe(brandColors.sol);
    expect(contrastRatio(themes.dark.background, brandColors.mar)).toBeLessThan(AA_NON_TEXT);
  });

  it('QR igual nos dois temas e selo de teste no laranja de alerta do kit', () => {
    expect(themes.dark.qrPlate).toBe(themes.light.qrPlate);
    expect(themes.dark.qrModule).toBe(themes.light.qrModule);
    expect(themes.light.sandbox).toBe(functionalColors.warning);
    expect(themes.dark.sandbox).toBe(themes.dark.warning);
    expect(themes.light.amountPositive).toBe(themes.light.successSubtleForeground);
    expect(themes.dark.amountPositive).toBe(themes.dark.successSubtleForeground);
  });

  it('estrela no claro: o Sol tem contorno Sol 700 (o Sol sozinho reprova); no escuro, Sol puro', () => {
    expect(themes.light.rating).toBe(brandColors.sol);
    expect(themes.dark.rating).toBe(brandColors.sol);
    expect(themes.light.ratingBorder).toBe(palette.sol[700]);
    expect(themes.light.ratingBorder).not.toBe(themes.light.rating);
    expect(themes.dark.ratingBorder).toBe(brandColors.sol);
    expect(themes.light.ratingEmpty).toBe(themes.light.input);
    expect(themes.dark.ratingEmpty).toBe(themes.dark.input);
  });

  it('erro do kit escurecido no claro; sucesso e alerta do kit com texto Noite', () => {
    expect(contrastRatio(functionalColors.error, '#FFFFFF')).toBeLessThan(AA_TEXT);
    expect(themes.light.success).toBe(functionalColors.success);
    expect(themes.light.successForeground).toBe(brandColors.noite);
  });
});

describe('contrastRatio', () => {
  it('calcula os extremos', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
  });

  it('rejeita formatos fora de #RRGGBB', () => {
    expect(() => contrastRatio('#FFF', '#000000')).toThrow();
    expect(() => contrastRatio('#00000080', '#000000')).toThrow();
  });

  it('compõe cor com alfa sobre o fundo', () => {
    expect(compositeOver('#00000080', '#FFFFFF')).toBe('#7F7F7F');
    expect(compositeOver('#03547D', '#FFFFFF')).toBe('#03547D');
    expect(compositeOver('#00000000', '#12313F')).toBe('#12313F');
  });
});
