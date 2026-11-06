'use client';

import { Field } from '@/components/painel/field';
import { ChipButton } from '@/components/ui/chip';

type TeacherOption = { memberId: string; name: string };

/** Um ou mais professores do espaço (decisão 47): chips com seleção múltipla. */
export function TeacherPicker({
  label = 'Professores',
  teachers,
  selected,
  onChange,
  error,
  hint,
}: {
  label?: string;
  teachers: readonly TeacherOption[];
  selected: readonly string[];
  onChange: (memberIds: string[]) => void;
  error?: string | undefined;
  hint?: string;
}) {
  return (
    <Field label={label} error={error} hint={hint} group>
      <div className="flex flex-wrap gap-2">
        {teachers.map((teacher) => {
          const isSelected = selected.includes(teacher.memberId);
          return (
            <ChipButton
              key={teacher.memberId}
              selected={isSelected}
              onClick={() =>
                onChange(
                  isSelected
                    ? selected.filter((id) => id !== teacher.memberId)
                    : [...selected, teacher.memberId],
                )
              }
            >
              {teacher.name}
            </ChipButton>
          );
        })}
      </div>
    </Field>
  );
}
