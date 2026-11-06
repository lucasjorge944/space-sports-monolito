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

type AuthCardProps = {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
};

/** Cartão centralizado das telas públicas de autenticação. */
export function AuthCard({ title, description, children, footer }: AuthCardProps) {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-2 px-4 py-8 sm:py-12">
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
