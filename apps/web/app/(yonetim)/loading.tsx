import { Skeleton } from '@/components/ui/skeleton';

export default function YonetimLoading() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-6 w-48" />
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}
