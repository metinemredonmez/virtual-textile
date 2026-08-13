import { Skeleton } from '@/components/ui/skeleton';

/**
 * ⚠️ İskelet gerçek düzenin ölçülerini taklit eder: solda form sütunu (etiket +
 *    40px giriş çiftleri), sağda 20rem özet. Rastgele kutular yerleşim kaymasına
 *    yol açar (AGENTS.md §8.4).
 */
export default function OdemeLoading() {
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_20rem] lg:items-start">
      <div className="flex flex-col gap-6">
        <Skeleton className="h-7 w-24" />
        <div className="flex flex-col gap-5">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
          <Skeleton className="h-12 w-full" />
        </div>
      </div>

      <Skeleton className="h-72 w-full" />
    </div>
  );
}
