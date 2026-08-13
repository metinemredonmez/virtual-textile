import { Skeleton } from '@/components/ui/skeleton';

/**
 * ⚠️ İskelet, GERÇEK düzenin ölçülerini taklit eder: başlık + arama kutusu +
 *    araç çubuğu + (masaüstünde) 240px kenar çubuğu + 4:5 kartlar. `(magaza)`
 *    kökündeki genel iskelet yalnızca ızgarayı çiziyor; bu ekranda kenar
 *    çubuğu sonradan belirdiğinde ızgara yatayda kayıyor ve kullanıcı sayfayı
 *    iki kez okuyor.
 */
export default function UrunlerLoading(): React.ReactElement {
  return (
    <div>
      <div className="mb-6 flex flex-col gap-4">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-10 w-full max-w-xl" />
      </div>

      <div className="flex items-center justify-between border-y border-kenar py-3">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-5 w-64" />
      </div>

      <div className="mt-8 flex gap-10">
        <div className="hidden w-60 shrink-0 flex-col gap-6 lg:flex">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ))}
        </div>

        <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="aspect-urun w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/3" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
