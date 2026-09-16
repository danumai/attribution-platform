'use client';
import { LoadError } from '@/components/ui/loadError';

export default function DashboardError({ error, reset }: { error: Error; reset: () => void }) {
  return <LoadError message={error.message || 'Something went wrong loading this page.'} onRetry={reset} />;
}
