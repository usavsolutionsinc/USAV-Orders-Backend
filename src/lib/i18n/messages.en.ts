/**
 * English baseline for the bin editor surface. Keyed by stable string IDs;
 * other locales (es, fr, …) provide partial overlays and any missing key
 * falls back to this dictionary.
 *
 * Lives here as a flat object rather than full next-intl integration so the
 * pattern is opt-in — UI strings stay literal everywhere we haven't migrated
 * yet, and only the keys we care about pass through `t()`.
 */
export const messagesEn = {
  // ─── Bin contents view ────────────────────────────────────────────────────
  'bin.contents':            'Contents',
  'bin.empty':               'Empty bin',
  'bin.add_product':         'Add product',
  'bin.tap_to_edit':         'tap to edit',
  'bin.counted_ago':         'Counted {ago} ago',
  'bin.low':                 'LOW',

  // ─── Numpad sheet ─────────────────────────────────────────────────────────
  'numpad.edit_stock':       'Edit stock',
  'numpad.take':             '− TAKE',
  'numpad.put':              '+ PUT',
  'numpad.on_hand':          'On hand',
  'numpad.change':           'Change',
  'numpad.after':            'After',
  'numpad.confirm':          'Confirm',
  'numpad.tap_number':       'Tap a number first',
  'numpad.needs_note':       'Reason "{reason}" needs a note',
  'numpad.needs_photo':      'Reason "{reason}" needs a photo',
  'numpad.take_photo':       '📷 Take photo (required)',
  'numpad.photos_ready':     '📷 {n} photo(s) ready',
  'numpad.queued_offline':   '{sign}{qty} queued (offline)',
  'numpad.confirmed':        '{sign}{qty} confirmed',

  // ─── Details sheet ────────────────────────────────────────────────────────
  'details.title':           'Row details',
  'details.product_title':   'Product title',
  'details.change_sku':      'Change SKU',
  'details.move_to_bin':     'Move to another bin',
  'details.min_max':         'Min / max',
  'details.save_title':      'Save title',
  'details.clear_override':  'Clear override',
  'details.swap':            'Swap',
  'details.transfer':        'Move',
  'details.save_limits':     'Save limits',
  'details.admin_required':  'Product title and SKU swap require admin role.',
  'details.signed_in_as':    "You're signed in as {role}.",

  // ─── Reason / cycle count ────────────────────────────────────────────────
  'reason.label':            'Reason',
  'reason.note_required':    'Reason needs a note',
  'cycle.active':            'Cycle count active',
  'cycle.start_count':       'Start count',
  'cycle.pending':           '{n} pending',
  'cycle.in_review':         '{n} in review',

  // ─── Add-SKU sheet ────────────────────────────────────────────────────────
  'add.search':              'Search Ecwid SKU or product title',
  'add.in_stock':            '{n} on hand',
  'add.ecwid_only':          'Ecwid only',
  'add.no_match':            'No matches for "{q}".',
  'add.type_to_search':      'Type a few characters to search',
  'add.add_to_bin':          'Add to this bin',

  // ─── Connectivity ─────────────────────────────────────────────────────────
  'offline.title':           'No signal',
  'offline.reconnecting':    'Reconnecting…',
  'offline.cached_gap':      'The page you tapped isn\'t cached yet. Stay in this view and we\'ll retry the moment you reconnect.',
  'offline.queue_pending':   'Offline — {n} change(s) queued',
  'offline.queue_syncing':   'Syncing {n} queued change(s)…',
  'offline.back_online':     '✓ Back online',
} as const;

export type MessageKey = keyof typeof messagesEn;
