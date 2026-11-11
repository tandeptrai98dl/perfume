import { foldVietnamese } from './text';

/** URL slug from a title: "Nước hoa gỗ ấm" → "nuoc-hoa-go-am" (max 120 characters). */
export function slugify(value: string): string {
  return foldVietnamese(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
    .replace(/-+$/g, '');
}
