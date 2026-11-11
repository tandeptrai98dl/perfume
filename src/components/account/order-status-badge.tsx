import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import type { OrderStatus } from '@/server/modules/order';

const VARIANT: Record<OrderStatus, 'neutral' | 'outline' | 'success' | 'warning' | 'gold'> = {
  pending: 'warning',
  awaiting_confirmation: 'warning',
  confirmed: 'gold',
  processing: 'gold',
  shipped: 'gold',
  delivered: 'success',
  completed: 'success',
  cancelled: 'outline',
  delivery_failed: 'warning',
  return_requested: 'warning',
  returned: 'outline',
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const t = useTranslations('customerOrder.status');
  return <Badge variant={VARIANT[status]}>{t(status)}</Badge>;
}

const PAYMENT_VARIANT = {
  unpaid: 'outline',
  partially_paid: 'warning',
  paid: 'success',
  partially_refunded: 'outline',
  refunded: 'outline',
} as const;

export function PaymentStatusBadge({ status }: { status: keyof typeof PAYMENT_VARIANT }) {
  const t = useTranslations('customerOrder.paymentStatus');
  return <Badge variant={PAYMENT_VARIANT[status]}>{t(status)}</Badge>;
}
