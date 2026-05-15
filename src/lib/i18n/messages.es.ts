import type { MessageKey } from './messages.en';

/**
 * Spanish overlay. Any missing key falls back to English.
 *
 * Translations here are tactical — covering only the strings that receivers
 * and pickers see on the bin editor flow. The non-Spanish-speaking admin
 * surfaces (reports page, SKU pairing tooling) stay English-only until the
 * project graduates to next-intl + a real translator pass.
 */
export const messagesEs: Partial<Record<MessageKey, string>> = {
  'bin.contents':            'Contenido',
  'bin.empty':               'Bin vacío',
  'bin.add_product':         'Agregar producto',
  'bin.tap_to_edit':         'tocar para editar',
  'bin.counted_ago':         'Contado hace {ago}',
  'bin.low':                 'BAJO',

  'numpad.edit_stock':       'Editar stock',
  'numpad.take':             '− SACAR',
  'numpad.put':              '+ AGREGAR',
  'numpad.on_hand':          'En mano',
  'numpad.change':           'Cambio',
  'numpad.after':            'Después',
  'numpad.confirm':          'Confirmar',
  'numpad.tap_number':       'Toca un número primero',
  'numpad.needs_note':       'La razón "{reason}" necesita una nota',
  'numpad.needs_photo':      'La razón "{reason}" necesita una foto',
  'numpad.take_photo':       '📷 Tomar foto (requerida)',
  'numpad.photos_ready':     '📷 {n} foto(s) listas',
  'numpad.queued_offline':   '{sign}{qty} en cola (sin conexión)',
  'numpad.confirmed':        '{sign}{qty} confirmado',

  'cycle.active':            'Conteo cíclico activo',
  'cycle.start_count':       'Iniciar conteo',
  'cycle.pending':           '{n} pendiente(s)',

  'add.search':              'Buscar SKU de Ecwid o título',
  'add.in_stock':            '{n} en mano',
  'add.ecwid_only':          'Solo Ecwid',

  'offline.title':           'Sin señal',
  'offline.queue_pending':   'Sin conexión — {n} cambio(s) en cola',
  'offline.back_online':     '✓ De vuelta en línea',
};
