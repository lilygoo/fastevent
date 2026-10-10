# EventAlign handoff kit

This repository is a production handoff package for the EventAlign interactive prototype. The target application lets a user define a current market event and comparable historical Day 0 events, align their performance paths, annotate historical milestones, save studies, and optionally pull a current live price.

## Canonical reference

- `prototype/event_alignment_demo_v8.html` is the frozen visual and behavioral reference.
- `prototype/event_alignment_demo_v8_preview.png` is a quick visual reference.
- The prototype is self-contained: HTML, CSS, SVG charting, and JavaScript are all in one file.
- The prototype uses deterministic simulated paths and browser `localStorage`; it does not call a market-data service.

Do not replace or edit the prototype during the initial migration. Build the production implementation beside it and compare behavior against it.

## View the prototype

Open `prototype/event_alignment_demo_v8.html` directly in a browser, or serve the repository locally:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000/prototype/event_alignment_demo_v8.html
```

## Current approved behavior

The prototype includes:

- a current event and multiple editable historical events;
- optional milestones owned by each historical event;
- aligned current, historical, median, and interquartile return views;
- a dotted historical median line and matching legend treatment;
- EOD and explicitly requested latest-price modes;
- LIVE, EOD, delayed, and stale display concepts;
- a current-return callout on the chart;
- a blank New study workflow with required-field validation;
- separate `Save` and `Saved studies` actions;
- source-aware saving, loading, updating, and deletion;
- two guided tutorials under `How it works`;
- CSV export and an aligned-results table.

## Important terminology

- **Working study**: the setup currently open in the editor.
- **Saved study**: a persisted setup that can be loaded later.
- **Current source**: the saved study to which the top-bar `Save` action writes.
- **Save**: creates a source on first save, then updates that same source.
- **Saved studies**: opens the retrieval library; it does not save the current setup.

Market results and live quotes should be refreshed after loading a saved study. Do not treat a persisted quote or previous response as current data.

## Recommended target stack

- Frontend: React, TypeScript, and Vite
- Backend: Python and FastAPI
- Market data: provider interface with a mock provider first, then one approved real provider
- Persistence: browser storage during UI migration, SQLite for a local single-user version, and PostgreSQL when multi-user or deployed
- Tests: Vitest and Testing Library for frontend behavior; pytest for calculations and API contracts

The stack is a recommendation, not a requirement. Keep the backend provider-neutral so Bloomberg, Polygon, Alpaca, an internal source, or another vendor can be added without rewriting the UI.

## Repository guide

- `AGENTS.md`: shared instructions for coding agents
- `CLAUDE.md`: imports the shared agent instructions
- `PROMPT_START_HERE.md`: first prompt for a Codex or Claude Code session
- `docs/PRODUCT_SPEC.md`: current product behavior
- `docs/DATA_CONTRACT.md`: proposed frontend/backend and persistence contracts
- `docs/IMPLEMENTATION_PLAN.md`: phased migration plan
- `docs/DECISIONS.md`: approved deviations and unresolved choices
- `docs/UI_ACCEPTANCE_CHECKLIST.md`: parity checklist for the prototype migration
- `docs/PROTOTYPE_CHANGELOG.md`: feature history and intent
- `fixtures/`: sample configuration, saved-study, and calculated-response objects

## Suggested first session

1. Initialize Git and commit this package unchanged.
2. Start Codex or Claude Code from the repository root.
3. Paste the contents of `PROMPT_START_HERE.md`.
4. Review and approve only the proposed Phase 1 plan.
5. Keep each phase in a separate commit so UI, calculation, and provider regressions are easy to isolate.

Example:

```bash
git init
git add .
git commit -m "Import EventAlign v8 handoff"

codex
# or
claude
```

## Security

Never place vendor API keys, Bloomberg credentials, database passwords, or other secrets in frontend code, committed files, screenshots, or prompts. Real data access belongs behind the backend. Use environment variables and commit only an `.env.example` containing variable names, not values.