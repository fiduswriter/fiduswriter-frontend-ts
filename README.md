<p align="center">
  <img src="https://codeberg.org/fiduswriter/fiduswriter-frontend-ts/raw/branch/main/logo.svg" alt="@fiduswriter/frontend" width="100" height="100">
</p>

<h1 align="center">@fiduswriter/frontend</h1>

<p align="center">Fidus Writer SPA shell — page chrome, routing, and UI modules shared between the editor and bibliography manager</p>

---

## Architecture

`@fiduswriter/frontend` is the **browser-side shell** of the Fidus Writer
single-page application. It contains the client-side router, page definitions,
shared UI chrome, and document management workflows that were previously
embedded in the main Django application.

The package is **backend-agnostic**: every interaction with the server happens
through injectable `ApiConnectors` interfaces. Consumers (such as the Django
main app or a future custom backend) supply concrete API implementations when
bootstrapping the `App` router. This decouples the UI layer from any particular
backend technology.

### Dependency relationships

```
┌──────────────┐    ┌────────────────────┐
│  fwtoolkit   │    │ @fiduswriter/      │
│ (UI toolkit) │    │ document           │
└──────┬───────┘    └─────────┬──────────┘
       │                      │
       └──────────┬───────────┘
                  ▼
┌─────────────────────────────────────┐
│ @fiduswriter/frontend  (this package)│
│  SPA shell + shared UI modules      │
└──────────────┬──────────────────────┘
               │
       ┌───────┴────────┐
       ▼                ▼
┌────────────┐  ┌────────────────────────┐
│ @fiduswriter│  │ @fiduswriter/          │
│ /editor     │  │ bibliography-manager   │
└────────────┘  └────────────────────────┘
```

## Exports

All modules are available from the main barrel (`@fiduswriter/frontend`) or as
tree-shakeable subpath imports.

### Page chrome

Shared UI elements that wrap every Fidus Writer page.

| Export | Description |
|--------|-------------|
| `baseBodyTemplate` | Base HTML body template with common meta tags and CSS |
| `FeedbackTab` | Feedback and support sidebar tab |
| `SiteMenu` | Top-level site navigation menu with plugin registry |

### SPA shell

The application bootstrap layer — routing, offline storage, and pre-authentication support.

| Export | Description |
|--------|-------------|
| `App` | Client-side SPA router. Accepts injectable `ApiConnectors` and `AppPluginOptions`. |
| `IndexedDB` | Offline IndexedDB cache wrapper. Accepts an injectable database name. |
| `PreloginPage` | Base class for pre-authentication pages. |
| `basePreloginTemplate` | HTML template for the pre-login shell. |

### Pages

Standalone pages that can be mounted by the router.

| Export | Description |
|--------|-------------|
| `Page404` | 404 error page |
| `OfflinePage` | Offline / disconnected page |
| `SetupPage` | Setup / update page |
| `FlatPage` | CMS flat page — fetches content from the backend |

### Documents

Document listing, import, and revision management.

| Export | Description |
|--------|-------------|
| `DocumentOverview` | Document list and management overview |
| `DocumentOverviewActions` | Document CRUD operations (copy, delete, export, download) |
| `getMissingDocumentListData` | Fetches supplementary document list data from the backend |
| `DocumentRevisionsDialog` | Revision history browser dialog |
| `importerRegistry` | Registry for document importers |
| `FidusFileImporter`, `NativeImporter` | Native `.fidus` file import |
| `createNativeImporterBackend` | Creates a backend for native import |
| `DocxImporter` | DOCX import |
| `OdtImporter` | ODT import |
| `PandocImporter` | Pandoc-based import |

### User — Auth

Authentication, registration, and two-factor flows.

| Export | Description |
|--------|-------------|
| `LoginPage` | Login page (password, social auth, 2FA) |
| `Signup` | Registration page |
| `PasswordResetRequest` | Password reset request page |
| `PasswordResetChangePassword` | Password reset — new password entry |
| `EmailConfirm` | Email confirmation page |
| `twoFactorSetupDialog` | 2FA setup dialog |
| `twoFactorDisableDialog` | 2FA disable dialog |
| `twoFactorLoginDialog` | 2FA login dialog |
| `checkTwoFactorStatus` | Check 2FA status helper |

### User — Profile & contacts

| Export | Description |
|--------|-------------|
| `Profile` | User profile page (emails, avatar, password, E2EE, social accounts) |
| `DeleteUserDialog` | Account deletion dialog |
| `ContactsOverview` | Contact management page |
| `ContactInvite` | Invite response handler |

### Document templates

| Export | Description |
|--------|-------------|
| `DocTemplatesOverview` | Document template list |
| `DocTemplatesEditor` | Document template editor |

### Maintenance & admin

| Export | Description |
|--------|-------------|
| `DocMaintenance` | Batch document upgrade tool |
| `AdminConsole` | System message administration panel |
| `ErrorHook` | Client-side error logging hook |

### Workers

| Export | Description |
|--------|-------------|
| `AdjustDocToTemplateWorker` | Web Worker for adjusting documents to templates |

### Utility

| Export | Description |
|--------|-------------|
| `filterPrimaryEmail` | Extract the primary email address from a user emails array |

### API connectors (types)

The `ApiConnectors` interface and its member interfaces define the contract
between the UI and the backend. Consumers inject concrete implementations at
boot time.

| Interface | Purpose |
|-----------|---------|
| `ApiConnectors` | Top-level bag of all API connectors |
| `ConfigApi` | Server configuration and feature flags |
| `DocumentListApi` | Document listing, creation, and deletion |
| `DocumentImportApi` | Document import upload and processing |
| `UserProfileApi` | User profile CRUD |
| `AuthApi` | Authentication, registration, password reset |
| `ContactsApi` | Contact management |
| `DocumentTemplateApi` | Document template operations |
| `FlatPageApi` | CMS flat page content |
| `SystemMessageApi` | Admin system messages |
| `ErrorHookApi` | Client-side error reporting |
| `MaintenanceApi` | Batch document maintenance |
| `RevisionApi` | Document revision history |

### Other types

| Type | Description |
|------|-------------|
| `AppInterface` | Router interface |
| `AppPluginOptions` | Plugin configuration passed to `App` |
| `BaseBodyTemplateOptions` | Options for `baseBodyTemplate` |
| `Email` | User email shape |
| `MenuPlugin` / `MenuPlugins` / `MenuPluginExport` | Site menu plugin types |
| `NavItem` | Navigation item descriptor |
| `Route` / `RouteMap` | Routing table types |
| `Settings` | Application settings shape |
| `SiteMenuLike` | Site menu interface |
| `User` | User model shape |
| `PreloginApp` | Pre-authentication app interface |

## Installation

```bash
npm install @fiduswriter/frontend
```

## Usage

### Barrel imports (common subsets)

```ts
// Page chrome
import {baseBodyTemplate, FeedbackTab, SiteMenu} from "@fiduswriter/frontend"

// SPA bootstrap
import {App, IndexedDB, PreloginPage, basePreloginTemplate} from "@fiduswriter/frontend"

// Documents
import {DocumentOverview, DocumentOverviewActions, DocumentRevisionsDialog} from "@fiduswriter/frontend"

// User & auth
import {LoginPage, Signup, Profile, ContactsOverview} from "@fiduswriter/frontend"
```

### Tree-shakeable subpath imports

```ts
// Import only what you need
import {baseBodyTemplate} from "@fiduswriter/frontend/common"
import {FeedbackTab} from "@fiduswriter/frontend/feedback"
import {SiteMenu} from "@fiduswriter/frontend/menu"

// Document importers
import {DocxImporter} from "@fiduswriter/frontend/documents/importer/docx"
import {OdtImporter} from "@fiduswriter/frontend/documents/importer/odt"
import {PandocImporter} from "@fiduswriter/frontend/documents/importer/pandoc"

// Auth
import {LoginPage} from "@fiduswriter/frontend/user/auth/login"
import {Signup} from "@fiduswriter/frontend/user/auth/signup"

// Templates
import {DocTemplatesOverview, DocTemplatesEditor} from "@fiduswriter/frontend/document_templates"
```

### Bootstrapping the SPA

```ts
import {App} from "@fiduswriter/frontend"
import type {ApiConnectors, AppPluginOptions} from "@fiduswriter/frontend"

const api: ApiConnectors = {
  config: new MyConfigApi(),
  documentList: new MyDocumentListApi(),
  auth: new MyAuthApi(),
  // ... remaining connectors
}

const plugins: AppPluginOptions = {
  // Plugin overrides for the current deployment
}

const app = new App(api, plugins)
await app.init()
```

## Development

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript to dist/
npm run typecheck    # Check types without emitting
npm run lint         # Lint with ESLint
npm run format:check # Check formatting with Prettier
npm test             # Run Jest test suite
```

## License

AGPL-3.0 — see [LICENSE](LICENSE) for details.
