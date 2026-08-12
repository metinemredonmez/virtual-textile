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
