'use client';

import { Heart } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { setWishlistedAction } from '@/actions/wishlist';
import { IconButton } from '@/components/ui/icon-button';
import { getPathname, useRouter } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { cn } from '@/lib/utils';

import { markWishlisted, useWishlist } from './wishlist-store';

/**
 * Wishlist heart on ProductCard and the product page (§8.3). Members toggle it in place
 * (optimistic, confirmed by the layout seed); guests are sent to sign-in and come back to the
 * product (`?next=`).
 */
export function WishlistButton({
  productId,
  productName,
  productSlug,
  variant = 'ghost',
  className,
}: {
  productId: string;
  productName: string;
  /** Slug in the current locale: the page guests return to after signing in. */
  productSlug: string;
  variant?: 'ghost' | 'outline';
  className?: string;
}) {
  const t = useTranslations('wishlist');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const wishlist = useWishlist();
  const [pending, startTransition] = useTransition();
  const active = wishlist.ids.has(productId);

  function toggle() {
    if (!wishlist.signedIn) {
      const next = getPathname({
        locale,
        href: { pathname: '/products/[slug]', params: { slug: productSlug } },
      });
      router.push({ pathname: '/sign-in', query: { next } });
      return;
    }
    const target = !active;
    markWishlisted(productId, target);
    startTransition(async () => {
      const result = await setWishlistedAction({ productId, wishlisted: target });
      if (result.ok) {
        toast.success(t(target ? 'added' : 'removed', { name: productName }));
        return;
      }
      markWishlisted(productId, !target);
      if (result.error === 'unauthorized') {
        router.refresh();
        return;
      }
      toast.error(t(`errors.${result.error === 'wishlistFull' ? 'full' : 'generic'}`));
    });
  }

  return (
    <IconButton
      variant={variant}
      aria-label={t(wishlist.signedIn ? 'toggle' : 'signInToSave', { name: productName })}
      aria-pressed={wishlist.signedIn ? active : undefined}
      disabled={pending || !wishlist.ready}
      onClick={toggle}
      data-testid="wishlist-toggle"
      data-state={active ? 'on' : 'off'}
      className={cn('bg-ivory-50/80 hover:bg-ivory-50', className)}
    >
      <Heart aria-hidden className={cn(active && 'text-gold-700 fill-current')} />
    </IconButton>
  );
}
