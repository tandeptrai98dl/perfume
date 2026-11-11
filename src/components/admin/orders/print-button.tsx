'use client';

import { Printer } from 'lucide-react';

import { Button } from '@/components/ui/button';

/** Opens the browser print dialog (print pages have no other chrome). */
export function PrintButton({ label }: { label: string }) {
  return (
    <Button onClick={() => window.print()}>
      <Printer aria-hidden />
      {label}
    </Button>
  );
}
