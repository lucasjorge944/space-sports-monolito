'use client';

import { Check, ChevronsUpDown, Store } from 'lucide-react';
import { SpaceAvatar } from '@/components/space-avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { Skeleton } from '@/components/ui/skeleton';
import { useSelectedSpace } from './selected-space';

function SwitcherIcon() {
  return (
    <div className="bg-sidebar-primary text-sidebar-primary-foreground flex size-8 items-center justify-center rounded-full">
      <Store className="size-4" />
    </div>
  );
}

export function SpaceSwitcher() {
  const { status, memberships, selected, select, retry } = useSelectedSpace();

  if (status === 'loading') {
    return (
      <div
        className="flex h-12 items-center gap-2 px-2"
        role="status"
        aria-label="Carregando espaços"
        data-testid="space-switcher"
      >
        <Skeleton className="size-8 rounded-full" />
        <Skeleton className="h-4 flex-1" />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" onClick={retry} data-testid="space-switcher">
            <SwitcherIcon />
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="font-medium">Não foi possível carregar</span>
              <span className="text-muted-foreground text-xs">Toque para tentar de novo</span>
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              aria-label="Selecionar espaço"
              data-testid="space-switcher"
              disabled={!selected}
            >
              {selected ? (
                <SpaceAvatar
                  name={selected.space.name}
                  logoUrl={selected.space.logoUrl}
                  size={32}
                  decorative
                />
              ) : (
                <SwitcherIcon />
              )}
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="text-muted-foreground text-xs">Espaço</span>
                <span className="truncate font-medium">
                  {selected?.space.name ?? 'Nenhum espaço'}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
            align="start"
          >
            <DropdownMenuLabel>Seus espaços</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {memberships.map(({ space }) => (
              <DropdownMenuItem key={space.id} onSelect={() => select(space.id)}>
                <SpaceAvatar name={space.name} logoUrl={space.logoUrl} size={20} decorative />
                <span className="truncate">{space.name}</span>
                {space.status === 'SUSPENDED' ? (
                  <span className="text-muted-foreground text-xs">Suspenso</span>
                ) : null}
                {space.id === selected?.space.id ? <Check className="ml-auto size-4" /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
