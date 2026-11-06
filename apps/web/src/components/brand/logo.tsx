import {
  type BrandAsset,
  brandLogos,
  brandSvg,
  type LogoLayout,
  type LogoTone,
  logoClearSpace,
  logoMinWidth,
} from '@space-sports/ui-tokens';
import { useId } from 'react';
import { cn } from '@/lib/utils';

/** Largura padrão por layout, já acima do mínimo digital da marca. */
const DEFAULT_WIDTH: Record<LogoLayout, number> = { vertical: 128, horizontal: 176, symbol: 40 };

type LogoProps = {
  /** Vertical (login, boas-vindas), horizontal (cabeçalhos, sidebar, rodapé) ou só o símbolo. */
  layout?: LogoLayout;
  /**
   * `auto` segue o tema (positiva no claro, negativa no escuro). Os demais fixam a versão:
   * `negative` sobre Mar e fundos escuros, `on-sol` sobre o amarelo, `mono-*` em uma cor só
   * (só existem na horizontal).
   */
  tone?: LogoTone | 'auto';
  /** Largura em px; nunca fica abaixo do mínimo da marca para o layout. */
  width?: number;
  /** Reserva a área de proteção (meia bola) em volta. Desligue só se o contêiner já a garante. */
  protect?: boolean;
  className?: string;
};

function pick(layout: LogoLayout, tone: LogoTone): BrandAsset {
  const asset = brandLogos[layout][tone] ?? brandLogos[layout].positive;
  if (!asset) throw new Error(`Logo ${layout} sem versão ${tone}`);
  return asset;
}

function Svg({
  asset,
  suffix,
  className,
}: {
  asset: BrandAsset;
  suffix: string;
  className?: string;
}) {
  // O SVG do pacote já traz `role="img"`; o rótulo fica no invólucro, então o interno é decorativo.
  const markup = brandSvg(asset, suffix).replace(
    ' role="img" aria-label="Space Sports"',
    ' aria-hidden="true" focusable="false"',
  );
  return (
    <span
      className={cn('block [&>svg]:block [&>svg]:h-auto [&>svg]:w-full', className)}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG estático do pacote de tokens
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}

/** Logo do Space Sports (SVG inline, nome em contorno). Segue as regras de uso da prancha 02. */
export function Logo({
  layout = 'horizontal',
  tone = 'auto',
  width,
  protect = true,
  className,
}: LogoProps) {
  const id = useId().replaceAll(':', '');
  const rendered = Math.max(width ?? DEFAULT_WIDTH[layout], logoMinWidth[layout]);
  const reference = pick(layout, tone === 'auto' ? 'positive' : tone);

  return (
    <span
      role="img"
      aria-label="Space Sports"
      data-slot="logo"
      className={cn('inline-block shrink-0', className)}
      style={{
        width: rendered,
        boxSizing: 'content-box',
        padding: protect ? logoClearSpace(reference, rendered) : undefined,
      }}
    >
      {tone === 'auto' ? (
        <>
          <Svg asset={pick(layout, 'positive')} suffix={id} className="dark:hidden" />
          <Svg asset={pick(layout, 'negative')} suffix={id} className="hidden dark:block" />
        </>
      ) : (
        <Svg asset={reference} suffix={id} />
      )}
    </span>
  );
}
