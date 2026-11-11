import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

type StateProps = {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
};

/** Empty cart, no search results (§8.1). Copy comes from the caller's translations. */
export function EmptyState({ title, description, icon, action, className }: StateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-4 px-6 py-16 text-center', className)}>
      {icon && <div className="text-gold-500 [&_svg]:size-8">{icon}</div>}
      <h2 className="text-h2">{title}</h2>
      {description && <p className="max-w-md text-taupe-600">{description}</p>}
      {action}
    </div>
  );
}

/** Load errors: announced to screen readers. */
export function ErrorState({ title, description, icon, action, className }: StateProps) {
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center gap-4 px-6 py-16 text-center', className)}
    >
      {icon && <div className="text-danger [&_svg]:size-8">{icon}</div>}
      <h2 className="text-h2">{title}</h2>
      {description && <p className="max-w-md text-taupe-600">{description}</p>}
      {action}
    </div>
  );
}
