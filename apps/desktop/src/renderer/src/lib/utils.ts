import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * shadcn/ui's standard class-merging helper: clsx handles conditional
 * classes, tailwind-merge resolves conflicts when the same utility is
 * specified twice (e.g. a caller's `className` overriding a default).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
