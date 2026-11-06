'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '../page-header';
import { DeletionRequests } from './deletion-requests';
import { SuperAdmins } from './super-admins';
import { UsersTable } from './users-table';

export type UsersTab = 'usuarios' | 'lgpd' | 'super';

export function UsersView({ initialTab = 'usuarios' }: { initialTab?: UsersTab }) {
  const [tab, setTab] = useState<UsersTab>(initialTab);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Usuários"
        description="Busca, vínculos com espaços, bloqueio, pedidos de exclusão (LGPD) e acesso Super."
      />
      <Tabs value={tab} onValueChange={(value) => setTab(value as UsersTab)}>
        <TabsList>
          <TabsTrigger value="usuarios">Usuários</TabsTrigger>
          <TabsTrigger value="lgpd">Pedidos LGPD</TabsTrigger>
          <TabsTrigger value="super">Equipe Super</TabsTrigger>
        </TabsList>
        <TabsContent value="usuarios">
          <UsersTable />
        </TabsContent>
        <TabsContent value="lgpd">
          <DeletionRequests />
        </TabsContent>
        <TabsContent value="super">
          <SuperAdmins />
        </TabsContent>
      </Tabs>
    </div>
  );
}
