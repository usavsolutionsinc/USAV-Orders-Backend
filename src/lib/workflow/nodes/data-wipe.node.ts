/**
 * `data_wipe` — secure data erasure / factory reset bench. The category-defining
 * step for ELECTRONICS/AV refurb: a powered device that held an end-user's data
 * (phones, laptops, TVs with accounts, AV receivers with paired services) must be
 * securely erased / factory-reset BEFORE it can be graded for resale. This is a
 * compliance + liability gate, not an optional nicety — selling a device with the
 * prior owner's data is the single worst failure mode in electronics resale.
 *
 * Sits AFTER functional test passes (a dead unit can't be wiped) and BEFORE
 * grading/listing (you grade + price a clean device, never a data-bearing one).
 *
 * Port: a `data_wiped` tap with `wipeSuccess === true` → `wiped`; a failed/partial
 * erase (often itself a hardware fault — eMMC failure, locked bootloader, iCloud/
 * activation lock) → `failed`, which the standard electronics graph routes to
 * repair for diagnosis rather than letting a non-wipeable device leak downstream.
 *
 * Like every node, this is a THIN ADAPTER: it owns no business logic. A future
 * data-wipe station action records the erase method/result + taps `data_wiped`;
 * the node only decides routing on the port. Domain truth (method, verifier,
 * certificate ref) lands in inventory_events via that action, not here.
 */

import { registerNode } from '../registry';
import { stationNode } from './station-node';

registerNode(
  stationNode({
    type: 'data_wipe',
    label: 'Data Wipe',
    icon: 'ShieldCheck',
    category: 'process',
    outputs: [
      { id: 'wiped', label: 'Wiped' },
      { id: 'failed', label: 'Wipe failed' },
    ],
    port: (input) => {
      if (input.event !== 'data_wiped') return null;
      return input.wipeSuccess === true ? 'wiped' : 'failed';
    },
    data: (ctx) => ({
      wipeSuccess: ctx.input.wipeSuccess === true,
      // Erasure method (e.g. 'factory_reset' | 'secure_erase' | 'crypto_erase')
      // and an optional certificate/audit ref, threaded by the station action.
      wipeMethod: ctx.input.wipeMethod ?? null,
      wipeCertRef: ctx.input.wipeCertRef ?? null,
      wipedBy: ctx.actor.staffId,
    }),
  }),
);
