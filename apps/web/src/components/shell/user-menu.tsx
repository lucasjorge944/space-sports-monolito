'use client';

import { ChevronDown, LogOut, UserRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { UserAvatar } from '@/components/account/user-avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { signOut } from '@/lib/auth/sign-out';
import { useMe } from '@/lib/auth/use-me';

/** Menu da conta na barra superior: quem está logado (foto ou iniciais), "Meu perfil" e "Sair". */
export function UserMenu() {
  const { data: me } = useMe();
  const pathname = usePathname();
  const [leaving, setLeaving] = useState(false);
  // Um componente, duas rotas: o perfil abre dentro da área em que a pessoa está.
  const profileHref = pathname.startsWith('/super') ? '/super/perfil' : '/painel/perfil';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* Gatilho de menu, não ação: neutro, e não o Mar do ghost "Cancelar". */}
        <Button
          variant="ghost"
          size="sm"
          className="text-foreground hover:text-foreground"
          aria-label="Menu da conta"
          data-testid="user-menu"
        >
          {me ? (
            <UserAvatar name={me.name} avatarUrl={me.avatarUrl} size={24} decorative />
          ) : (
            <UserRound className="size-4" />
          )}
          <span className="hidden max-w-40 truncate sm:inline">{me?.name || 'Minha conta'}</span>
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
          <span className="truncate font-medium">{me?.name || 'Minha conta'}</span>
          {me?.email ? (
            <span className="text-muted-foreground truncate text-xs">{me.email}</span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={profileHref}>
            <UserRound className="size-4" />
            Meu perfil
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={leaving}
          onSelect={(event) => {
            event.preventDefault();
            setLeaving(true);
            void signOut();
          }}
        >
          <LogOut className="size-4" />
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
