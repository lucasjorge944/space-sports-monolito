import { EspacoNav } from '@/components/painel/espaco/espaco-nav';

export default function EspacoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <EspacoNav />
      {children}
    </div>
  );
}
