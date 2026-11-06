'use client';

import {
  type StaffInvite,
  type TeamMember,
  useGetTeam,
  useInviteStaff,
  useRemoveTeamMember,
  useReplaceTeamMemberRoles,
  useResendStaffInvite,
  useRevokeStaffInvite,
} from '@space-sports/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Mail, Pencil, Send, Trash2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/auth/form-alert';
import { ConfirmDialog } from '@/components/painel/confirm-dialog';
import { Field } from '@/components/painel/field';
import { ReadOnlyNotice, SpaceGate, type SpaceScope } from '@/components/painel/space-scope';
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from '@/components/painel/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select-menu';
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
import { canManageMember, GRANTABLE_ROLES, rolesToSave } from '@/lib/painel/team';

export function EquipeView() {
  return <SpaceGate permission="team.manage">{(scope) => <Equipe scope={scope} />}</SpaceGate>;
}

function Equipe({ scope }: { scope: SpaceScope }) {
  const queryClient = useQueryClient();
  const me = useMe();
  const team = useGetTeam(scope.spaceId);
  const canEdit = scope.canWrite('team.manage');
  const actor = { userId: me.data?.id ?? '', roles: scope.roles };

  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [removing, setRemoving] = useState<TeamMember | null>(null);
  const [revoking, setRevoking] = useState<StaffInvite | null>(null);

  const refresh = () => invalidateSpace(queryClient, scope.spaceId);
  const resend = useResendStaffInvite({
    mutation: {
      onSuccess: () => {
        toast.success('Convite reenviado.');
        void refresh();
      },
      onError: (e) => toast.error(apiErrorMessage(e)),
    },
  });
  const revoke = useRevokeStaffInvite();
  const remove = useRemoveTeamMember();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Equipe"
        description="Quem gerencia o espaço. Um usuário pode ter mais de um papel."
        actions={
          canEdit ? (
            <Button onClick={() => setInviteOpen(true)}>
              <UserPlus /> Convidar
            </Button>
          ) : null
        }
      />
      <ReadOnlyNotice scope={scope} />

      {team.isPending ? (
        <LoadingBlock rows={4} label="Carregando a equipe" />
      ) : team.isError ? (
        <ErrorState error={team.error} onRetry={() => void team.refetch()} />
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="font-display text-lg font-semibold">Membros</h2>
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>E-mail</TableHead>
                    <TableHead>Papéis</TableHead>
                    <TableHead>Desde</TableHead>
                    {canEdit ? <TableHead className="w-24" /> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {team.data.members.map((m) => {
                    const manageable = canEdit && canManageMember(actor, m);
                    return (
                      <TableRow key={m.userId} data-testid="member-row">
                        <TableCell className="font-medium">
                          {m.name}
                          {m.userId === actor.userId ? (
                            <span className="text-muted-foreground"> (você)</span>
                          ) : null}
                        </TableCell>
                        <TableCell>{m.email ?? '—'}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {m.roles.map((r) => (
                              <Badge key={r} variant={r === 'OWNER' ? 'default' : 'muted'}>
                                {ROLE_LABEL[r]}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="tabular-nums">{formatDateTime(m.joinedAt)}</TableCell>
                        {canEdit ? (
                          <TableCell className="text-right">
                            {manageable ? (
                              <>
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  aria-label={`Alterar papéis de ${m.name}`}
                                  onClick={() => setEditing(m)}
                                >
                                  <Pencil />
                                </Button>
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  aria-label={`Remover ${m.name}`}
                                  onClick={() => setRemoving(m)}
                                >
                                  <Trash2 />
                                </Button>
                              </>
                            ) : null}
                          </TableCell>
                        ) : null}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="font-display text-lg font-semibold">Convites em aberto</h2>
            {team.data.invites.length === 0 ? (
              <EmptyState
                title="Nenhum convite em aberto"
                description="Convide Admin ou Professor pelo e-mail. O link vale por 7 dias."
              />
            ) : (
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>E-mail</TableHead>
                      <TableHead>Papel</TableHead>
                      <TableHead>Situação</TableHead>
                      <TableHead>Convidado por</TableHead>
                      {canEdit ? <TableHead className="w-24" /> : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {team.data.invites.map((i) => (
                      <TableRow key={i.id} data-testid="invite-row">
                        <TableCell className="font-medium">{i.email}</TableCell>
                        <TableCell>{ROLE_LABEL[i.role]}</TableCell>
                        <TableCell>
                          {i.status === 'EXPIRED' ? (
                            <Badge variant="destructive">Expirado</Badge>
                          ) : (
                            <Badge variant="warning">Expira {formatDateTime(i.expiresAt)}</Badge>
                          )}
                        </TableCell>
                        <TableCell>{i.invitedBy.name}</TableCell>
                        {canEdit ? (
                          <TableCell className="text-right">
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`Reenviar convite para ${i.email}`}
                              disabled={resend.isPending}
                              onClick={() =>
                                resend.mutate({ spaceId: scope.spaceId, inviteId: i.id })
                              }
                            >
                              <Send />
                            </Button>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`Revogar convite de ${i.email}`}
                              onClick={() => setRevoking(i)}
                            >
                              <Trash2 />
                            </Button>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>
        </>
      )}

      <InviteDialog scope={scope} open={inviteOpen} onClose={() => setInviteOpen(false)} />
      <RolesDialog scope={scope} member={editing} onClose={() => setEditing(null)} />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remover ${removing?.name ?? 'membro'}`}
        description="O acesso ao painel deste espaço acaba na hora. A conta da pessoa continua existindo."
        confirmLabel="Remover"
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => {
          if (!removing) return;
          remove.mutate(
            { spaceId: scope.spaceId, userId: removing.userId },
            {
              onSuccess: () => {
                setRemoving(null);
                toast.success('Membro removido.');
                void refresh();
              },
            },
          );
        }}
      />
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const INVITE_ROLE_HINT: Record<(typeof GRANTABLE_ROLES)[number], string> = {
  ADMIN: 'Gerencia o espaço, quadras, equipe e relatórios.',
  TEACHER: 'Consulta a agenda e conduz as turmas (aulas).',
};

function InviteDialog({
  scope,
  open,
  onClose,
}: {
  scope: SpaceScope;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>{open ? <InviteForm scope={scope} onClose={onClose} /> : null}</DialogContent>
    </Dialog>
  );
}

function InviteForm({ scope, onClose }: { scope: SpaceScope; onClose: () => void }) {
  const queryClient = useQueryClient();
  const invite = useInviteStaff();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<(typeof GRANTABLE_ROLES)[number]>('ADMIN');
  const [error, setError] = useState<string>();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!EMAIL_RE.test(normalized)) return setError('Informe um e-mail válido');
    setError(undefined);
    invite.mutate(
      { spaceId: scope.spaceId, data: { email: normalized, role } },
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
        <DialogTitle>Convidar para a equipe</DialogTitle>
        <DialogDescription>
          A pessoa recebe um link por e-mail, válido por 7 dias.
        </DialogDescription>
      </DialogHeader>
      <FormError message={invite.error ? apiErrorMessage(invite.error) : undefined} />
      <Field label="E-mail" htmlFor="invite-email" error={error}>
        <Input
          id="invite-email"
          type="email"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field label="Papel" htmlFor="invite-role" hint={INVITE_ROLE_HINT[role]}>
        <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
          <SelectTrigger id="invite-role" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GRANTABLE_ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_LABEL[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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

function RolesDialog({
  scope,
  member,
  onClose,
}: {
  scope: SpaceScope;
  member: TeamMember | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={member !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {member ? (
          <RolesForm key={member.userId} scope={scope} member={member} onClose={onClose} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RolesForm({
  scope,
  member,
  onClose,
}: {
  scope: SpaceScope;
  member: TeamMember;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const replace = useReplaceTeamMemberRoles();
  const [chosen, setChosen] = useState<Set<string>>(new Set(member.roles));
  const [error, setError] = useState<string>();
  const isOwner = member.roles.includes('OWNER');

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const roles = rolesToSave(
      member,
      GRANTABLE_ROLES.filter((r) => chosen.has(r)),
    );
    if (roles.length === 0)
      return setError('O membro precisa ter ao menos um papel. Para tirar o acesso, remova-o');
    setError(undefined);
    replace.mutate(
      { spaceId: scope.spaceId, userId: member.userId, data: { roles } },
      {
        onSuccess: () => {
          toast.success('Papéis atualizados.');
          void invalidateSpace(queryClient, scope.spaceId);
          onClose();
        },
      },
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Papéis de {member.name}</DialogTitle>
        <DialogDescription>Vale só para este espaço.</DialogDescription>
      </DialogHeader>
      <FormError message={error} />
      <FormError message={replace.error ? apiErrorMessage(replace.error) : undefined} />
      <div className="grid gap-3">
        {isOwner ? (
          <div className="flex items-center gap-2">
            <Checkbox id="role-OWNER" checked disabled />
            <Label htmlFor="role-OWNER">Dono (definido pela plataforma)</Label>
          </div>
        ) : null}
        {GRANTABLE_ROLES.map((r) => (
          <div key={r} className="flex items-center gap-2">
            <Checkbox
              id={`role-${r}`}
              checked={chosen.has(r)}
              onCheckedChange={(v) =>
                setChosen((prev) => {
                  const next = new Set(prev);
                  if (v === true) next.add(r);
                  else next.delete(r);
                  return next;
                })
              }
            />
            <Label htmlFor={`role-${r}`}>{ROLE_LABEL[r]}</Label>
          </div>
        ))}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={replace.isPending}>
          Voltar
        </Button>
        <Button type="submit" disabled={replace.isPending}>
          {replace.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Salvar
        </Button>
      </DialogFooter>
    </form>
  );
}
