'use client';
import { LoadError } from '@/components/ui/loadError';
import { API_UNREACHABLE_MESSAGE, isApiUnreachable } from '@/lib/apiErrors';

export default function CampaignError({ error, reset }: { error: Error; reset: () => void }) {
  const message = isApiUnreachable(error)
    ? API_UNREACHABLE_MESSAGE
    : error.message || 'Something went wrong loading this campaign.';
  return <LoadError message={message} onRetry={reset} />;
}
