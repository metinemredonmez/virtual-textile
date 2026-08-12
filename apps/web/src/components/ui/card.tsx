import * as React from 'react';
import { cn } from '@/lib/utils';

/** ⚠️ Kart kenarlığı RENK TAŞIMAZ (design-system.md → renk yalnızca durum). */
export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return <div className={cn('rounded-lg border border-kenar bg-zemin', className)} {...props} />;
}

export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return <div className={cn('flex flex-col gap-1 p-4', className)} {...props} />;
}

export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>): React.ReactElement {
  return <h3 className={cn('text-sm font-semibold text-metin', className)} {...props} />;
}

export function CardContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return <div className={cn('p-4 pt-0', className)} {...props} />;
}
