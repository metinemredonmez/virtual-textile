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
 * ⚠️ **YÖNETİM PANELİNDE KULLANILMADAN ÖNCE OKUYUN — TEMA TUZAĞI.**
 *    `Portal` içeriği `document.body`ye taşır, yani `.tema-koyu` sınıfını
 *    taşıyan `(yonetim)` kabuğunun DIŞINA. Koyu panelde açılan bir modal bugün
 *    AÇIK temada çizilir: beyaz zemin, siyah metin, kenarlıklar kaybolur.
 *    Bugün yönetim ve satıcı ekranlarının hiçbiri bu bileşeni kullanmıyor, o
 *    yüzden arıza CANLIDA GÖRÜNMÜYOR — ilk kullanan ekranla birlikte görünür.
 *    Kullanmadan önce doğru düzeltme: `Portal`a `container` verip temalı
 *    ağacın içine çizdirmek (ya da içeriğe `tema-koyu` sınıfını taşıtmak).
 *    ⚠️ Karar `next build && next start` üzerinde GÖZLE doğrulanmadan
 *       "çalışıyor" YAZILMAZ; bu bir CSS değişkeni kapsamı sorunu, tip sistemi
 *       yakalamaz.
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
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
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
