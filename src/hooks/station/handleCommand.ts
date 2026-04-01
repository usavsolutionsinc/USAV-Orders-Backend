import type { ScanHandlerContext } from './types';

interface CommandCallbacks {
  onComplete?: () => void;
}

export function handleCommand(
  input: string,
  ctx: ScanHandlerContext,
  callbacks: CommandCallbacks = {},
): void {
  const command = input.toUpperCase();
  const activeOrder = ctx.getScanContextOrder();

  if (command === 'TEST') {
    ctx.syncActiveOrderState({
      id: 99999,
      orderId: 'TEST-ORD-001',
      productTitle: 'TEST UNIT - Sony Alpha a7 IV',
      itemNumber: 'B000TEST000',
      sku: 'TEST-SKU',
      condition: 'Used - Excellent',
      notes: 'This is a test order for debugging',
      tracking: 'TEST-TRK-123',
      serialNumbers: [],
      testDateTime: null,
      testedBy: null,
      quantity: 1,
      shipByDate: null,
      createdAt: null,
      orderFound: true,
    });
    ctx.clearManuals();
    ctx.setSuccessMessage('Test order loaded');
  } else if (command === 'YES' && activeOrder) {
    ctx.syncActiveOrderState(null);
    ctx.clearManuals();
    ctx.setSuccessMessage('Order completed!');
    ctx.triggerGlobalRefresh();
  } else if (command === 'YES' && !activeOrder) {
    ctx.setErrorMessage('No active order to complete');
  }

  ctx.setInputValue('');
  ctx.inputRef.current?.focus();
}
