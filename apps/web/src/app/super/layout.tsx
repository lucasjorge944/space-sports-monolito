import { ShieldCheck } from 'lucide-react';
import { AppSidebar } from '@/components/shell/app-sidebar';
import { Topbar } from '@/components/shell/topbar';
import { SuperSandboxBadge } from '@/components/super/online/sandbox-topbar';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';

function SuperBrand() {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
      <div className="bg-sidebar-primary text-sidebar-primary-foreground flex size-8 items-center justify-center rounded-lg">
        <ShieldCheck className="size-4" />
      </div>
      <div className="grid text-sm leading-tight group-data-[collapsible=icon]:hidden">
        <span className="text-muted-foreground text-xs">Plataforma</span>
        <span className="font-medium">Super</span>
      </div>
    </div>
  );
}

export default function SuperLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar area="super" rootHref="/super" header={<SuperBrand />} />
      <SidebarInset className="min-w-0">
        <Topbar>
          <span className="text-primary text-sm font-medium">Painel da plataforma</span>
          <SuperSandboxBadge />
        </Topbar>
        {/* Tabelas largas: sem a caixa alta e o espaçamento do overline, a largura fica com as células. */}
        <main className="flex-1 p-6 [&_[data-slot=table-head]]:text-xs [&_[data-slot=table-head]]:tracking-normal [&_[data-slot=table-head]]:normal-case">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
