import { Alert } from '@/components/ui/alert';

/** Erro geral do formulário (o de cada campo fica no `FormField`). */
export function FormError({ message }: { message: string | undefined }) {
  if (!message) return null;
  return <Alert variant="destructive">{message}</Alert>;
}

export function FormNotice({ children }: { children: React.ReactNode }) {
  return (
    <Alert variant="info" role="status">
      {children}
    </Alert>
  );
}
