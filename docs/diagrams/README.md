# Codebase Diagrams

Mermaid diagrams auto-generated from the `src/app/**` router tree on 2026-04-14.

## How to view

All four options render the Mermaid code blocks inside the `.md` files below — pick whichever fits your workflow:

1. **GitHub (easiest)** — push to the remote and open any file here. GitHub renders ```` ```mermaid ```` blocks natively, including pan/zoom on large diagrams. No setup required.
2. **VS Code** — install the `Markdown Preview Mermaid Support` extension (bierner.markdown-mermaid), then open a file and press `⇧⌘V` for the preview pane. Updates live as you edit.
3. **Mermaid Live Editor** — copy any diagram block to <https://mermaid.live>. Best for quick tweaks, theming, and exporting PNG/SVG.
4. **Local CLI export** — `npx @mermaid-js/mermaid-cli -i 01-pages-nav.md -o out.svg` to get a standalone SVG/PDF (useful for wiki pages or slide decks).

## The diagrams

| File | What it shows | Best for |
|---|---|---|
| [01-pages-nav.md](01-pages-nav.md) | All 20 pages and how the sidebar/nav connects them | Onboarding, "where do I go to do X" |
| [02-api-surface.md](02-api-surface.md) | All 264 API routes grouped by feature area | Backend overview, finding endpoints |
| [03-page-to-api.md](03-page-to-api.md) | Which pages/components call which API routes | Impact analysis, "who uses this endpoint" |
| [04-feature-map.md](04-feature-map.md) | High-level feature areas with page + route counts | Architecture conversations, planning |
| [05-module-graph.md](05-module-graph.md) | **Auto-generated** import graph from `src/**` (dependency-cruiser) | Impact analysis, spotting tangles |
| [06-order-lifecycle.md](06-order-lifecycle.md) | Order state machine + ingestion sources | Debugging stuck orders, onboarding |
| [07-fba-shipment-flow.md](07-fba-shipment-flow.md) | FBA item/shipment state machines + create/close/mark-shipped sequences | FBA bug hunts, staff-tracking questions |
| [08-physical-pipeline.md](08-physical-pipeline.md) | Receiving → Tech → Packing → Shipped end-to-end sequence + branches | Warehouse ops, QA flow |
| [09-ai-chat-flow.md](09-ai-chat-flow.md) | Hermes gateway integration — local-ops vs RAG vs LLM resolution | AI feature work, prompt-cache debugging |
| [10-qstash-cron.md](10-qstash-cron.md) | All 10 scheduled jobs with timings, tables touched, bootstrap flow | Sync failures, adding new crons |
| [11-er-diagram.md](11-er-diagram.md) | ER diagram of the core business tables from Drizzle schema | Schema changes, FK planning |
| [12-tech-station-trace.md](12-tech-station-trace.md) | Tech scan hub, FNSKU/tracking/SKU paths, serial CRUD, cascade delete | Tech UI work, log/data-integrity debugging |
| [13-packer-station-trace.md](13-packer-station-trace.md) | Packer scan dispatch, order + FBA + exception paths, photo flow | Packer station issues, missing-order diagnosis |
| [14-fba-station-trace.md](14-fba-station-trace.md) | FBA item state machine + which endpoint drives each transition, split-for-paired-review | FBA flow bugs, staff-attribution questions |

## Regenerating

- **01–04 (hand-curated):** refresh after big route changes by re-running the route/API exploration and replacing the relevant sections.
- **05 (mechanical):** run `npm run diagrams` — it rewrites `05-module-graph.mmd` from the current `src/**` imports. Also available:
  - `npm run diagrams:html` → interactive clickable report
  - `npm run diagrams:archi` → high-level folder-to-folder (DOT)
  - `npm run diagrams:check` → lint rules (circular deps, orphans) — good for CI
