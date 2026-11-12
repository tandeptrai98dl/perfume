import type { Locator, Page } from '@playwright/test';

import { expect } from './purchase';

/*
 * Keyboard-only driving for E2E (M2 exit checklist, WCAG 2.1.1): the test moves focus with
 * Tab / Shift+Tab and acts with Enter, Space and arrow keys only. Reading the DOM (which
 * element has focus, what is checked) is allowed; clicking is not.
 */

async function isFocused(target: Locator): Promise<boolean> {
  if ((await target.count()) === 0) return false;
  return target
    .first()
    .evaluate((element) => element === document.activeElement)
    .catch(() => false);
}

/** Presses Tab until `target` has focus (fails after `max` presses). */
export async function tabTo(
  page: Page,
  target: Locator,
  { max = 250, backwards = false }: { max?: number; backwards?: boolean } = {},
): Promise<void> {
  for (let presses = 0; presses <= max; presses += 1) {
    if (await isFocused(target)) return;
    await page.keyboard.press(backwards ? 'Shift+Tab' : 'Tab');
  }
  throw new Error(`Could not reach ${target} with ${backwards ? 'Shift+Tab' : 'Tab'}`);
}

/** The focused element shows a visible focus indicator (outline or ring). */
export async function expectFocusVisible(page: Page) {
  const indicator = await page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element || element === document.body) return 'none';
    const style = getComputedStyle(element);
    if (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) return 'outline';
    if (style.boxShadow && style.boxShadow !== 'none') return 'ring';
    return 'none';
  });
  expect(indicator, 'focused element has a visible focus indicator').not.toBe('none');
}

/**
 * Tab into the radio group of `radio`, then arrow keys until `radio` is checked. Options may
 * be disabled for a moment while the checkout re-quotes; wait for them and re-enter the group
 * if a re-render moved focus away.
 */
export async function chooseRadio(page: Page, radio: Locator) {
  const group = radio.locator('xpath=ancestor::*[@role="radiogroup"][1]');
  const focusInGroup = () =>
    group.evaluate((element) => element.contains(document.activeElement)).catch(() => false);
  await expect(radio).toBeEnabled();
  await expect(async () => {
    if (await radio.isChecked()) return;
    for (let presses = 0; presses <= 250 && !(await focusInGroup()); presses += 1) {
      await page.keyboard.press('Tab');
    }
    await page.keyboard.press('ArrowDown');
    await expect(radio).toBeChecked({ timeout: 750 });
  }).toPass({ timeout: 20_000 });
}

/** Space toggles a checkbox that has focus. */
export async function tick(page: Page, checkbox: Locator) {
  await tabTo(page, checkbox);
  await page.keyboard.press('Space');
  await expect(checkbox).toBeChecked();
}

/** Types into a text field reached with Tab. */
export async function typeInto(page: Page, field: Locator, text: string) {
  await tabTo(page, field);
  await page.keyboard.type(text);
  await expect(field).toHaveValue(text);
}

/**
 * Combobox (province / ward): Enter opens it, typing filters, arrow keys move the active
 * option (`aria-selected`), Enter picks it.
 */
export async function pickOption(page: Page, combobox: Locator, search: string, option: string) {
  await expect(combobox).toBeEnabled();
  await tabTo(page, combobox);
  await page.keyboard.press('Enter');
  await page.keyboard.type(search);
  const target = page.getByRole('option', { name: option, exact: true });
  await expect(target).toBeVisible();
  await moveToOption(page, target);
  await page.keyboard.press('Enter');
  await expect(combobox).toHaveText(option);
}

/** ArrowDown until `option` is the active (aria-selected) option of a listbox. */
export async function moveToOption(page: Page, option: Locator, max = 15) {
  for (let presses = 0; presses <= max; presses += 1) {
    if ((await option.getAttribute('aria-selected')) === 'true') return;
    await page.keyboard.press('ArrowDown');
  }
  await expect(option).toHaveAttribute('aria-selected', 'true');
}
