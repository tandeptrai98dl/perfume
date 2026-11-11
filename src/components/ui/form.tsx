'use client';

import { Slot } from 'radix-ui';
import { createContext, useContext, useId, type ComponentProps } from 'react';
import {
  Controller,
  FormProvider,
  useFormContext,
  useFormState,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
} from 'react-hook-form';

import { cn } from '@/lib/utils';

import { Label } from './label';

/**
 * FormField: label + control + hint + error, wired to React Hook Form (§8.1).
 *
 * <Form {...form}>
 *   <FormField control={form.control} name="phone" render={({ field }) => (
 *     <FormItem>
 *       <FormLabel>{t('phone')}</FormLabel>
 *       <FormControl><Input {...field} /></FormControl>
 *       <FormDescription>{t('phoneHint')}</FormDescription>
 *       <FormMessage />
 *     </FormItem>
 *   )} />
 * </Form>
 */
export const Form = FormProvider;

const FieldContext = createContext<{ name: string } | null>(null);
const ItemContext = createContext<{ id: string } | null>(null);

export function FormField<TValues extends FieldValues, TName extends FieldPath<TValues>>(
  props: ControllerProps<TValues, TName>,
) {
  return (
    <FieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FieldContext.Provider>
  );
}

export function useFormField() {
  const field = useContext(FieldContext);
  const item = useContext(ItemContext);
  const { getFieldState } = useFormContext();
  if (!field || !item)
    throw new Error('useFormField must be used inside <FormField> and <FormItem>');
  const formState = useFormState({ name: field.name });
  const state = getFieldState(field.name, formState);
  return {
    name: field.name,
    id: item.id,
    controlId: `${item.id}-control`,
    descriptionId: `${item.id}-description`,
    messageId: `${item.id}-message`,
    ...state,
  };
}

export function FormItem({ className, ...props }: ComponentProps<'div'>) {
  const id = useId();
  return (
    <ItemContext.Provider value={{ id }}>
      <div className={cn('flex flex-col gap-2', className)} {...props} />
    </ItemContext.Provider>
  );
}

export function FormLabel({ className, ...props }: ComponentProps<typeof Label>) {
  const { controlId, error } = useFormField();
  return (
    <Label
      htmlFor={controlId}
      data-error={!!error || undefined}
      className={cn('data-error:text-danger', className)}
      {...props}
    />
  );
}

export function FormControl(props: ComponentProps<typeof Slot.Root>) {
  const { controlId, descriptionId, messageId, error } = useFormField();
  return (
    <Slot.Root
      id={controlId}
      aria-describedby={error ? `${descriptionId} ${messageId}` : descriptionId}
      aria-invalid={!!error || undefined}
      {...props}
    />
  );
}

export function FormDescription({ className, ...props }: ComponentProps<'p'>) {
  const { descriptionId } = useFormField();
  return <p id={descriptionId} className={cn('text-small text-taupe-600', className)} {...props} />;
}

/** Shows the field's error. Pass the translated message via `children` or a translated Zod message. */
export function FormMessage({ className, children, ...props }: ComponentProps<'p'>) {
  const { error, messageId } = useFormField();
  const body = children ?? error?.message;
  if (!body) return null;
  return (
    <p id={messageId} role="alert" className={cn('text-small text-danger', className)} {...props}>
      {body}
    </p>
  );
}
