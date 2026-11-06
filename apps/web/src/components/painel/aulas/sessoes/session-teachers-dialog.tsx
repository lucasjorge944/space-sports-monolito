'use client';

import {
  type ClassSessionDetail,
  useListTeachers,
  useUpdateClassSession,
} from '@space-sports/api-client';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { FormError } from '@/components/auth/form-alert';
import { TeacherPicker } from '@/components/painel/aulas/teacher-picker';
import { ErrorState, LoadingBlock } from '@/components/painel/states';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatDateTime } from '@/lib/format';
import { withCurrentTeachers } from '@/lib/painel/aulas';
import { sessionErrorMessage } from '@/lib/painel/sessions-errors';
import { sameSelection } from '@/lib/painel/subscriptions';

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaceId: string;
  session: ClassSessionDetail;
  onChanged: () => void;
};

/** Professores desta aula (substituição, decisões 32 e 47): a lista da turma não muda. */
export function SessionTeachersDialog({ open, onOpenChange, ...props }: DialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open ? <TeachersForm onClose={() => onOpenChange(false)} {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function TeachersForm({
  spaceId,
  session,
  onChanged,
  onClose,
}: Omit<DialogProps, 'open' | 'onOpenChange'> & { onClose: () => void }) {
  const teachers = useListTeachers(spaceId);
  const current = session.teachers.map((t) => t.memberId);
  const [memberIds, setMemberIds] = useState(current);
  const update = useUpdateClassSession({ mutation: { onSuccess: onChanged } });

  const empty = memberIds.length === 0;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Professores desta aula</DialogTitle>
        <DialogDescription>
          {session.classGroup.name} · {formatDateTime(session.startsAt)}. Vale só para esta aula; os
          professores da turma não mudam.
        </DialogDescription>
      </DialogHeader>
      {teachers.isPending ? (
        <LoadingBlock rows={1} label="Carregando os professores" />
      ) : teachers.error ? (
        <ErrorState
          error={teachers.error}
          title="Não foi possível carregar os professores"
          onRetry={() => void teachers.refetch()}
        />
      ) : (
        <TeacherPicker
          teachers={withCurrentTeachers(teachers.data.items, session.teachers)}
          selected={memberIds}
          onChange={setMemberIds}
          error={empty ? 'Escolha ao menos um professor' : undefined}
        />
      )}
      <FormError message={update.error ? sessionErrorMessage(update.error) : undefined} />
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={update.isPending}>
          Voltar
        </Button>
        <Button
          disabled={
            update.isPending || empty || sameSelection(memberIds, current) || !teachers.data
          }
          onClick={() =>
            update.mutate({
              spaceId,
              sessionId: session.id,
              data: { teacherMemberIds: memberIds },
            })
          }
        >
          {update.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Salvar professores
        </Button>
      </DialogFooter>
    </>
  );
}
