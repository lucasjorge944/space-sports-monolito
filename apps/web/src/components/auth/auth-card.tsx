import type { ReactNode } from 'react';
import { Logo } from '@/components/brand/logo';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';

type AuthCardProps = {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Classes do contêiner (ex.: `max-w-md` para telas com mais conteúdo, como o consentimento). */
  className?: string;
};

/** Cartão centralizado das telas públicas de autenticação. */
export function AuthCard({ title, description, children, footer, className }: AuthCardProps) {
  return (
    <div
      className={cn(
        'mx-auto flex w-full max-w-sm flex-col items-center gap-2 px-4 py-8 sm:py-12',
        className,
      )}
    >
      <Logo layout="vertical" width={112} />
      <Card className="w-full">
        <CardHeader>
          <h1 className="sr-only">{title}</h1>
          <CardTitle className="text-xl" aria-hidden="true">
            {title}
          </CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">{children}</CardContent>
        {footer ? (
          <CardFooter className="text-muted-foreground flex-col gap-2 text-sm">{footer}</CardFooter>
        ) : null}
      </Card>
    </div>
  );
}
