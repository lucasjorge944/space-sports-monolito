'use client';

import {
  type ClassGroup,
  type Court,
  useCreateClassGroup,
  useDeleteClassGroup,
  useListClassGroups,
  useListClassSessionConflicts,
  useListCourts,
  useListTeachers,
  useUpdateClassGroup,
} from '@space-sports/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil, Plus, Power, PowerOff, Trash2, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/auth/form-alert';
import { ConfirmDialog } from '@/components/painel/confirm-dialog';
import { Field } from '@/components/painel/field';
import { ReadOnlyNotice, SpaceGate, type SpaceScope } from '@/components/painel/space-scope';
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from '@/components/painel/states';
import { Alert } from '@/components/ui/alert';
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
import { MaskedInput } from '@/components/ui/masked-input';
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
import { formatDateTime } from '@/lib/format';
import {
  type ClassGroupDraft,
  classGroupFromDraft,
  DURATION_OPTIONS,
  draftFromClassGroup,
  emptyClassGroupDraft,
  formatClassSlot,
  START_TIME_OPTIONS,
  teacherNames,
  WEEKDAY_OPTIONS,
  withCurrentTeachers,
} from '@/lib/painel/aulas';
import { apiErrorMessage } from '@/lib/painel/errors';
import { CLASS_LEVEL_LABEL } from '@/lib/painel/labels';
import { invalidateSpace } from '@/lib/painel/query';
import { focusFirstInvalid } from '@/lib/utils';
import { TeacherPicker } from './teacher-picker';

const NO_LEVEL = 'NONE';
const CONFLICT_LABEL = {
  BOOKING: 'uma reserva',
  BLOCK: 'um bloqueio da quadra',
  CLASS: 'outra aula',
  TOURNAMENT: 'um torneio',
  TEACHER: 'uma aula do professor em outro espaço',
} as const;

export function TurmasView() {
  return <SpaceGate permission="classes.view">{(scope) => <Turmas scope={scope} />}</SpaceGate>;
}

type Editing = { group: ClassGroup | null } | null;
type StatusFilter = 'all' | 'active' | 'inactive';

function Turmas({ scope }: { scope: SpaceScope }) {
  const queryClient = useQueryClient();
  const canManage = scope.canWrite('classes.manage');
  // Quem é só Professor vê apenas as próprias turmas (a API filtra).
  const onlyTeacher = scope.roles.every((r) => r === 'TEACHER');
  const groups = useListClassGroups(scope.spaceId);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [editing, setEditing] = useState<Editing>(null);
  const [deactivating, setDeactivating] = useState<ClassGroup | null>(null);
  const [removing, setRemoving] = useState<ClassGroup | null>(null);

  const refresh = () => invalidateSpace(queryClient, scope.spaceId);
  const toggle = useUpdateClassGroup();
  const remove = useDeleteClassGroup();

  const items = (groups.data?.items ?? []).filter(
    (g) => filter === 'all' || (filter === 'active' ? g.active : !g.active),
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Turmas"
        description={
          onlyTeacher
            ? 'Suas turmas fixas, com as vagas e os alunos matriculados.'
            : 'Turmas fixas por esporte, professores, quadra e horário. As aulas de cada semana são geradas automaticamente.'
        }
        actions={
          canManage ? (
            <Button onClick={() => setEditing({ group: null })}>
              <Plus /> Nova turma
            </Button>
          ) : null
        }
      />
      <ReadOnlyNotice scope={scope} />
      {canManage ? <ConflictsNotice scope={scope} /> : null}

      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-sm">Situação</span>
        <Select value={filter} onValueChange={(v) => setFilter(v as StatusFilter)}>
          <SelectTrigger aria-label="Filtrar por situação" size="sm" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="active">Ativas</SelectItem>
            <SelectItem value="inactive">Inativas</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {groups.isPending ? (
        <LoadingBlock rows={4} label="Carregando as turmas" />
      ) : groups.isError ? (
        <ErrorState error={groups.error} onRetry={() => void groups.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          title={
            groups.data.items.length === 0
              ? 'Nenhuma turma cadastrada'
              : 'Nenhuma turma neste filtro'
          }
          description={
            groups.data.items.length === 0
              ? onlyTeacher
                ? 'Você ainda não tem turmas neste espaço.'
                : 'Cadastre a primeira turma para gerar as aulas e abrir matrículas.'
              : 'Mude o filtro de situação para ver as outras turmas.'
          }
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Turma</TableHead>
                <TableHead>Professores</TableHead>
                <TableHead>Quadra</TableHead>
                <TableHead>Horário</TableHead>
                <TableHead>Vagas</TableHead>
                <TableHead>Situação</TableHead>
                {canManage ? <TableHead className="w-36" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((g) => (
                <TableRow key={g.id} data-testid="class-group-row">
                  <TableCell>
                    <div className="font-medium">{g.name}</div>
                    <div className="text-muted-foreground text-xs">
                      {g.sport.name}
                      {g.level ? ` · ${CLASS_LEVEL_LABEL[g.level]}` : ''}
                    </div>
                  </TableCell>
                  <TableCell>{teacherNames(g.teachers)}</TableCell>
                  <TableCell>{g.court.name}</TableCell>
                  <TableCell className="tabular-nums">{formatClassSlot(g)}</TableCell>
                  <TableCell>
                    <div className="tabular-nums">
                      {g.enrolledCount}/{g.capacity} matriculados
                    </div>
                    {g.availableSpots === 0 ? (
                      <Badge variant="warning">Lotada</Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">
                        {g.availableSpots} {g.availableSpots === 1 ? 'vaga' : 'vagas'}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={g.active ? 'success' : 'muted'}>
                      {g.active ? 'Ativa' : 'Inativa'}
                    </Badge>
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Editar ${g.name}`}
                        onClick={() => setEditing({ group: g })}
                      >
                        <Pencil />
                      </Button>
                      {g.active ? (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Desativar ${g.name}`}
                          onClick={() => setDeactivating(g)}
                        >
                          <PowerOff />
                        </Button>
                      ) : (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Reativar ${g.name}`}
                          disabled={toggle.isPending}
                          onClick={() =>
                            toggle.mutate(
                              {
                                spaceId: scope.spaceId,
                                classGroupId: g.id,
                                data: { active: true },
                              },
                              {
                                onSuccess: () => {
                                  toast.success('Turma reativada.');
                                  void refresh();
                                },
                                onError: (e) => toast.error(apiErrorMessage(e)),
                              },
                            )
                          }
                        >
                          <Power />
                        </Button>
                      )}
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Excluir ${g.name}`}
                        onClick={() => setRemoving(g)}
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

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
          {editing ? (
            <ClassGroupForm
              key={editing.group?.id ?? 'new'}
              scope={scope}
              group={editing.group}
              onClose={() => setEditing(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deactivating !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeactivating(null);
            toggle.reset();
          }
        }}
        title={`Desativar ${deactivating?.name ?? 'turma'}`}
        description="As próximas aulas sem alunos confirmados deixam de existir e a quadra é liberada. Turmas com alunos matriculados não podem ser desativadas."
        confirmLabel="Desativar"
        pending={toggle.isPending}
        error={toggle.error}
        onConfirm={() => {
          if (!deactivating) return;
          toggle.mutate(
            { spaceId: scope.spaceId, classGroupId: deactivating.id, data: { active: false } },
            {
              onSuccess: () => {
                setDeactivating(null);
                toast.success('Turma desativada.');
                void refresh();
              },
            },
          );
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRemoving(null);
            remove.reset();
          }
        }}
        title={`Excluir ${removing?.name ?? 'turma'}`}
        description="Só turmas sem histórico podem ser excluídas; se já teve aula, desative. Esta ação não pode ser desfeita."
        confirmLabel="Excluir"
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => {
          if (!removing) return;
          remove.mutate(
            { spaceId: scope.spaceId, classGroupId: removing.id },
            {
              onSuccess: () => {
                setRemoving(null);
                toast.success('Turma excluída.');
                void refresh();
              },
            },
          );
        }}
      />
    </div>
  );
}

/** Aulas que o job não conseguiu gerar por conflito com reserva, bloqueio ou torneio. */
function ConflictsNotice({ scope }: { scope: SpaceScope }) {
  const conflicts = useListClassSessionConflicts(scope.spaceId);
  const items = conflicts.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <Alert
      variant="warning"
      role="status"
      className="flex flex-col gap-2"
      data-testid="class-conflicts"
    >
      <div className="flex items-center gap-2 font-medium">
        <TriangleAlert className="size-4" aria-hidden />
        {items.length} {items.length === 1 ? 'aula não foi gerada' : 'aulas não foram geradas'} por
        conflito na agenda
      </div>
      <ul className="list-disc pl-6">
        {items.map((c) => (
          <li key={c.id}>
            {c.classGroup.name} em {formatDateTime(c.startsAt)} ({c.court.name}): conflito com{' '}
            {CONFLICT_LABEL[c.conflictsWith]}
          </li>
        ))}
      </ul>
    </Alert>
  );
}

function ClassGroupForm({
  scope,
  group,
  onClose,
}: {
  scope: SpaceScope;
  group: ClassGroup | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const courts = useListCourts(scope.spaceId);
  const teachers = useListTeachers(scope.spaceId);
  const create = useCreateClassGroup();
  const update = useUpdateClassGroup();
  const mutation = group ? update : create;
  const [draft, setDraft] = useState<ClassGroupDraft>(() =>
    group ? draftFromClassGroup(group) : emptyClassGroupDraft(),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof ClassGroupDraft>(key: K, value: ClassGroupDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  // Só quadras ativas recebem turma (a atual entra mesmo se mudou de situação).
  const courtOptions: Court[] = (courts.data?.items ?? []).filter(
    (c) => c.status === 'ACTIVE' || c.id === group?.court.id,
  );
  const court = courtOptions.find((c) => c.id === draft.courtId);
  const sportOptions = court?.sports ?? [];
  const teacherOptions = withCurrentTeachers(teachers.data?.items ?? [], group?.teachers ?? []);
  const enrolled = group?.enrolledCount ?? 0;

  function chooseCourt(courtId: string) {
    const next = courtOptions.find((c) => c.id === courtId);
    setDraft((d) => ({
      ...d,
      courtId,
      // Mantém o esporte se a nova quadra também o oferece; senão, o único disponível ou nenhum.
      sportId: next?.sports.some((s) => s.sportId === d.sportId)
        ? d.sportId
        : next?.sports.length === 1
          ? (next.sports[0]?.sportId ?? '')
          : '',
    }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = classGroupFromDraft(draft, enrolled);
    if (!result.ok) {
      setErrors(result.errors);
      return focusFirstInvalid(event.currentTarget as HTMLFormElement);
    }
    setErrors({});
    const done = () => {
      toast.success(group ? 'Turma atualizada.' : 'Turma criada.');
      void invalidateSpace(queryClient, scope.spaceId);
      onClose();
    };
    if (group) {
      update.mutate(
        { spaceId: scope.spaceId, classGroupId: group.id, data: result.data },
        { onSuccess: done },
      );
    } else {
      create.mutate({ spaceId: scope.spaceId, data: result.data }, { onSuccess: done });
    }
  }

  const loadError = courts.isError ? courts.error : teachers.isError ? teachers.error : null;
  const loading = courts.isPending || teachers.isPending;

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{group ? 'Editar turma' : 'Nova turma'}</DialogTitle>
        <DialogDescription>
          O horário é o do espaço. As aulas das próximas 4 semanas são geradas e a quadra fica
          ocupada nesse horário.
        </DialogDescription>
      </DialogHeader>
      <FormError message={mutation.error ? apiErrorMessage(mutation.error) : undefined} />

      {loading ? (
        <LoadingBlock rows={4} label="Carregando quadras e professores" />
      ) : loadError ? (
        <ErrorState
          error={loadError}
          onRetry={() => {
            void courts.refetch();
            void teachers.refetch();
          }}
        />
      ) : (
        <>
          <Field label="Nome" htmlFor="cg-name" error={errors.name}>
            <Input
              id="cg-name"
              maxLength={80}
              placeholder="Ex.: Futevôlei iniciante, terça à noite"
              value={draft.name}
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Quadra" htmlFor="cg-court" error={errors.courtId}>
              <Select value={draft.courtId} onValueChange={chooseCourt}>
                <SelectTrigger id="cg-court" className="w-full">
                  <SelectValue placeholder="Escolha" />
                </SelectTrigger>
                <SelectContent>
                  {courtOptions.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field
              label="Esporte"
              htmlFor="cg-sport"
              error={errors.sportId}
              hint={
                enrolled > 0
                  ? 'Com alunos matriculados, o esporte não pode ser trocado.'
                  : undefined
              }
            >
              <Select
                value={draft.sportId}
                onValueChange={(v) => set('sportId', v)}
                disabled={!court}
              >
                <SelectTrigger id="cg-sport" className="w-full">
                  <SelectValue placeholder={court ? 'Escolha' : 'Escolha a quadra antes'} />
                </SelectTrigger>
                <SelectContent>
                  {sportOptions.map((s) => (
                    <SelectItem key={s.sportId} value={s.sportId}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Nível" htmlFor="cg-level">
              <Select
                value={draft.level === '' ? NO_LEVEL : draft.level}
                onValueChange={(v) =>
                  set('level', v === NO_LEVEL ? '' : (v as ClassGroupDraft['level']))
                }
              >
                <SelectTrigger id="cg-level" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_LEVEL}>Sem nível</SelectItem>
                  {(Object.keys(CLASS_LEVEL_LABEL) as (keyof typeof CLASS_LEVEL_LABEL)[]).map(
                    (l) => (
                      <SelectItem key={l} value={l}>
                        {CLASS_LEVEL_LABEL[l]}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </Field>
          </div>
          {teacherOptions.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nenhum professor no espaço. Convide um em Aulas → Professores.
            </p>
          ) : (
            <TeacherPicker
              teachers={teacherOptions}
              selected={draft.teacherMemberIds}
              onChange={(ids) => set('teacherMemberIds', ids)}
              error={errors.teacherMemberIds}
              hint="Escolha um ou mais. As aulas da turma saem com esta lista."
            />
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Dia da semana" htmlFor="cg-weekday" error={errors.weekday}>
              <Select value={draft.weekday} onValueChange={(v) => set('weekday', v)}>
                <SelectTrigger id="cg-weekday" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEEKDAY_OPTIONS.map((w) => (
                    <SelectItem key={w.value} value={w.value}>
                      {w.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Início" htmlFor="cg-start" error={errors.startTime}>
              <Select value={draft.startTime} onValueChange={(v) => set('startTime', v)}>
                <SelectTrigger id="cg-start" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {START_TIME_OPTIONS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Duração" htmlFor="cg-duration" error={errors.durationMin}>
              <Select value={draft.durationMin} onValueChange={(v) => set('durationMin', v)}>
                <SelectTrigger id="cg-duration" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DURATION_OPTIONS.map((d) => (
                    <SelectItem key={d.value} value={d.value}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field
            label="Capacidade (alunos)"
            htmlFor="cg-capacity"
            error={errors.capacity}
            hint={enrolled > 0 ? `${enrolled} aluno(s) matriculado(s) hoje.` : undefined}
          >
            <MaskedInput
              mask="integer"
              id="cg-capacity"
              maxLength={3}
              className="sm:w-40"
              value={draft.capacity}
              onValueChange={(v) => set('capacity', v)}
            />
          </Field>
        </>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>
          Voltar
        </Button>
        <Button type="submit" disabled={mutation.isPending || loading || loadError !== null}>
          {mutation.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Salvar
        </Button>
      </DialogFooter>
    </form>
  );
}
