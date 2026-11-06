'use client';

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
          // `richColors`: os status tingidos da marca no lugar da paleta própria do Sonner.
          '--success-bg': 'var(--success-subtle)',
          '--success-text': 'var(--success-subtle-foreground)',
          '--success-border': 'var(--success)',
          '--error-bg': 'var(--destructive-subtle)',
          '--error-text': 'var(--destructive-subtle-foreground)',
          '--error-border': 'var(--destructive)',
          '--warning-bg': 'var(--warning-subtle)',
          '--warning-text': 'var(--warning-subtle-foreground)',
          '--warning-border': 'var(--warning)',
          '--info-bg': 'var(--info-subtle)',
          '--info-text': 'var(--info-subtle-foreground)',
          '--info-border': 'var(--info)',
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
