'use client';

/**
 * Repair → order linkage search.
 *
 * Replaces the old free-typed "Order #" input with a live Ecwid order lookup
 * (`/api/ecwid/order-search`). The operator types an order number (or customer
 * name / email), picks the real order from the dropdown, and we persist the
 * resolved public order number as `source_order_id`.
 *
 * UNFILTERED by fulfillment state on purpose — a repair links to an order
 * whether or not it has shipped (the API sends no shipped/unshipped filter).
 *
 * Free-text fallback is preserved: an order that isn't in Ecwid (legacy /
 * marketplace) can still be committed as typed via the "Use … as entered" row
 * or Enter, so this never blocks linking.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Loader2, Check, X, ExternalLink } from '@/components/Icons';
import { IconButton } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { OrderIdChip, getLast4 } from '@/components/ui/CopyChip';

interface OrderCandidate {
  ecwidOrderId: string;
  orderNumber: string;
  displayNumber: string;
  date: string | null;
  customerName: string | null;
  email: string | null;
  total: number | null;
  paymentStatus: string | null;
  fulfillmentStatus: string | null;
  itemCount: number;
  firstItemName: string | null;
  firstItemSku: string | null;
}

interface RepairOrderLinkSearchProps {
  /** Current linked order number (from the controller; '' when unlinked). */
  value: string;
  /** Commit a resolved/typed order number up to the controller. */
  onChange: (orderNumber: string) => void;
  disabled?: boolean;
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function RepairOrderLinkSearch({ value, onChange, disabled }: RepairOrderLinkSearchProps) {
  // `term` drives the live search; `editing` flips between the confirmed chip
  // (a value is set) and the open search field. Open straight into search when
  // there's nothing linked yet.
  const [term, setTerm] = useState('');
  const [editing, setEditing] = useState(!value);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [debounced, setDebounced] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Keep local edit state in sync when a different repair flows in.
  useEffect(() => {
    setEditing(!value);
    setTerm('');
    setOpen(false);
  }, [value]);

  // Debounce the network term so we don't hit Ecwid on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(id);
  }, [term]);

  const enabled = editing && debounced.length >= 2;
  const { data, isFetching, isError } = useQuery<{ success: boolean; orders: OrderCandidate[] }>({
    queryKey: ['ecwid-order-search', debounced],
    queryFn: async () => {
      const res = await fetch(`/api/ecwid/order-search?q=${encodeURIComponent(debounced)}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled,
    staleTime: 30_000,
  });

  const orders = useMemo(() => data?.orders ?? [], [data]);

  // Reset the keyboard highlight whenever the result set changes.
  useEffect(() => {
    setHighlight(0);
  }, [debounced, orders.length]);

  // Close the dropdown on an outside click.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const commit = (orderNumber: string) => {
    const trimmed = orderNumber.trim();
    if (!trimmed) return;
    onChange(trimmed);
    setEditing(false);
    setOpen(false);
    setTerm('');
  };

  const startEditing = () => {
    setEditing(true);
    setOpen(true);
    setTerm('');
    // Defer focus until the input is mounted.
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  // Total rows in the dropdown = order results + the optional free-text row.
  const showFreeText = debounced.length >= 2;
  const rowCount = orders.length + (showFreeText ? 1 : 0);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, Math.max(rowCount - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlight < orders.length && orders[highlight]) {
        commit(orders[highlight].orderNumber);
      } else if (term.trim()) {
        commit(term);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      if (value) setEditing(false);
    }
  };

  // ── Confirmed state: a value is linked and we're not actively editing ──────
  if (value && !editing) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2">
        <span className="flex min-w-0 items-center gap-2">
          <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
          {/* Copy chip shows last 4 (full value on copy/tooltip) per the chip SoT. */}
          <OrderIdChip value={value} display={getLast4(value)} dense />
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {/* ds-raw-button: minimal inline microBadge text link (no chrome) — a DS Button would add height/padding */}
          <button
            type="button"
            onClick={startEditing}
            disabled={disabled}
            className="text-eyebrow font-black uppercase tracking-widest text-emerald-700 hover:text-emerald-900 disabled:opacity-40"
          >
            Change
          </button>
          <HoverTooltip label="Clear order link" focusable={false}>
            <IconButton
              type="button"
              onClick={() => onChange('')}
              disabled={disabled}
              ariaLabel="Clear order link"
              icon={<X className="h-3.5 w-3.5 text-emerald-600" />}
              className="flex h-5 w-5 items-center justify-center rounded hover:bg-emerald-100 disabled:opacity-40"
            />
          </HoverTooltip>
        </div>
      </div>
    );
  }

  // ── Search state ───────────────────────────────────────────────────────────
  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls="ecwid-order-results"
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search Ecwid order # / customer…"
          disabled={disabled}
          className="w-full rounded-lg border border-border-soft py-2 pl-8 pr-8 text-sm transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        />
        {isFetching ? (
          <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-text-faint" />
        ) : value ? (
          <HoverTooltip label="Cancel" focusable={false}>
            <IconButton
              type="button"
              onClick={() => {
                setEditing(false);
                setOpen(false);
              }}
              ariaLabel="Cancel order search"
              icon={<X className="h-3.5 w-3.5 text-text-faint" />}
              className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded hover:bg-surface-sunken"
            />
          </HoverTooltip>
        ) : null}
      </div>

      {open && (debounced.length >= 2 || isFetching) ? (
        <div
          id="ecwid-order-results"
          role="listbox"
          className="absolute z-dropdown mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-border-soft bg-surface-card py-1 shadow-lg"
        >
          {isError ? (
            <p className="px-3 py-2 text-xs text-rose-600">Couldn’t reach Ecwid. Type the order # and press Enter.</p>
          ) : null}

          {!isFetching && !isError && orders.length === 0 && debounced.length >= 2 ? (
            <p className="px-3 py-2 text-xs text-text-soft">No Ecwid orders match “{debounced}”.</p>
          ) : null}

          {orders.map((o, i) => {
            const date = formatDate(o.date);
            const active = i === highlight;
            return (
              // ds-raw-button: multi-line text-left combobox option row (order # + customer/item) — not a Button shape
              <button
                key={o.ecwidOrderId}
                type="button"
                role="option"
                aria-selected={active}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => commit(o.orderNumber)}
                className={`flex w-full items-start gap-2 px-3 py-2 text-left transition-colors ${
                  active ? 'bg-blue-50' : 'hover:bg-surface-hover'
                }`}
              >
                <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-text-default">{o.displayNumber}</span>
                    {date ? (
                      <span className="text-eyebrow font-semibold uppercase tracking-widest text-text-faint">
                        {date}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-text-soft">
                    {[o.customerName, o.firstItemName].filter(Boolean).join(' · ') || o.email || '—'}
                  </span>
                </span>
              </button>
            );
          })}

          {showFreeText ? (
            // ds-raw-button: text-left combobox "use as entered" option row (role=option) — not a Button shape
            <button
              type="button"
              role="option"
              aria-selected={highlight === orders.length}
              onMouseEnter={() => setHighlight(orders.length)}
              onClick={() => commit(term)}
              className={`flex w-full items-center gap-2 border-t border-border-hairline px-3 py-2 text-left transition-colors ${
                highlight === orders.length ? 'bg-blue-50' : 'hover:bg-surface-hover'
              }`}
            >
              <Check className="h-3.5 w-3.5 shrink-0 text-text-faint" />
              <span className="text-xs text-text-muted">
                Use <span className="font-mono font-semibold text-text-default">{term.trim()}</span> as entered
              </span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
