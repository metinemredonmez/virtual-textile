'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Rıza akışı, adet uyarısı, onay soruları burada açılır.
 *
 * ⚠️ KVKK: `CONSENT_REQUIRED` ve `CONSENT_CROSS_BORDER_REQUIRED` AYRI kodlar ve
 *    AYRI modallar. Yurt dışı aktarım ayrı bir açık rıza ister; ikisini tek
 *    modalda toplayan istemci kullanıcıyı sonsuz döngüde bırakır.
 *
 * ⚠️ **PORTAL TEMA TUZAĞI KAPANDI — VE NASIL KAPANDIĞI ÖNEMLİ.**
 *    `Portal` içeriği `document.body`ye taşır. Tema sınıfı bir dönem
 *    `(yonetim)/layout.tsx` üzerindeydi, yani koyu panelde açılan modal temalı
 *    kabuğun DIŞINDA — açık temada — çizilecekti. Bugün `.tema-koyu` sınıfı
 *    `<html>` üzerinde duruyor (`lib/tema.ts` → satır içi betik) ve
 *    `document.body` zaten `<html>`in İÇİNDE; portal nereye taşırsa taşısın
 *    aynı değişken kapsamında kalıyor. Unutulacak bir kural kalmadı.
 *    ⚠️ `Portal`a `container` VERİLMEDİ ve bu bilinçli. İki sebep, ikisi de
 *       yeterli: (1) `container` her yeni modalda hatırlanması gereken bir
 *       kural doğurur ve bu deponun ölçülmüş zayıflığı tam olarak "her yerde
 *       hatırlanması gereken kural"dır; (2) `container` içeriği
 *       `overflow`/`transform`/`z-index` taşıyan bir atanın altına sokar ve
 *       `position:fixed` bir `transform`lı ata altında viewport'a DEĞİL O
 *       ATAYA göre konumlanır — bir tema arızasını kapatırken bir
 *       konumlandırma arızası açardı.
 *    ⚠️ İddia ÖLÇÜLDÜ (`next build && next start`, koyu tema çerezi, gerçek
 *       modal): portal içeriğinin `getComputedStyle(...).backgroundColor`
 *       değeri `rgb(13, 14, 17)`. Bu bir CSS değişkeni KAPSAMI sorunu; tip
 *       sistemi yakalamaz, o yüzden ölçüm zorunludur.
 */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

export function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>): React.ReactElement {
  return (
    <DialogPrimitive.Portal>
      {/* ⚠️ `bg-black/40` DEĞİL. Sabit renk sınıfı bu depoda yalnız burada ve
          `sheet.tsx`te kalmıştı; ikisi de tokenlaştırıldı çünkü koyu temada
          koyu sayfanın üstündeki %40 siyah perde ayırt edilemiyor — perdenin
          işi "arkası devre dışı" demek ve o cümle kayboluyordu. Değerler
          `globals.css` → `--perde`. */}
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-perde" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2',
          'rounded-lg border border-kenar bg-zemin p-6 text-metin',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className="absolute right-4 top-4 text-ikon hover:text-metin"
          aria-label="Kapat"
        >
          <X className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
