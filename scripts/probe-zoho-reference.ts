import 'dotenv/config';
import {
  searchPurchaseOrdersByTracking,
  searchPurchaseReceivesByTracking,
} from '@/lib/zoho';

const tracking = process.argv[2] || '870568737370';

async function main() {
  console.log(`\n=== Zoho reference# probe: ${tracking} ===\n`);

  console.log('[1] searchPurchaseReceivesByTracking (search_text on /purchasereceives)');
  try {
    const receives = await searchPurchaseReceivesByTracking(tracking);
    console.log(`    → ${receives.length} receive(s)`);
    for (const r of receives) {
      console.log(`      • receive_id=${(r as { purchasereceive_id?: string }).purchasereceive_id} po_id=${r.purchaseorder_id} po#=${(r as { purchaseorder_number?: string }).purchaseorder_number}`);
    }
  } catch (e) {
    console.log('    ✗ error:', e instanceof Error ? e.message : e);
  }

  console.log('\n[2] searchPurchaseOrdersByTracking (reference_number + search_text on /purchaseorders)');
  try {
    const pos = await searchPurchaseOrdersByTracking(tracking);
    console.log(`    → ${pos.length} PO(s)`);
    for (const po of pos) {
      console.log(`      • po_id=${po.purchaseorder_id} po#=${(po as { purchaseorder_number?: string }).purchaseorder_number} status=${(po as { status?: string }).status} ref#=${po.reference_number}`);
    }
  } catch (e) {
    console.log('    ✗ error:', e instanceof Error ? e.message : e);
  }

  console.log('\n[3] Raw /purchaseorders?reference_number=... (no status filter)');
  const { zohoGet } = await import('@/lib/zoho/httpClient');
  try {
    const raw = await zohoGet<{ purchaseorders?: Array<Record<string, unknown>> }>(
      '/api/v1/purchaseorders',
      { reference_number: tracking, per_page: 10 },
    );
    const list = raw.purchaseorders || [];
    console.log(`    → ${list.length} PO(s) by reference_number only`);
    for (const po of list) {
      console.log(`      • po_id=${po.purchaseorder_id} po#=${po.purchaseorder_number} status=${po.status} ref#=${po.reference_number}`);
    }
  } catch (e) {
    console.log('    ✗ error:', e instanceof Error ? e.message : e);
  }

  console.log('\n=== done ===\n');
}

main().catch((e) => {
  console.error('probe failed:', e);
  process.exit(1);
});
