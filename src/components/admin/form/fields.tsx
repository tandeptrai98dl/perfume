'use client';

import type { ComponentProps, ReactNode } from 'react';
import { useFormContext, type FieldValues, type Path } from 'react-hook-form';

import { Checkbox } from '@/components/ui/checkbox';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/*
 * Thin React Hook Form field wrappers on top of the FormField primitives: real labels,
 * hints and errors wired with aria-describedby / aria-invalid.
 */

type Base<T extends FieldValues> = {
  name: Path<T>;
  label: ReactNode;
  description?: ReactNode;
  className?: string;
  disabled?: boolean;
};

export function TextField<T extends FieldValues>({
  name,
  label,
  description,
  className,
  disabled,
  ...input
}: Base<T> & Omit<ComponentProps<typeof Input>, 'name' | 'value' | 'onChange'>) {
  const form = useFormContext<T>();
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              {...input}
              {...field}
              disabled={disabled}
              value={(field.value as string | null | undefined) ?? ''}
            />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/** Integer input: empty → null; the value in the form is a number. */
export function NumberField<T extends FieldValues>({
  name,
  label,
  description,
  className,
  disabled,
  nullable = true,
  ...input
}: Base<T> & { nullable?: boolean } & Omit<
    ComponentProps<typeof Input>,
    'name' | 'value' | 'onChange' | 'type'
  >) {
  const form = useFormContext<T>();
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              {...input}
              name={field.name}
              ref={field.ref}
              onBlur={field.onBlur}
              type="number"
              inputMode="numeric"
              step={1}
              disabled={disabled}
              value={field.value === null || field.value === undefined ? '' : String(field.value)}
              onChange={(event) => {
                const raw = event.target.value;
                field.onChange(raw === '' ? (nullable ? null : 0) : Number(raw));
              }}
              className="tabular-nums"
            />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function TextareaField<T extends FieldValues>({
  name,
  label,
  description,
  className,
  disabled,
  ...input
}: Base<T> & Omit<ComponentProps<typeof Textarea>, 'name' | 'value' | 'onChange'>) {
  const form = useFormContext<T>();
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Textarea
              {...input}
              {...field}
              disabled={disabled}
              value={(field.value as string | null | undefined) ?? ''}
            />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function SwitchField<T extends FieldValues>({
  name,
  label,
  description,
  className,
  disabled,
}: Base<T>) {
  const form = useFormContext<T>();
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className={cn('flex-row flex-wrap items-center gap-3', className)}>
          <FormControl>
            <Switch
              checked={!!field.value}
              onCheckedChange={field.onChange}
              onBlur={field.onBlur}
              ref={field.ref}
              disabled={disabled}
            />
          </FormControl>
          <FormLabel className="cursor-pointer">{label}</FormLabel>
          {description && <FormDescription className="basis-full">{description}</FormDescription>}
          <FormMessage className="basis-full" />
        </FormItem>
      )}
    />
  );
}

const NONE = '__none__';

export function SelectField<T extends FieldValues>({
  name,
  label,
  description,
  className,
  disabled,
  options,
  placeholder,
  noneLabel,
  numeric = false,
}: Base<T> & {
  options: { value: string; label: string }[];
  placeholder?: string;
  /** Adds an empty choice mapped to `null`. */
  noneLabel?: string;
  /** The form value is a number (option values are its string form). */
  numeric?: boolean;
}) {
  const form = useFormContext<T>();
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>{label}</FormLabel>
          <Select
            value={
              field.value === null || field.value === undefined
                ? noneLabel
                  ? NONE
                  : ''
                : String(field.value)
            }
            onValueChange={(value) =>
              field.onChange(value === NONE ? null : numeric ? Number(value) : value)
            }
            disabled={disabled}
          >
            <FormControl>
              <SelectTrigger ref={field.ref} onBlur={field.onBlur}>
                <SelectValue placeholder={placeholder} />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {noneLabel && <SelectItem value={NONE}>{noneLabel}</SelectItem>}
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/** Multi-choice checkboxes stored as a string array. */
export function CheckboxGroupField<T extends FieldValues>({
  name,
  label,
  options,
  className,
  disabled,
}: Base<T> & { options: { value: string; label: string; indent?: boolean }[] }) {
  const form = useFormContext<T>();
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => {
        const values = (field.value as string[] | undefined) ?? [];
        return (
          <FormItem className={className}>
            <fieldset className="flex flex-col gap-2">
              <legend className="text-small mb-2 font-medium">{label}</legend>
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                {options.map((option) => {
                  const id = `${field.name}-${option.value}`;
                  return (
                    <label
                      key={option.value}
                      htmlFor={id}
                      className={cn(
                        'text-small flex min-h-10 items-center gap-2',
                        option.indent && 'pl-6',
                      )}
                    >
                      <Checkbox
                        id={id}
                        disabled={disabled}
                        checked={values.includes(option.value)}
                        onCheckedChange={(checked) =>
                          field.onChange(
                            checked
                              ? [...values, option.value]
                              : values.filter((value) => value !== option.value),
                          )
                        }
                      />
                      {option.label}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}
