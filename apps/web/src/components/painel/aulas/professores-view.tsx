'use client';

import {
  type StaffInvite,
  type TeachersResponseItemsItem,
  type TeamMember,
  useGetTeam,
  useInviteStaff,
  useListTeachers,
  useRemoveTeamMember,
  useReplaceTeamMemberRoles,
  useRevokeStaffInvite,
} from '@space-sports/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Mail, Trash2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/auth/form-alert';
import { ConfirmDialog } from '@/components/painel/confirm-dialog';
import { Field } from '@/components/painel/field';
import { ReadOnlyNotice, SpaceGate, type SpaceScope } from '@/components/painel/space-scope';
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from '@/components/painel/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useMe } from '@/lib/auth/use-me';
import { formatDateTime } from '@/lib/format';
import { apiErrorMessage } from '@/lib/painel/errors';
import { ROLE_LABEL } from '@/lib/painel/labels';
import { invalidateSpace } from '@/lib/painel/query';
import { canManageMember, teacherRemoval } from '@/lib/painel/team';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function ProfessoresView() {
  return (
    <SpaceGate permission="classes.view">{(scope) => <Professores scope={scope} />}</SpaceGate>
  );
}

function Professores({ scope }: { scope: SpaceScope }) {
  const queryClient = useQueryClient();
  const me = useMe();
  const canManageTeam = scope.canWrite('team.manage');
  const teachers = useListTeachers(scope.spaceId);
  // A equipe traz os outros papéis de cada professor e os convites; só quem gere a equipe a lê.
  const team = useGetTeam(scope.spaceId, { query: { enabled: scope.can('team.manage') } });
  const actor = { userId: me.data?.id ?? '', roles: scope.roles };

  const [inviteOpen, setInviteOpen] = useState(false);
  const [removing, setRemoving] = useState<TeachersResponseItemsItem | null>(null);
  const [revoking, setRevoking] = useState<StaffInvite | null>(null);
  const removeMember = useRemoveTeamMember();
  const replaceRoles = useReplaceTeamMemberRoles();
  const revoke = useRevokeStaffInvite();

  const refresh = () => invalidateSpace(queryClient, scope.spaceId);
  const memberOf = (userId: string): TeamMember | undefined =>
    team.data?.members.find((m) => m.userId === userId);
  const invites = (team.data?.invites ?? []).filter((i) => i.role === 'TEACHER');

  const removingMember = removing ? memberOf(removing.userId) : undefined;
  const removal = removingMember ? teacherRemoval(removingMember) : null;
  const removeMutation = removal?.kind === 'drop-role' ? replaceRoles : removeMember;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Professores"
        description="Quem dá aula no espaço. Um professor pode atuar em mais de um espaço: o vínculo é por espaço."
        actions={
          canManageTeam ? (
            <Button onClick={() => setInviteOpen(true)}>
              <UserPlus /> Convidar professor
            </Button>
          ) : null
        }
      />
      <ReadOnlyNotice scope={scope} />

      {teachers.isPending ? (
        <LoadingBlock rows={3} label="Carregando os professores" />
      ) : teachers.isError ? (
        <ErrorState error={teachers.error} onRetry={() => void teachers.refetch()} />
      ) : teachers.data.items.length === 0 ? (
        <EmptyState
          title="Nenhum professor no espaço"
          description={
            canManageTeam
              ? 'Convide o primeiro professor pelo e-mail para poder cadastrar turmas.'
              : 'Peça ao Dono ou a um Admin para convidar os professores.'
          }
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Professor</TableHead>
                <TableHead>Papéis</TableHead>
                <TableHead>Turmas ativas</TableHead>
                {canManageTeam ? <TableHead className="w-16" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {teachers.data.items.map((t) => {
                const member = memberOf(t.userId);
                const manageable = canManageTeam && member && canManageMember(actor, member);
                return (
                  <TableRow key={t.memberId} data-testid="teacher-row">
                    <TableCell className="font-medium">
                      {t.name}
                      {t.userId === actor.userId ? (
                        <span className="text-muted-foreground"> (você)</span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(member?.roles ?? ['TEACHER']).map((r) => (
                          <Badge key={r} variant={r === 'TEACHER' ? 'default' : 'muted'}>
                            {ROLE_LABEL[r]}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="tabular-nums">{t.activeClassGroupCount}</TableCell>
                    {canManageTeam ? (
                      <TableCell className="text-right">
                        {manageable ? (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Remover ${t.name} dos professores`}
                            onClick={() => setRemoving(t)}
                          >
                            <Trash2 />
                          </Button>
                        ) : null}
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {canManageTeam && invites.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-lg font-semibold">Convites em aberto</h2>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {invites.map((i) => (
                  <TableRow key={i.id} data-testid="teacher-invite-row">
                    <TableCell className="font-medium">{i.email}</TableCell>
                    <TableCell>
                      {i.status === 'EXPIRED' ? (
                        <Badge variant="destructive">Expirado</Badge>
                      ) : (
                        <Badge variant="warning">Expira {formatDateTime(i.expiresAt)}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Revogar convite de ${i.email}`}
                        onClick={() => setRevoking(i)}
                      >
                        <Trash2 />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}

      <Dialog open={inviteOpen} onOpenChange={(o) => !o && setInviteOpen(false)}>
        <DialogContent>
          {inviteOpen ? <InviteForm scope={scope} onClose={() => setInviteOpen(false)} /> : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRemoving(null);
            removeMember.reset();
            replaceRoles.reset();
          }
        }}
        title={`Remover ${removing?.name ?? 'professor'}`}
        description={
          removal?.kind === 'drop-role'
            ? 'A pessoa deixa de ser professora deste espaço e mantém os outros papéis. Vale só aqui: em outros espaços o vínculo continua.'
            : 'A pessoa sai da equipe deste espaço e perde o acesso ao painel. Vale só aqui: a conta e os vínculos em outros espaços continuam. Quem tem turmas ativas não pode ser removido.'
        }
        confirmLabel="Remover"
        pending={removeMutation.isPending}
        error={removeMutation.error}
        onConfirm={() => {
          if (!removing || !removal) return;
          const done = {
            onSuccess: () => {
              setRemoving(null);
              toast.success('Professor removido.');
              void refresh();
            },
          };
          if (removal.kind === 'drop-role') {
            replaceRoles.mutate(
              { spaceId: scope.spaceId, userId: removing.userId, data: { roles: removal.roles } },
              done,
            );
          } else {
            removeMember.mutate({ spaceId: scope.spaceId, userId: removing.userId }, done);
          }
        }}
      />
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRevoking(null);
            revoke.reset();
          }
        }}
        title="Revogar convite"
        description={`O link enviado para ${revoking?.email ?? ''} deixa de funcionar.`}
        confirmLabel="Revogar"
        pending={revoke.isPending}
        error={revoke.error}
        onConfirm={() => {
          if (!revoking) return;
          revoke.mutate(
            { spaceId: scope.spaceId, inviteId: revoking.id },
            {
              onSuccess: () => {
                setRevoking(null);
                toast.success('Convite revogado.');
                void refresh();
              },
            },
          );
        }}
      />
    </div>
  );
}

function InviteForm({ scope, onClose }: { scope: SpaceScope; onClose: () => void }) {
  const queryClient = useQueryClient();
  const invite = useInviteStaff();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string>();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!EMAIL_RE.test(normalized)) return setError('Informe um e-mail válido');
    setError(undefined);
    invite.mutate(
      { spaceId: scope.spaceId, data: { email: normalized, role: 'TEACHER' } },
      {
        onSuccess: () => {
          toast.success('Convite enviado por e-mail.');
          void invalidateSpace(queryClient, scope.spaceId);
          onClose();
        },
      },
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Convidar professor</DialogTitle>
        <DialogDescription>
          A pessoa recebe um link por e-mail, válido por 7 dias. Quem já dá aula em outro espaço usa
          a mesma conta e passa a atuar nos dois.
        </DialogDescription>
      </DialogHeader>
      <FormError message={invite.error ? apiErrorMessage(invite.error) : undefined} />
      <Field label="E-mail" htmlFor="teacher-invite-email" error={error}>
        <Input
          id="teacher-invite-email"
          type="email"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={invite.isPending}>
          Voltar
        </Button>
        <Button type="submit" disabled={invite.isPending}>
          {invite.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Mail />}
          Enviar convite
        </Button>
      </DialogFooter>
    </form>
  );
}
