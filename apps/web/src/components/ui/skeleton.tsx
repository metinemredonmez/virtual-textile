import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * ⚠️ İskelet YALNIZCA şekli bilinen içerik için kullanılır (ürün kartı, tablo
 *    satırı). Bilinmeyen bir şey için belirsiz bir kutu çizmek, dönen çarkın
 *    daha yavaş hali olur. Süresi bilinen işler (try-on) için belirli ilerleme
 *    çubuğu kullanılır — bkz. AGENTS.md.
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return <div className={cn('animate-pulse rounded-md bg-yuzey-vurgulu', className)} {...props} />;
}
