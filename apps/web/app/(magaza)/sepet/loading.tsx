import { Skeleton } from '@/components/ui/skeleton';

/**
 * ⚠️ İskelet GERÇEK düzenin ölçülerini taklit eder: solda satıcı kartı içinde
 *    80px genişliğinde 4:5 görsel + iki metin satırı, sağda 20rem özet sütunu.
 *    Rastgele kutular yerleşim kaymasına yol açar ve kullanıcı sayfayı iki kez
 *    okur (AGENTS.md §8.4).
 */
export default function SepetLoading() {
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_20rem] lg:items-start">
      <div className="flex flex-col gap-6">
        <Skeleton className="h-7 w-32" />
        {Array.from({ length: 2 }, (_, paketNo) => (
          <div key={paketNo} className="rounded-lg border border-kenar">
            <div className="border-b border-kenar p-4">
              <Skeleton className="h-4 w-32" />
            </div>
            <div className="flex flex-col gap-4 p-4">
              {Array.from({ length: 2 }, (_, satirNo) => (
                <div key={satirNo} className="flex gap-4">
                  <Skeleton className="aspect-urun w-20 shrink-0" />
                  <div className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-4 w-1/4" />
                    <Skeleton className="mt-2 h-8 w-28" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}
