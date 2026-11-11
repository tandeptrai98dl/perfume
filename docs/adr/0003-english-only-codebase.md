# ADR-0003: English-only codebase and project artefacts

- Status: Accepted
- Date: 2026-11-11
- Decision ID: D03

## Context

The project will be built largely with Claude Code and may involve non-Vietnamese contributors. Mixed-language code is harder to search, review and prompt.

## Decision

Everything in the repository is written in English: file and folder names, route folders, identifiers, database tables/columns/enums, comments, commit messages, PR descriptions, documentation, `CLAUDE.md`, and every prompt given to Claude Code. Vietnamese appears only as user-facing content: `messages/vi.json`, database content, and localized URL pathnames declared in `src/i18n/routing.ts`.

## Consequences

- Route folders are English (`perfumes/`) while Vietnamese URLs (`/nuoc-hoa`) come from next-intl pathname mapping.
- An ESLint rule bans literal user-facing text in storefront JSX.
- Reviewers reject non-English identifiers or comments.

See also: [ARCHITECTURE.md](../ARCHITECTURE.md), section 0.
