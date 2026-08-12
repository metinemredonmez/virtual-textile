'use client';

import { HataGosterimi } from '@/components/hata/hata-gosterimi';

export default function YonetimError({ reset }: { error: Error; reset: () => void }) {
  return <HataGosterimi error={null} onRetry={reset} className="max-w-md" />;
}
