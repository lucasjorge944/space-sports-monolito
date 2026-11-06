'use client';

import {
  type ClassSessionDetail,
  listSpaceSubscriptions,
  useAddClassSessionAttendee,
} from '@space-sports/api-client';
import { useQuery } from '@tanstack/react-query';
import { Loader2, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { FormError } from '@/components/auth/form-alert';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/painel/states';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { fetchAllPages } from '@/lib/painel/agenda';
import { matchesName, studentsOutsideList } from '@/lib/painel/sessions';
import { sessionErrorMessage } from '@/lib/painel/sessions-errors';

type Candidate = { userId: string; name: string; hint: string };

/**
 * Adiciona um aluno à aula (RF-CLASS-09). A API não tem busca de usuários: a busca vale para os
 * matriculados na turma e, para quem pode ver as assinaturas (Dono e Admin), também para
 * os demais alunos do espaço. Sem vaga, o aluno entra na espera (a API decide).
 */
export function AddAttendeeDialog({
  open,
  onOpenChange,
  spaceId,
  session,
  canListStudents,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaceId: string;
  session: ClassSessionDetail;
  /** Papel com `enrollment.manage`: pode listar as assinaturas do espaço. */
  canListStudents: boolean;
  onAdded: (detail: ClassSessionDetail, userId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const add = useAddClassSessionAttendee({
    mutation: { onSuccess: (detail, vars) => onAdded(detail, vars.data.userId) },
  });
  const { reset } = add;
  useEffect(() => {
    if (open) {
      setQuery('');
      setPendingUser(null);
      reset();
    }
  }, [open, reset]);

  const students = useQuery({
    queryKey: ['class-session-add-students', spaceId],
    enabled: open && canListStudents,
    staleTime: 60_000,
    queryFn: () =>
      fetchAllPages((cursor) =>
        listSpaceSubscriptions(spaceId, {
          status: ['ACTIVE', 'PAST_DUE'],
          limit: 100,
          ...(cursor ? { cursor } : {}),
        }),
      ),
  });

  const candidates = useMemo(() => {
    const enrolled = studentsOutsideList(session.enrolledStudents, session.attendances).map(
      (s): Candidate => ({ userId: s.userId, name: s.name, hint: 'Matriculado na turma' }),
    );
    const known = new Set([
      ...enrolled.map((c) => c.userId),
      ...session.attendances.map((a) => a.userId),
    ]);
    const others: Candidate[] = [];
    for (const sub of students.data?.items ?? []) {
      if (known.has(sub.student.userId)) continue;
      known.add(sub.student.userId);
      others.push({
        userId: sub.student.userId,
        name: sub.student.name,
        hint: 'Outro aluno do espaço',
      });
    }
    return [...enrolled, ...others.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))];
  }, [session.enrolledStudents, session.attendances, students.data]);

  const visible = candidates.filter((c) => !query.trim() || matchesName(c.name, query));
  const full = session.confirmedCount >= session.capacity;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar aluno</DialogTitle>
          <DialogDescription>
            {full
              ? 'A aula está lotada: o aluno entra no fim da lista de espera.'
              : `${session.capacity - session.confirmedCount} vaga(s) livre(s): o aluno entra confirmado.`}
          </DialogDescription>
        </DialogHeader>
        <Input
          type="search"
          aria-label="Buscar aluno pelo nome"
          placeholder="Buscar aluno pelo nome"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <FormError message={add.error ? sessionErrorMessage(add.error) : undefined} />
        {canListStudents && students.isPending ? (
          <LoadingBlock rows={3} label="Carregando os alunos" />
        ) : (
          <>
            {students.error ? (
              <ErrorState
                error={students.error}
                title="Não foi possível carregar os demais alunos"
                onRetry={() => void students.refetch()}
              />
            ) : null}
            {visible.length === 0 ? (
              <EmptyState
                title="Nenhum aluno encontrado"
                description={
                  query.trim()
                    ? 'Ninguém com esse nome. Confira a grafia.'
                    : 'Todos os alunos disponíveis já estão na lista.'
                }
              />
            ) : (
              <ul className="flex max-h-72 flex-col divide-y overflow-y-auto rounded-lg border">
                {visible.map((c) => (
                  <li
                    key={c.userId}
                    data-testid="add-candidate"
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{c.name}</p>
                      <p className="text-muted-foreground text-xs">{c.hint}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Adicionar ${c.name}`}
                      disabled={add.isPending}
                      onClick={() => {
                        setPendingUser(c.userId);
                        add.mutate({ spaceId, sessionId: session.id, data: { userId: c.userId } });
                      }}
                    >
                      {add.isPending && pendingUser === c.userId ? (
                        <Loader2 className="animate-spin" aria-hidden />
                      ) : (
                        <UserPlus aria-hidden />
                      )}
                      Adicionar
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
