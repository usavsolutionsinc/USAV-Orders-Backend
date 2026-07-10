# Master Connections & Refactor — Documentation Hub

> **Two layers, one story.** Staff-friendly plans explain *what* and *why* in plain language for **1-on-1 upgrades**. The technical index explains *how* and *where in the code*. Every staff plan links to its technical counterpart, and the technical index links back.

---

## Which document do I open?

| I am… | Open this |
|-------|-----------|
| **Viewing all Now vs Change in one place (browser)** | [`staff-connections-planning.html`](./staff-connections-planning.html) — color-coded planning view |
| **Running or taking a 1-on-1 staff upgrade** | [`staff/INDEX.md`](./staff/INDEX.md) — upgrade hub + topic catalog |
| **Updating a human-readable plan** | A file under [`staff/`](./staff/) — edit freely |
| **Implementing or reviewing code** | [`master-index-plan.md`](./master-index-plan.md) — technical SoT |
| **Writing a new feature plan** | Read staff plan for intent → technical index §3/§7 for constraints → update **both** layers |

```
┌─────────────────────────────────────────────────────────────┐
│  STAFF LAYER (human-readable, 1-on-1 upgrades)              │
│  staff/INDEX.md  →  01…08 topic plans                       │
│  “What happens now” vs “What needs to change”               │
└──────────────────────────┬──────────────────────────────────┘
                           │ bidirectional links
┌──────────────────────────▼──────────────────────────────────┐
│  TECHNICAL LAYER (engineers & agents)                       │
│  master-index-plan.md                                       │
│  Spines, APIs, polymorphic hubs, adapters, governance       │
└─────────────────────────────────────────────────────────────┘
```

---

## How to keep the layers in sync

1. **Change intent or priority?** Edit the **staff** plan first (now vs change, success criteria).
2. **Change implementation detail?** Edit the **technical** index (§7 matrix, link catalog, roadmap checkboxes).
3. **Always** keep the “Technical counterpart” and “Staff counterpart” links at the top of each doc accurate.
4. When a staff plan’s status moves (e.g. Now → In progress → Done), update the row in [`staff/INDEX.md`](./staff/INDEX.md).

---

## Folder map

```
docs/master-connections-and-refactor/
  README.md                 ← you are here
  master-index-plan.md      ← technical master index
  staff/
    INDEX.md                ← 1-on-1 upgrade hub & plan catalog
    00-how-to-use-these-docs.md
    01-big-picture.md
    02-inventory-and-locations.md
    03-testing-and-support-tickets.md
    04-item-journey.md
    05-external-inventory-zoho.md
    06-local-pickup.md
    07-pages-and-design.md
    08-roadmap-and-phases.md
```
