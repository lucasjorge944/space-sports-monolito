'use client';

import {
  isApiError,
  useSuperEndSupportSession,
  useSuperGetSupportSession,
} from '@space-sports/api-client';
import { LifeBuoy } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatTime } from '@/lib/format';
import { clearSupportSession, isExpired, useSupportSession } from '@/lib/support/session';

/**
 * Faixa fixa do modo suporte (RF-SUPER-04): lembra que cada ação é auditada em nome do Super e
 * oferece a saída. Some sozinha quando a sessão expira ou é encerrada em outro lugar.
 */
export function SupportBanner() {
  const session = useSupportSession();
  if (!session) return null;
  return <ActiveBanner key={session.id} session={session} />;
}

function ActiveBanner({ session }: { session: NonNullable<ReturnType<typeof useSupportSession>> }) {
  const router = useRouter();
  const end = useSuperEndSupportSession();
  const [error, setError] = useState<string>();
  const ref = useRef<HTMLDivElement>(null);
  // Revalida na API: sessão encerrada em outra aba/dispositivo ou removida deixa de valer.
  const check = useSuperGetSupportSession(session.id, {
    query: { refetchInterval: 60_000, retry: false },
  });

  const gone = isApiError(check.error) && [401, 403, 404].includes(check.error.status);
  const finished = check.data ? !check.data.active : false;
  const expired = isExpired(session);

  useEffect(() => {
    if (gone || finished || expired) clearSupportSession();
  }, [gone, finished, expired]);

  useEffect(() => {
    const ms = new Date(session.expiresAt).getTime() - Date.now();
    if (ms <= 0) return;
    // setTimeout estoura acima de ~24,8 dias; a sessão dura 2 h, mas protege de dado adulterado.
    const timer = setTimeout(clearSupportSession, Math.min(ms, 2 ** 31 - 1));
    return () => clearTimeout(timer);
  }, [session.expiresAt]);

  // A sidebar fixa desce a altura da faixa (variável usada em globals.css).
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const root = document.documentElement;
    const update = () => root.style.setProperty('--support-banner-h', `${element.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--support-banner-h');
    };
  }, []);

  async function leave() {
    setError(undefined);
    try {
      await end.mutateAsync({ sessionId: session.id });
    } catch (thrown) {
      // Sessão já encerrada/expirada na API: sair do modo localmente é o certo.
      if (!(isApiError(thrown) && thrown.status < 500)) {
        setError('Não foi possível encerrar a sessão agora. Tente de novo');
        return;
      }
    }
    clearSupportSession();
    router.push(`/super/espacos/${session.spaceId}`);
  }

  return (
    <section
      ref={ref}
      aria-label="Modo suporte"
      data-testid="support-banner"
      className="bg-primary text-primary-foreground sticky top-0 z-40 flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm"
    >
      <p className="flex items-center gap-2">
        <LifeBuoy className="size-4 shrink-0" aria-hidden="true" />
        <span>
          <strong>Modo suporte:</strong> você está agindo como Dono de {session.spaceName}. Tudo o
          que fizer fica registrado em seu nome. Expira às {formatTime(session.expiresAt)}.
        </span>
      </p>
      <div className="flex items-center gap-2">
        {error ? <span role="alert">{error}</span> : null}
        <Button size="sm" variant="secondary" onClick={leave} disabled={end.isPending}>
          {end.isPending ? 'Saindo…' : 'Sair do modo suporte'}
        </Button>
      </div>
    </section>
  );
}
