'use client';

import { Store } from 'lucide-react';
import { useSelectedSpace } from '@/components/shell/selected-space';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ROLE_LABEL } from '@/lib/painel/labels';
import { PageHeader } from './states';

/** Escolha do espaço quando o usuário tem vínculo com mais de um (RN-AUTH-03). */
export function SpaceChooser() {
  const { memberships, select } = useSelectedSpace();
  return (
    <div className="flex flex-col gap-6" data-testid="space-chooser">
      <PageHeader
        title="Escolha o espaço"
        description="Você gerencia mais de um espaço. Dá para trocar a qualquer momento pelo menu lateral."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {memberships.map(({ space, roles }) => (
          <Card key={space.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Store className="size-4" aria-hidden />
                {space.name}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-muted-foreground text-sm">
                {roles.map((r) => ROLE_LABEL[r]).join(' · ')}
                {space.status === 'SUSPENDED' ? ' · Suspenso' : ''}
              </p>
              <Button onClick={() => select(space.id)}>Abrir painel</Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
