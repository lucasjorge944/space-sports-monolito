import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

type SubmitButtonProps = Omit<React.ComponentProps<typeof Button>, 'type'> & {
  pending: boolean;
  pendingLabel: string;
};

export function SubmitButton({ pending, pendingLabel, children, ...props }: SubmitButtonProps) {
  return (
    <Button type="submit" disabled={pending} {...props}>
      {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
      {pending ? pendingLabel : children}
    </Button>
  );
}
