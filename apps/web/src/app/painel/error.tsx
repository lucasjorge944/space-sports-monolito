'use client';

import { RouteError } from '@/components/shell/route-states';

export default function ErrorPage(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError {...props} />;
}
