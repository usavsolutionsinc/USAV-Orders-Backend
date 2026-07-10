# 02 — Inventory & locations (room, rack, bin)

> **Status:** Planned  
> **Last updated:** 2026-07-10  
> **Staff hub:** [INDEX.md](./INDEX.md)  
> **Technical counterpart:** [Pain: Inventory location](../master-index-plan.md#22-pain-points-domain-gaps-this-index-solves) · [§4.2 Location hierarchy](../master-index-plan.md#42-location-hierarchy-prescriptive)  
> **Related staff plans:** [04 Item Journey](./04-item-journey.md) · [07 Pages](./07-pages-and-design.md) · [08 Roadmap](./08-roadmap-and-phases.md)

---

## Why it matters

Operators need to know **exactly where a unit sits** after receive, after test, and after pack — and to see **every move** later when something is missing or disputed. Partial location data creates “I think it’s in Room A” tribal knowledge.

---

## What’s happening now

- **Rooms and bins exist** and are scannable; the warehouse map and bin tools work for day-to-day put/take.
- **Racks** are mostly encoded in barcode labels, not shown as a clear “rack” object in the product story.
- A unit’s “current location” is sometimes a **text label**, not a reliable click-through to the bin page.
- Movement history exists in the event log, but staff don’t always see a clean “moved from → to” story next to the unit.
- After testing and after packing, placement rules exist in pieces — not one obvious placement chapter in the unit’s story.

---

## What needs to change

- Make the physical story obvious: **Room → Rack (label) → Bin**, with roles (pick face, staging, quarantine, etc.).
- Every meaningful move writes a clear history hop (from bin → to bin) on the **Item Journey**.
- After test pass and after pack, placement is a first-class step operators can trust and audit.
- Clicking a location always opens the same bin detail experience.

---

## Side-by-side

| Topic | Now | Change |
|-------|-----|--------|
| Hierarchy | Room + bin; rack in the barcode | Same physical model, clearer labels & UI story |
| Current place | Often text / hard to deep-link | Reliable link to the bin |
| History | Events exist; unevenly shown | Always visible on the unit journey |
| After test / pack | Policy scattered | Explicit putaway / staging steps in the journey |
| Multi-warehouse | Prepared in data, not fully lived | Stamp warehouse consistently as we grow |

---

## Done looks like

- [ ] Ask any serial: “Which room and bin?” — answer in one click.
- [ ] Ask: “Where was it yesterday?” — journey shows moves with bins.
- [ ] New hires learn Room → Rack → Bin from this doc + a 1-on-1 practice session, not tribal knowledge.
- [ ] Missing-unit hunts start from journey + bin map, not Slack archaeology.

---

## Practice together (1-on-1)

1. Receive and put away a unit → journey shows PUTAWAY with bin.  
2. Move bin-to-bin → journey shows MOVED from → to.  
3. Open inventory bin page from the journey chip — same bin, same contents.
