import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import type { OrderStatus, PaymentStatus } from '@/server/modules/order';

type Tone = 'neutral' | 'outline' | 'gold' | 'success' | 'warning' | 'dark';

/** Statuses waiting on staff stand out (gold/warning); finished ones are quiet. */
const ORDER_TONES: Record<OrderStatus, Tone> = {
  pending: 'outline',
  awaiting_confirmation: 'gold',
  confirmed: 'gold',
  processing: 'gold',
  shipped: 'dark',
  delivered: 'success',
  completed: 'success',
  cancelled: 'neutral',
  delivery_failed: 'warning',
  return_requested: 'warning',
  returned: 'neutral',
};

const PAYMENT_TONES: Record<PaymentStatus, Tone> = {
  unpaid: 'outline',
  partially_paid: 'gold',
  paid: 'success',
  partially_refunded: 'warning',
  refunded: 'neutral',
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const t = useTranslations('admin.orders.status');
  return (
    <Badge variant={ORDER_TONES[status]} data-order-status={status}>
      {t(status)}
    </Badge>
  );
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const t = useTranslations('admin.orders.paymentStatus');
  return (
    <Badge variant={PAYMENT_TONES[status]} data-payment-status={status}>
      {t(status)}
    </Badge>
  );
}
