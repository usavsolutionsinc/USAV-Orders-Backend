#!/usr/bin/env bash
# SoT-guard — PreToolUse hook for Edit|Write|MultiEdit.
#
# Blocks NEWLY-WRITTEN violations of the repo's source-of-truth invariants
# (see .claude/rules/source-of-truth.md + backend-patterns.md). It inspects
# ONLY the inserted text (new_string / content), never the file on disk, so
# pre-existing tech debt is never flagged — it only catches what's being added
# right now. Exit 2 → the edit is blocked and the message is fed back to Claude
# so it self-corrects.
#
# Three deterministic, near-zero-false-positive rules. Fuzzy rules (inline
# grade→label maps, hardcoded hex, SKU-string joins) deliberately stay with the
# review agents / `audit` skill — a hook that cries wolf gets turned off.

set -euo pipefail

INPUT="$(cat)"
FP="$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty')"

# Only guard TypeScript sources under the app.
case "$FP" in
  *.ts|*.tsx) ;;
  *) exit 0 ;;
esac
case "$FP" in
  */src/*) ;;
  *) exit 0 ;;
esac

# All inserted text across Write (.content), Edit (.new_string), and
# MultiEdit (.edits[].new_string), joined into one blob.
ADDED="$(printf '%s' "$INPUT" | jq -r '
  [ .tool_input.content,
    .tool_input.new_string,
    ((.tool_input.edits // []) | map(.new_string) | join("\n"))
  ] | map(select(. != null and . != "")) | join("\n")
')"
[ -z "$ADDED" ] && exit 0

VIOLATIONS=""

# ── Rule 1: audit only via recordAudit() ────────────────────────────────────
# The SoT module itself defines createAuditLog; everyone else uses recordAudit.
case "$FP" in
  */src/lib/audit-logs.ts) ;;
  *)
    if printf '%s' "$ADDED" | grep -qE 'createAuditLog[[:space:]]*\('; then
      VIOLATIONS="${VIOLATIONS}
  • createAuditLog() — use recordAudit(db, ctx, request, { … }) instead
    (src/lib/audit-logs.ts). Pass AUDIT_ACTION/AUDIT_ENTITY constants."
    fi
    ;;
esac

# ── Rule 2: z-index only via the named token scale ──────────────────────────
case "$FP" in
  */src/design-system/tokens/z-index.ts) ;;
  *)
    if printf '%s' "$ADDED" | grep -qE 'z-\[[0-9]'; then
      VIOLATIONS="${VIOLATIONS}
  • z-[NNN] hardcoded z-index — use a named utility (z-panel/z-modal/
    z-panelPopover/z-toast/z-tooltip) from src/design-system/tokens/z-index.ts."
    fi
    if printf '%s' "$ADDED" | grep -qE 'zIndex:[[:space:]]*[0-9]'; then
      VIOLATIONS="${VIOLATIONS}
  • inline numeric zIndex — add/use a named token in
    src/design-system/tokens/z-index.ts; never inline the number."
    fi
    ;;
esac

# ── Rule 3: status changes only via the state machine ───────────────────────
# Matches a genuine raw UPDATE that writes current_status (not a SELECT/read).
case "$FP" in
  */src/lib/inventory/state-machine.ts) ;;
  *)
    # Newlines → spaces so a multi-line UPDATE matches on both BSD & GNU grep;
    # [^;]* keeps the match inside one statement (won't span into a later SELECT).
    if printf '%s' "$ADDED" | tr '\n' ' ' | grep -iqE 'UPDATE[^;]*SET[^;]*current_status[[:space:]]*='; then
      VIOLATIONS="${VIOLATIONS}
  • raw UPDATE … SET current_status — route status changes through
    transition() (src/lib/inventory/state-machine.ts), or the flag-gated
    applyTransition(). Never UPDATE current_status by hand."
    fi
    ;;
esac

if [ -n "$VIOLATIONS" ]; then
  {
    printf 'Blocked: %s introduces a source-of-truth violation:\n' "$FP"
    printf '%s\n\n' "$VIOLATIONS"
    printf 'See .claude/rules/source-of-truth.md and backend-patterns.md.\n'
    printf 'If this is an intentional legacy/migration write, make the edit\n'
    printf 'manually outside Claude to bypass this guard.\n'
  } >&2
  exit 2
fi

exit 0
