'use client';

import { formatCents } from '@space-sports/api-client';
import { mediaOverlayStops } from '@space-sports/ui-tokens';
import {
  ArrowUpRight,
  ChevronRight,
  ImageIcon,
  type LucideIcon,
  MessageCircle,
} from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { SpaceAvatar } from '@/components/space-avatar';
import { Chip } from '@/components/ui/chip';
import { AD_PLACEMENT_FORMATS, type DestinationType } from '@/lib/super/ads';
import { cn } from '@/lib/utils';

// Pré-visualização das peças como aparecem no app (docs/05, "Explorar e anúncios", AD.1 item 7).
// Tudo por tokens, sem `dark:`: cada moldura força o tema com `.light`/`.dark` em volta, e o
// `dark:` do Tailwind olha para o `<html>`, não para a moldura.

/** Espaço usado na prévia (capa e logo na peça sem imagem; dados do card do espaço). */
export type PreviewSpace = {
  name: string;
  logoUrl: string | null;
  coverUrl: string | null;
  location: string | null;
  sports: string[];
  pricePerHourCents: number | null;
};

export type PreviewContent = {
  title: string;
  body: string;
  ctaLabel: string;
  destinationType: DestinationType;
  /** Rodapé do card: domínio, "WhatsApp" ou bairro · cidade. */
  destinationCaption: string;
  /** Imagem própria da peça (URL do storage ou do recorte ainda não salvo). */
  imageUrl: string | null;
  /** Peça de anunciante Espaço sem imagem: usa a capa e a logo do espaço. */
  usesSpaceCover: boolean;
  advertiserName: string;
  space: PreviewSpace | null;
};

const DESTINATION_ICON: Record<DestinationType, LucideIcon> = {
  URL: ArrowUpRight,
  WHATSAPP: MessageCircle,
  SPACE: ChevronRight,
};

/** O degradê de leitura do app: `media-overlay` com as opacidades de `mediaOverlayStops`. */
const MEDIA_OVERLAY = `linear-gradient(to bottom, ${mediaOverlayStops
  .map(
    (stop) =>
      `color-mix(in srgb, var(--media-overlay) ${Math.round(stop.opacity * 100)}%, transparent) ${Math.round(stop.offset * 100)}%`,
  )
  .join(', ')})`;

/**
 * Nome no selo "Patrocinado · <nome>": o do espaço quando a peça usa a capa dele, senão o do
 * anunciante. O mesmo nome vai na legenda da moldura, para o leitor de tela.
 */
export function sponsoredName(content: PreviewContent): string {
  const name = content.usesSpaceCover
    ? (content.space?.name ?? content.advertiserName)
    : content.advertiserName;
  return name || 'Anunciante';
}

/** Selo "Patrocinado · <anunciante>": o nome encolhe, "Patrocinado" nunca é cortado. */
function SponsoredBadge({
  name,
  className,
  style,
  badgeRef,
}: {
  name: string;
  className?: string;
  style?: React.CSSProperties;
  badgeRef?: React.Ref<HTMLSpanElement>;
}) {
  return (
    <span
      ref={badgeRef}
      aria-hidden
      data-testid="sponsored-badge"
      className={cn(
        'bg-sponsored text-sponsored-foreground absolute flex min-h-6 items-center rounded-full px-2.5 py-0.5 text-sm leading-5',
        className,
      )}
      style={style}
    >
      <span className="shrink-0 font-semibold">Patrocinado</span>
      <span className="min-w-0 truncate font-medium">&nbsp;·&nbsp;{name}</span>
    </span>
  );
}

function MissingImage({ placement }: { placement: 'EXPLORE_HERO' | 'EXPLORE_FEED' }) {
  const f = AD_PLACEMENT_FORMATS[placement];
  return (
    <div className="bg-muted text-muted-foreground absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-sm">
      <ImageIcon className="size-6" aria-hidden />
      Envie a imagem {f.aspectWidth}:{f.aspectHeight} (mín. {f.minWidth} × {f.minHeight})
    </div>
  );
}

function Photo({ url }: { url: string }) {
  // biome-ignore lint/performance/noImgElement: imagem do storage ou do recorte local (blob:)
  return <img src={url} alt="" className="absolute inset-0 size-full object-cover" />;
}

/**
 * Banner do carrossel (`EXPLORE_HERO`): imagem 2:1, degradê, selo, título, texto e botão. A regra de
 * caber é a do app: se o bloco de texto subir além de 4 px abaixo do selo, o texto sai; se ainda
 * não couber, o título fica em uma linha.
 */
export function HeroPreview({
  content,
  width,
  segments,
}: {
  content: PreviewContent;
  /** Largura do banner em px (tela − 32). */
  width: number;
  /** Peças ativas da campanha (o indicador só aparece com 2 ou mais). */
  segments: number;
}) {
  const fitKey = `${width}|${content.title}|${content.body}|${content.ctaLabel}|${content.usesSpaceCover}|${content.advertiserName}`;
  return <HeroBanner key={fitKey} content={content} width={width} segments={segments} />;
}

function HeroBanner({
  content,
  width,
  segments,
}: {
  content: PreviewContent;
  width: number;
  segments: number;
}) {
  const banner = useRef<HTMLDivElement>(null);
  const badge = useRef<HTMLSpanElement>(null);
  const block = useRef<HTMLDivElement>(null);
  // 0: título em até 2 linhas e texto; 1: sem o texto; 2: título em 1 linha.
  const [step, setStep] = useState(0);

  useLayoutEffect(() => {
    const height = banner.current?.clientHeight ?? 0;
    const badgeBottom = 12 + (badge.current?.offsetHeight ?? 24);
    const available = height - badgeBottom - 4 - 16;
    if ((block.current?.offsetHeight ?? 0) > available && step < 2) setStep(step + 1);
  }, [step]);

  const Icon = DESTINATION_ICON[content.destinationType];
  const cover = content.usesSpaceCover ? (content.space?.coverUrl ?? null) : content.imageUrl;
  const showBody = Boolean(content.body.trim()) && step === 0;

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        ref={banner}
        data-testid="hero-preview"
        className="bg-muted relative overflow-hidden rounded-xl"
        style={{ width, height: width / 2 }}
      >
        {cover ? (
          <Photo url={cover} />
        ) : content.usesSpaceCover ? null : (
          <MissingImage placement="EXPLORE_HERO" />
        )}
        {cover || content.usesSpaceCover ? (
          <div className="absolute inset-0" style={{ backgroundImage: MEDIA_OVERLAY }} />
        ) : null}
        <SponsoredBadge
          badgeRef={badge}
          name={sponsoredName(content)}
          className="top-3 left-3"
          style={{ maxWidth: width - 24 - (content.usesSpaceCover ? 52 : 0) }}
        />
        {content.usesSpaceCover && content.space ? (
          <SpaceAvatar
            name={content.space.name}
            logoUrl={content.space.logoUrl}
            size={40}
            decorative
            className="border-media-foreground absolute top-3 right-3 border-2"
          />
        ) : null}
        <div ref={block} className="absolute right-4 bottom-4 left-4 flex flex-col items-start">
          <p
            className={cn(
              'font-display text-media-foreground text-xl leading-6 font-bold',
              step === 2 ? 'line-clamp-1' : 'line-clamp-2',
            )}
          >
            {content.title || 'Título da peça'}
          </p>
          {showBody ? (
            <p className="text-media-foreground mt-0.5 w-full truncate text-sm leading-5">
              {content.body}
            </p>
          ) : null}
          <span className="bg-media-action text-media-action-foreground mt-2 inline-flex min-h-8 items-center gap-1.5 rounded-full pr-3 pl-3.5 text-sm font-semibold">
            {content.ctaLabel || 'Botão'}
            <Icon className="size-4" aria-hidden />
          </span>
        </div>
      </div>
      {segments >= 2 ? (
        <div aria-hidden className="flex gap-1">
          {Array.from({ length: segments }, (_, index) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: segmentos estáticos do indicador
              key={index}
              className={cn('h-1 w-5 rounded-full', index === 0 ? 'bg-primary' : 'bg-border')}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Card patrocinado da lista (`EXPLORE_FEED`): o mesmo esqueleto do card de espaço (raio 24, foto
 * 4:5), com o selo sobre a foto e, no rodapé, o destino e o botão de contorno. Anunciante Espaço
 * sem imagem própria vira o próprio card do espaço com o selo.
 */
export function FeedPreview({ content, width }: { content: PreviewContent; width: number }) {
  const Icon = DESTINATION_ICON[content.destinationType];
  if (content.usesSpaceCover) return <SpaceCardPreview content={content} width={width} />;
  return (
    <div
      data-testid="feed-preview"
      className="bg-card text-card-foreground overflow-hidden rounded-xl border border-border"
      style={{ width }}
    >
      <div className="relative w-full" style={{ aspectRatio: 4 / 5 }}>
        {content.imageUrl ? (
          <Photo url={content.imageUrl} />
        ) : (
          <MissingImage placement="EXPLORE_FEED" />
        )}
        <SponsoredBadge
          name={sponsoredName(content)}
          className="top-4 left-4"
          style={{ maxWidth: width - 32 }}
        />
      </div>
      <div className="flex flex-col gap-1 px-5 pt-4 pb-5">
        <p className="font-display line-clamp-2 text-xl leading-7 font-semibold">
          {content.title || 'Título da peça'}
        </p>
        {content.body.trim() ? (
          <p className="text-muted-foreground line-clamp-3 text-sm leading-5">{content.body}</p>
        ) : null}
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
          <span className="text-muted-foreground min-w-0 truncate text-sm leading-5">
            {content.destinationCaption}
          </span>
          <span className="border-outline-border bg-outline-background text-foreground inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md border-[1.5px] px-4 text-sm font-semibold">
            {content.ctaLabel || 'Botão'}
            <Icon className="size-4" aria-hidden />
          </span>
        </div>
      </div>
    </div>
  );
}

function SpaceCardPreview({ content, width }: { content: PreviewContent; width: number }) {
  const space = content.space;
  return (
    <div className="flex flex-col gap-2" style={{ width }}>
      <div
        data-testid="feed-preview"
        className="bg-card text-card-foreground overflow-hidden rounded-xl border border-border"
      >
        <div className="bg-muted relative w-full" style={{ aspectRatio: 4 / 5 }}>
          {space?.coverUrl ? (
            <Photo url={space.coverUrl} />
          ) : (
            <span className="text-muted-foreground absolute inset-0 flex items-center justify-center">
              <ImageIcon className="size-10" aria-hidden />
            </span>
          )}
          <SponsoredBadge
            name={sponsoredName(content)}
            className="top-4 left-4"
            style={{ maxWidth: width - 32 }}
          />
        </div>
        <div className="flex flex-col gap-3 px-5 pt-4 pb-5">
          <div className="flex items-center gap-3">
            <SpaceAvatar name={space?.name ?? '?'} logoUrl={space?.logoUrl} size={44} decorative />
            <div className="grid min-w-0 gap-0.5">
              <p className="font-display truncate text-xl leading-7 font-semibold">
                {space?.name ?? 'Espaço'}
              </p>
              {space?.location ? (
                <p className="text-muted-foreground truncate text-sm">{space.location}</p>
              ) : null}
            </div>
          </div>
          {space && space.sports.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {space.sports.map((sport) => (
                <Chip key={sport}>{sport}</Chip>
              ))}
            </div>
          ) : null}
          {space?.pricePerHourCents != null ? (
            <p className="text-muted-foreground border-t border-border pt-3 text-sm">
              <span className="font-display text-foreground text-xl font-bold">
                {formatCents(space.pricePerHourCents)}
              </span>{' '}
              / hora
            </p>
          ) : null}
        </div>
      </div>
      <p className="text-muted-foreground text-xs">
        O título e o texto não aparecem no card do espaço.
      </p>
    </div>
  );
}

/** Moldura de um tema, na largura da tela escolhida, com a peça em escala 1:1. */
export function PreviewFrame({
  theme,
  screenWidth,
  sponsor,
  children,
}: {
  theme: 'light' | 'dark';
  screenWidth: number;
  /** Nome do selo (`sponsoredName`): o selo desenhado é decorativo, a legenda o lê. */
  sponsor: string;
  children: React.ReactNode;
}) {
  const label = theme === 'light' ? 'Claro' : 'Escuro';
  return (
    <figure className="flex flex-col gap-2" style={{ width: screenWidth }}>
      <span aria-hidden className="text-muted-foreground font-sans text-overline uppercase">
        {label}
      </span>
      <div
        className={cn(
          theme,
          'bg-background text-foreground rounded-lg border border-border px-4 py-4',
        )}
        data-testid={`preview-${theme}`}
      >
        {children}
      </div>
      <figcaption className="sr-only">
        Pré-visualização no app, tema {label.toLowerCase()}. Patrocinado · {sponsor}
      </figcaption>
    </figure>
  );
}
