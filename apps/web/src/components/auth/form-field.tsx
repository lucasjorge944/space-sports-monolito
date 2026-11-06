import { Field } from '@/components/painel/field';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type FormFieldProps = Omit<React.ComponentProps<typeof Input>, 'id' | 'name'> & {
  name: string;
  label: string;
  error?: string | undefined;
  hint?: React.ReactNode;
  optional?: boolean;
  /** Campo de 48 px, para as telas públicas (entrada, cadastro, convite); o painel usa 36. */
  large?: boolean;
};

/** `Field` com um `Input`, para formulários em que o nome do campo é também o `id`. */
export function FormField({
  name,
  label,
  error,
  hint,
  optional,
  large,
  className,
  ...inputProps
}: FormFieldProps) {
  return (
    <Field label={label} htmlFor={name} error={error} hint={hint} optional={optional ?? false}>
      <Input
        name={name}
        className={cn(large && 'h-12 text-base md:text-base', className)}
        {...inputProps}
      />
    </Field>
  );
}
