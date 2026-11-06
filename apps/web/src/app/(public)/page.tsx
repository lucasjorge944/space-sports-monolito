import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function HomePage() {
  return (
    <section className="mx-auto flex max-w-3xl flex-col items-start gap-6 px-6 py-24">
      <h1 className="text-h2 sm:text-display">Reserve quadras. Jogue. Compita.</h1>
      <p className="text-muted-foreground max-w-xl text-lg">
        Space Sports reúne reservas, aulas e torneios dos espaços esportivos da sua cidade.
      </p>
      <div className="flex gap-3">
        <Button asChild size="xl">
          <Link href="/painel">Painel do espaço</Link>
        </Button>
        <Button asChild variant="outline" size="xl">
          <Link href="/entrar">Entrar</Link>
        </Button>
      </div>
    </section>
  );
}
