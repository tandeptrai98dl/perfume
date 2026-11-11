import { create } from 'qrcode';

import { cn } from '@/lib/utils';

/** Quiet zone in modules around the code (ISO/IEC 18004 recommends 4). */
const MARGIN = 4;

/** SVG path of the dark modules (one `M x y h1 v1 h-1 z` square per module). */
export function qrPath(value: string): { size: number; path: string } {
  const { modules } = create(value, { errorCorrectionLevel: 'M' });
  let path = '';
  for (let row = 0; row < modules.size; row += 1) {
    for (let col = 0; col < modules.size; col += 1) {
      if (modules.get(row, col)) path += `M${col + MARGIN} ${row + MARGIN}h1v1h-1z`;
    }
  }
  return { size: modules.size + MARGIN * 2, path };
}

/**
 * VietQR / EMV payload rendered as an inline SVG on the server (no client library, no image
 * request). Always dark-on-white with a quiet zone so banking apps can scan it.
 */
export function QrCode({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const { size, path } = qrPath(value);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className={cn('text-ink-950 bg-white', className)}
    >
      <path d={path} fill="currentColor" />
    </svg>
  );
}
