'use client';

import { RouteError } from '@/components/shell/route-states';

export default function ErrorPage(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <RouteError {...props} />
    </div>
  );
}
