'use client';
import { LoadError } from '@/components/ui/loadError';

export default function CampaignError({ error, reset }: { error: Error; reset: () => void }) {
  return <LoadError message={error.message || 'Something went wrong loading this campaign.'} onRetry={reset} />;
}
