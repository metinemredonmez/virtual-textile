import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * ⚠️ DEĞİŞMEZ KURAL: "Üzerimde Dene" ile "Sepete Ekle" AYNI görsel ağırlıkta
 *    olur — ikisi de `birincil`. Try-on ikincil bir özellik değil, ürünün
 *    kendisidir; `ikincil` varyantla çizilirse kullanıcı denemeden satın alır
 *    ve platformun tek ayrıştırıcısı işe yaramaz.
 *
 * ⚠️ Düğmeler RENK TAŞIMAZ. Birincil düğme siyahtır (akromatik), vurgu rengi
 *    değil. Renk yalnızca DURUM taşır — bkz. `badge.tsx`.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        birincil: 'bg-metin text-zemin hover:bg-metin/90',
        ikincil: 'border border-kenar bg-zemin text-metin hover:bg-yuzey-vurgulu',
        sessiz: 'text-metin hover:bg-yuzey-vurgulu',
        bag: 'text-vurgu underline-offset-4 hover:underline',
        /** Yalnızca yıkıcı eylemler (sil, iptal et) — burada renk DURUM taşıyor. */
        tehlike: 'bg-tehlike text-white hover:bg-tehlike/90',
      },
      size: {
        sm: 'h-8 px-3',
        md: 'h-10 px-4',
        lg: 'h-12 px-6 text-base',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'birincil', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps): React.ReactElement {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
