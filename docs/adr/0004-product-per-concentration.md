# ADR-0004: One product per concentration, grouped by product lines

- Status: Accepted
- Date: 2026-11-11
- Decision ID: D04

## Context

A scent (e.g. Bleu de Chanel) exists in several concentrations (EDT, EDP, Parfum), each with several sizes. Concentrations differ in formula, notes, longevity, reviews and search demand.

## Decision

Model each concentration as its own `products` row. `product_variants` represent sizes/types (full size, travel, tester, gift set; decant reserved — ADR-0015) and hold price, stock, SKU and barcode. Concentrations of the same scent are linked through `product_lines` so the PDP can offer a concentration switcher.

## Consequences

- Each concentration gets its own URL, reviews and SEO metadata.
- Product-line switcher component on the PDP (`ProductLineSwitcher`).
- Admin manages product lines as a catalogue entity.

See also: [ARCHITECTURE.md](../ARCHITECTURE.md), section 0.
