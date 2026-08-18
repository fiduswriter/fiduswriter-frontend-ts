# AGENTS.md — @fiduswriter/frontend

## Project overview

`@fiduswriter/frontend` is a JavaScript/TypeScript library that holds Fidus
Writer-specific utilities and UI chrome that are reused between the standalone
Fidus Writer applications (editor, bibliography manager) but are not generic
enough to live in `fwtoolkit`.

- Package name: `@fiduswriter/frontend`
- License: `AGPL-3.0`
- Repository: `https://git.fiduswriter.org/fiduswriter/fiduswriter-frontend-ts.git`
- Author: Johannes Wilm

## Scope

Code in this repository should be limited to:

- Shared page chrome (`src/common/`): `baseBodyTemplate`, `filterPrimaryEmail`.
- The tech-support feedback tab (`src/feedback/`): `FeedbackTab`.
- The top-level site navigation (`src/menu/`): `SiteMenu`.

Do **not** put in this repository:

- Generic UI primitives (those belong in `fwtoolkit`).
- The main SPA router (`App` in the Django `base` app).
- Application-specific logic that belongs in `@fiduswriter/editor` or
  `@fiduswriter/bibliography-manager`.

## Technology stack

- **Language:** TypeScript 6.0+.
- **Module system:** ESM (`"type": "module"`).
- **Build tool:** `tsc` only; no bundler is used.

## Directory layout

```
.
├── src/                  # Source files
│   ├── index.ts          # Public barrel export
│   ├── common/           # Shared page templates and utilities
│   ├── feedback/         # Feedback tab component
│   ├── menu/             # Site navigation component
│   ├── plugins/          # Menu plugin registry
│   └── state_plugins/    # ProseMirror state plugins and node views
├── dist/                 # Compiled JS, .d.ts and source maps (generated)
├── package.json
├── tsconfig.json
└── README.md
```

## Build commands

```bash
npm install
npm run build
npm run typecheck
```

## Consumers

- `@fiduswriter/editor`
- `@fiduswriter/bibliography-manager`

## Notes

- The `bibliojson` dependency used by `@fiduswriter/bibliography-manager` was
  previously published as `biblatex-csl-converter`. This package does not depend
  on it directly.
