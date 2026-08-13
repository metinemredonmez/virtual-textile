import { Skeleton } from '@/components/ui/skeleton';

/**
 * ⚠️ BU DOSYA GEREKLİ, çünkü grup iskeleti (`(magaza)/loading.tsx`) 4:5 oranlı
 *    bir ÜRÜN IZGARASI çiziyor. Burada ürün yok; o iskelet gösterilseydi
 *    kullanıcı bir saniyeliğine bambaşka bir sayfa görür, sonra içerik gelince
 *    yerleşim tamamen kayardı. İskelet gerçek düzeni taklit eder: başlık,
 *    paragraf, 2×2 form ve üç özet kutusu.
 */
export default function HesaplayiciLoading() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-16 py-8">
      <div className="flex flex-col gap-4">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-16 w-full" />
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-3 w-48" />
          </div>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    </div>
  );
}
