# Glasshouse

A small staff web app for greenhouse inventory. Track plant batches by bench, record planting weeks, sell or move stock, and get an automatic pick list for incoming orders. Plain HTML, CSS, and JavaScript; no build step or runtime dependencies.

## Run locally

Install Node.js 20 or newer, then run these commands in the project folder:

```sh
npm start
```

Open **http://localhost:8080**. No `npm install` is needed. Keep the terminal open while using the app. To stop it, press Ctrl+C. The server binds only to your computer; it is not a hosted staff URL. The three frontend files under `assets/` and `index.html` can also be served by any static web host.

## Plant age rules

Staff enter an ISO planting week, for example `2026-W48`. Weeks start on Monday, using the browser's local calendar. Age is the number of planting-week boundaries crossed, rather than days rounded from a specific planting date.

| Age in weeks | Category |
| --- | --- |
| 0–3 | Young |
| 4–8, inclusive | Ready |
| 9 or more | Old |

This resolves the overlap at week 4 by making it the start of Ready. Newly planted stock (week 0) is Young. Age and category are calculated, never edited independently. They refresh when the app opens, when inventory is rendered, when the tab becomes visible, and within a minute of a new Monday while open. Invalid or future planting weeks cannot be used in an automatic pick list.

## Order suggestions

1. Open **Orders** and enter a reference and one or more plant quantities.
2. Suggestions update automatically with batch IDs, bench locations, ages and quantities to take.
3. Matching requires the same plant name, variety, pot size and plant type. Different pots or varieties never substitute for one another.
4. Ready stock is selected first, oldest planting week first. Duplicate order lines are combined before stock is allocated. Ties use batch ID and location-record ID for a stable ordering.
5. Young plants are always held back. Old stock appears as an available fallback; staff must check **Allow old stock** to use it. Ready stock still comes first.
6. A shortage is shown explicitly and blocks confirmation. Exporting a suggestion does not change inventory.
7. **Confirm picking & deduct stock** recalculates against current stock, deducts the complete order, stores its pick history and records its sale total together. No partial order is silently fulfilled. Confirmed pick history captures the age and location at picking time.

Suggestions do not reserve stock. The last inventory change, including a fulfilled order, can be undone during the current session. Direct sales and partial or whole-batch moves remain available. Moves preserve the planting week.

## Prototype storage

The app starts with labeled sample inventory and saves changes to this browser's local storage. The first HTML prototype's `glasshouse.inventory.v1` key is retained so data on the **same origin** can migrate from planting dates to planting weeks while preserving quantities, IDs and activity. A different URL, browser or device has separate data. Inventory CSV exports include age and planting week; CSV is not a complete database backup.

There is no shared database, account login, live order integration, payment processing or cross-device inventory sync yet. Orders are entered by staff in the app. Another tab on the same origin triggers a fresh inventory view and stale-form check; this is not a substitute for database transactions across multiple users.

The intended next backend is Supabase, with staff authentication, greenhouse locations, products, planting batches, orders/order lines and an inventory movement ledger. Order fulfillment should become a server-side database transaction before real multi-user use. No backend keys or credentials are included in this repository.

## Project files

| File | Purpose |
| --- | --- |
| `index.html` | App shell and navigation |
| `assets/app.css` | Responsive interface |
| `assets/app.js` | Inventory, forms, orders, storage and activity |
| `assets/core.js` | Calendar ages, product matching, picking and migration rules |
| `server.mjs` | Minimal local static server |
| `tests/core.test.js` | Calendar boundaries, allocation, fulfillment and migration tests |
| `tests/ui.test.js` | Controller smoke tests for planting, moving, sales, orders, undo and reload |

## Verify changes

```sh
npm test
npm run check
```

Tests use Node's built-in test runner and need no packages. The UI smoke harness checks rendering and controller behavior; it does not replace a visual browser test. They cover weeks 0/3/4/8/9, ISO year boundaries, daylight saving transitions, oldest-ready-first allocation, old-stock opt-in, young-stock exclusion, duplicate order lines, stock shortages, immutable previews, atomic fulfillment, stale stock, repeated order IDs and saved-data migration.

This repository is the source of truth for future changes; edit these files instead of recreating the app in a chat response.
