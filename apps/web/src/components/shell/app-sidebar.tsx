'use client';

import { canInSpace } from '@space-sports/api-client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Logo } from '@/components/brand/logo';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';
import { cn, focusRing } from '@/lib/utils';
import { painelNav, superNav } from './nav';
import { useOptionalSelectedSpace } from './selected-space';

const navByArea = { painel: painelNav, super: superNav };

type AppSidebarProps = {
  /** Nome da área; o menu é resolvido aqui porque os ícones não cruzam a fronteira server → client. */
  area: keyof typeof navByArea;
  header: ReactNode;
  footer?: ReactNode;
  /** Rota raiz da área; só é "ativa" em correspondência exata. */
  rootHref: string;
};

export function AppSidebar({ area, header, footer, rootHref }: AppSidebarProps) {
  const pathname = usePathname();
  const space = useOptionalSelectedSpace();
  // Itens com `permission` só aparecem com o papel no espaço já escolhido (a API recusa o resto).
  const roles = space?.status === 'ready' && !space.needsChoice ? space.selected?.roles : undefined;
  const groups = navByArea[area]
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) => !item.permission || (roles !== undefined && canInSpace(roles, item.permission)),
      ),
    }))
    .filter((group) => group.items.length > 0);
  const isActive = (href: string) =>
    href === rootHref ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Sidebar>
      <SidebarHeader>
        <Link href={rootHref} className={cn('flex justify-center rounded-md', focusRing)}>
          <Logo layout="horizontal" width={160} className="group-data-[collapsible=icon]:hidden" />
          <Logo
            layout="symbol"
            width={40}
            className="hidden group-data-[collapsible=icon]:inline-block"
          />
        </Link>
        {header}
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={isActive(item.href)}>
                      <Link href={item.href}>
                        {item.icon ? <item.icon /> : null}
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      {footer ? <SidebarFooter>{footer}</SidebarFooter> : null}
      <SidebarRail />
    </Sidebar>
  );
}
