import { cn } from '@/lib/utils';
import { FormField } from './form-field';

/** E-mail do login e do cadastro; travado quando a tela veio de um convite de equipe. */
export function EmailField({
  error,
  locked,
  loading,
}: {
  error: string | undefined;
  locked: string | undefined;
  loading: boolean;
}) {
  return (
    <FormField
      // O campo não é controlado: a chave o recria com o valor quando a prévia do convite chega.
      key={locked ?? 'free'}
      large
      name="email"
      label="E-mail"
      type="email"
      autoComplete="email"
      inputMode="email"
      error={error}
      defaultValue={locked}
      readOnly={Boolean(locked) || loading}
      className={cn(locked && 'bg-muted text-muted-foreground')}
      hint={locked ? 'E-mail do convite. Ele não pode ser trocado aqui.' : undefined}
    />
  );
}
