import * as React from 'react';
import { cn } from '@/lib/utils';

/** ⚠️ Hata durumu `aria-invalid` ile gelir; kenarlık rengi o zaman DURUM taşır. */
export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>): React.ReactElement {
  return (
    <input
      className={cn(
        'h-10 w-full rounded-md border border-kenar bg-zemin px-3 text-sm text-metin',
        'placeholder:text-metin-soluk disabled:opacity-50',
        'aria-[invalid=true]:border-tehlike',
        className,
      )}
      {...props}
    />
  );
}
