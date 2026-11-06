'use client';

import { useState } from 'react';
import { spaceInitials } from '@/lib/painel/space-data';
import { cn } from '@/lib/utils';

type SpaceAvatarProps = {
  name: string;
  logoUrl?: string | null;
  /** Lado em px (o avatar é um círculo). */
  size?: number;
  /** A logo está ao lado do nome do espaço: a imagem é decorativa (alt vazio) para o leitor de tela não repetir o nome. */
  decorative?: boolean;
  className?: string;
};

/** Logo do espaço em círculo; sem logo (ou se ela não carregar), as iniciais do nome. */
export function SpaceAvatar({
  name,
  logoUrl,
  size = 32,
  decorative = false,
  className,
}: SpaceAvatarProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = Boolean(logoUrl) && failedUrl !== logoUrl;
  return (
    <span
      data-slot="space-avatar"
      className={cn(
        'bg-primary text-primary-foreground inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-display font-semibold select-none',
        showImage && 'border-border bg-card border',
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) }}
    >
      {showImage ? (
        // biome-ignore lint/performance/noImgElement: URL externa do storage, sem otimização do Next
        <img
          src={logoUrl as string}
          alt={decorative ? '' : `Logo de ${name}`}
          width={size}
          height={size}
          className="size-full object-cover"
          onError={() => setFailedUrl(logoUrl ?? null)}
        />
      ) : (
        <span aria-hidden="true">{spaceInitials(name)}</span>
      )}
    </span>
  );
}
