import { CheckoutLayout } from '@/components/layout/checkout-layout';

/** Checkout routes: minimal header, no navigation (§8.2). */
export default function CheckoutGroupLayout({ children }: { children: React.ReactNode }) {
  return <CheckoutLayout>{children}</CheckoutLayout>;
}
