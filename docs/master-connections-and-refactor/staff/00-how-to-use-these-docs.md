# 00 — How to use these docs

> **Status:** Living  
> **Staff hub:** [INDEX.md](./INDEX.md)  
> **Technical counterpart:** [../master-index-plan.md](../master-index-plan.md) · [../README.md](../README.md)

---

## What this folder is

A **staff-friendly** set of living plans for **1-on-1 upgrades** — one person, one topic (or a short sequence), comparing now vs change and practicing the new flow.  
They sit next to a **technical master index** that engineers use for implementation.

You should never have to choose one or the other — they are **linked master–detail**:

- **Staff plan** = the story (now vs change, success criteria).
- **Technical index** = the blueprint (tables, APIs, reuse rules).

---

## Who edits what

| Role | Edit staff plans? | Edit technical index? |
|------|-------------------|------------------------|
| Ops / product / leads | Yes — status, wording, priorities | Comment / request only |
| Engineers | Yes — keep “Now” accurate after ship | Yes — required |
| Agents / PRs | Update both when behavior changes | Update §7 matrix + catalog |

---

## Standard shape of every staff plan

1. **Why it matters** — one short paragraph  
2. **What’s happening now** — honest current operator experience  
3. **What needs to change** — destination experience  
4. **Side-by-side comparison** — table  
5. **Done looks like** — checklist to confirm in a 1-on-1  
6. **Links** — staff siblings + technical sections  

When you update a plan, also bump **Last updated** and the status row on [INDEX.md](./INDEX.md).

---

## Two words that must not get mixed up

| Word | Means in Cycle Forge |
|------|----------------------|
| **Item Journey** | The story of a serial: receive → test → bin → pick → pack → ship → tickets |
| **Drift** | A **stock count mismatch** (system qty vs ledger) — an alert, not a timeline |

If someone says “drift history of a serial,” they mean **Item Journey**. Correct gently and update docs if the wrong word slipped in.

---

## Running a 1-on-1 upgrade

1. Open [INDEX.md](./INDEX.md) and pick **one** topic for that person (role-based order is fine).  
2. Walk the **comparison table** (Now | Change) together.  
3. Do the **practice together** steps on a real (or safe) serial/ticket.  
4. If they ask “how will engineering build that?”, open the **Technical counterpart** link — don’t improvise APIs in the session.

---

## Adding a new staff plan

1. Copy an existing `0x-*.md` and keep the same sections.  
2. Add a row to the catalog in [INDEX.md](./INDEX.md).  
3. Add a matching row/section pointer in the technical index “Staff layer” section.  
4. Link related staff plans to each other (siblings).
