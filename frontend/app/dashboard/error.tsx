'use client';
import { LoadError } from '@/components/ui/loadError';
import { API_UNREACHABLE_MESSAGE, isApiUnreachable } from '@/lib/apiErrors';

export default function DashboardError({ error, reset }: { error: Error; reset: () => void }) {
  const message = isApiUnreachable(error)
    ? API_UNREACHABLE_MESSAGE
    : error.message || 'Something went wrong loading this page.';
  return <LoadError message={message} onRetry={reset} />;
}
