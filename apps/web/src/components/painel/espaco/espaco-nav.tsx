'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/painel/espaco', label: 'Dados' },
  { href: '/painel/espaco/fotos', label: 'Fotos' },
  { href: '/painel/espaco/quadras', label: 'Quadras' },
  { href: '/painel/espaco/configuracoes', label: 'Configurações' },
];

export function EspacoNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Seções do espaço"
      className="flex gap-1 overflow-x-auto overflow-y-hidden border-b"
    >
      {LINKS.map((l) => {
        const active = pathname === l.href;
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap',
              active
                ? 'border-primary text-foreground font-semibold'
                : 'text-muted-foreground hover:text-foreground border-transparent',
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
