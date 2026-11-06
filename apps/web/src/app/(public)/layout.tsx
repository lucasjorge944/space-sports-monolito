import Link from 'next/link';
import { Logo } from '@/components/brand/logo';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { cn, focusRing, textLink } from '@/lib/utils';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex items-center justify-between border-b px-4 sm:px-6">
        <Link href="/" className={cn('rounded-md', focusRing)}>
          <Logo layout="horizontal" width={160} />
        </Link>
        <ThemeToggle />
      </header>
      <main className="flex-1">{children}</main>
      <footer className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 border-t px-4 text-sm sm:px-6">
        <Link href="/" className={cn('rounded-md', focusRing)}>
          <Logo layout="horizontal" width={160} />
        </Link>
        <Link href="/excluir-conta" className={cn(textLink, 'rounded-md', focusRing)}>
          Excluir minha conta
        </Link>
      </footer>
    </div>
  );
}
