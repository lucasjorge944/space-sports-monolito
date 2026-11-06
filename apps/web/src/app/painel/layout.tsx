import { AppSidebar } from '@/components/shell/app-sidebar';
import { SelectedSpaceProvider } from '@/components/shell/selected-space';
import { SpaceSwitcher } from '@/components/shell/space-switcher';
import { Topbar } from '@/components/shell/topbar';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';

export default function PainelLayout({ children }: { children: React.ReactNode }) {
  return (
    <SelectedSpaceProvider>
      <SidebarProvider>
        <AppSidebar area="painel" rootHref="/painel" header={<SpaceSwitcher />} />
        <SidebarInset>
          <Topbar>
            <span className="text-muted-foreground text-sm">Painel do espaço</span>
          </Topbar>
          <main className="flex-1 p-6">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </SelectedSpaceProvider>
  );
}
