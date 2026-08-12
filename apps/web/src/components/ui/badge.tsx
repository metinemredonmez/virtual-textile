import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * ROZET — RENK TAŞIYAN TEK BİLEŞEN AİLESİ.
 *
 * ⚠️ Renk yalnızca DURUM taşır: sipariş durumu, satıcı onay durumu, payout
 *    durumu, stok uyarısı, try-on uygunluk eşiği. Bir öğe renkliyse kullanıcı
 *    "burada bir durum var" diye okur; süs amaçlı renk bu sinyali harcar ve
 *    ekrana bakan kişi neyin önemli olduğunu ayırt edemez.
 *
 * Bu yüzden VARSAYILAN varyant `notr`dur: renk istemek bilinçli bir karar
 * olmalı, varsayılan olmamalı.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs font-medium',
  {
    variants: {
      durum: {
        notr: 'bg-yuzey-vurgulu text-metin-soluk',
        olumlu: 'bg-olumlu-zemin text-olumlu',
        uyari: 'bg-uyari-zemin text-uyari',
        tehlike: 'bg-tehlike-zemin text-tehlike',
      },
    },
    defaultVariants: { durum: 'notr' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, durum, ...props }: BadgeProps): React.ReactElement {
  return <span className={cn(badgeVariants({ durum }), className)} {...props} />;
}
