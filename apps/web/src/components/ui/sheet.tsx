'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * ÇEKMECE — mobil filtre kalıbı (Grailed'dan alınan tek şey).
 *
 * Radix Dialog üzerine kuruludur: odak tuzağı, ESC ve `aria-modal` davranışını
 * ikinci kez yazmamak için. Görsel olarak yandan girer, anlamsal olarak modaldır.
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
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetTitle = DialogPrimitive.Title;

export function SheetContent({
  className,
  children,
  side = 'right',
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  side?: 'right' | 'left' | 'bottom';
}): React.ReactElement {
  const konum = {
    right: 'inset-y-0 right-0 w-[min(24rem,90vw)] border-l',
    left: 'inset-y-0 left-0 w-[min(24rem,90vw)] border-r',
    bottom: 'inset-x-0 bottom-0 max-h-[85vh] border-t rounded-t-lg',
  }[side];

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
      <DialogPrimitive.Content
        className={cn('fixed z-50 border-kenar bg-zemin p-6 text-metin', konum, className)}
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
