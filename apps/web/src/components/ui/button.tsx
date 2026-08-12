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
        /**
         * Yalnızca yıkıcı eylemler (sil, reddet) — burada renk DURUM taşıyor.
         *
         * ⚠️ `text-white` DEĞİL, `text-tehlike-metin`. Sabit renk sınıfı olması
         *    bir yana, ÖLÇÜLDÜ: koyu temada beyaz/#ef6b6b **3,01:1** ediyordu
         *    (AA eşiği 4,5:1; 14px font-medium metin "büyük metin" muafiyetine
         *    girmiyor) ve bu düğme payout reddi, satıcı reddi ve ürün reddi
         *    ekranlarının HEPSİNDE çıkıyor — geri alınamaz kararların düğmesi
         *    okunmuyordu. Token tema başına dallanıyor: açıkta beyaz (6,47:1),
         *    koyuda zemin rengi (6,42:1); `hover` durumunda 5,58 / 5,37.
         *    Gerekçenin tamamı `globals.css` → `--color-tehlike-metin`.
         */
        tehlike: 'bg-tehlike text-tehlike-metin hover:bg-tehlike/90',
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
