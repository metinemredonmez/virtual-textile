import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn kalıbı: koşullu sınıflar + çakışan Tailwind sınıflarını sonuncu kazanır. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
