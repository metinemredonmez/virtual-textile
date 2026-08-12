import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * FİNANSAL TABLO — Stripe kalıbı.
 *
 * ⚠️ Sayısal sütunlar SAĞA yaslanır ve `rakam` sınıfı taşır; virgüller
 *    hizalanmazsa yüzlerce satırlık ledger okunamaz hale gelir. Para hücresinde
 *    `<Fiyat>` bileşeni kullanılır — o sınıfı kendi taşır, unutulamaz.
 */
export function Table({
  className,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement>): React.ReactElement {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full border-collapse text-sm', className)} {...props} />
    </div>
  );
}

export function THead(props: React.HTMLAttributes<HTMLTableSectionElement>): React.ReactElement {
  return <thead className="border-b border-kenar text-metin-soluk" {...props} />;
}

export function TBody(props: React.HTMLAttributes<HTMLTableSectionElement>): React.ReactElement {
  return <tbody {...props} />;
}

export function TR({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement>): React.ReactElement {
  // 36px satır yüksekliği — Linear kalıbı: az öğeyi rahat gösterir.
  return <tr className={cn('h-9 border-b border-kenar/60', className)} {...props} />;
}

export function TH({
  className,
  sayisal,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { sayisal?: boolean }): React.ReactElement {
  return (
    <th
      className={cn('px-3 text-left font-medium', sayisal && 'text-right', className)}
      {...props}
    />
  );
}

export function TD({
  className,
  sayisal,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { sayisal?: boolean }): React.ReactElement {
  return <td className={cn('px-3', sayisal && 'rakam text-right', className)} {...props} />;
}
