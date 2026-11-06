'use client';

import { useState } from 'react';
import { spaceInitials } from '@/lib/painel/space-data';
import { cn } from '@/lib/utils';

type UserAvatarProps = {
  name: string;
  avatarUrl?: string | null | undefined;
  /** Lado em px (o avatar é um círculo). */
  size?: number;
  /** Ao lado do nome da pessoa: a imagem é decorativa (alt vazio) para o leitor de tela não repetir o nome. */
  decorative?: boolean;
  className?: string;
};

/**
 * Foto de perfil em círculo (RF-AUTH-02); sem foto (ou se ela não carregar), as iniciais do nome. A
 * foto vem do storage (CloudFront) ou do Google (decisão 71): `<img>` simples, sem o otimizador do Next.
 */
export function UserAvatar({
  name,
  avatarUrl,
  size = 32,
  decorative = false,
  className,
}: UserAvatarProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = Boolean(avatarUrl) && failedUrl !== avatarUrl;
  return (
    <span
      data-slot="user-avatar"
      className={cn(
        'bg-secondary text-secondary-foreground inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-display font-semibold select-none',
        showImage && 'border-border bg-card border',
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) }}
    >
      {showImage ? (
        // biome-ignore lint/performance/noImgElement: URL externa (storage ou Google), sem otimização do Next
        <img
          src={avatarUrl as string}
          alt={decorative ? '' : `Foto de ${name}`}
          width={size}
          height={size}
          referrerPolicy="no-referrer"
          className="size-full object-cover"
          onError={() => setFailedUrl(avatarUrl ?? null)}
        />
      ) : (
        <span aria-hidden="true">{spaceInitials(name || '?')}</span>
      )}
    </span>
  );
}
