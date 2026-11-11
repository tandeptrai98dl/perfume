import { useFormatter } from 'next-intl';

/** VND money and Vietnam-time dates for admin order screens (server and client components). */
export function useOrderFormat() {
  const format = useFormatter();
  return {
    vnd: (amount: number) =>
      format.number(amount, { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }),
    dateTime: (value: Date | string) =>
      format.dateTime(new Date(value), { dateStyle: 'short', timeStyle: 'short' }),
    date: (value: Date | string) => format.dateTime(new Date(value), { dateStyle: 'short' }),
  };
}
