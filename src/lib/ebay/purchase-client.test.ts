/**
 * Unit tests for eBay buyer purchase XML/JSON mappers — no live eBay, no DB.
 * Run: npx tsx --test src/lib/ebay/purchase-client.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  asArray,
  buildGetOrdersDateFilter,
  buildGetOrdersRequestXml,
  extractTradingShipmentTracking,
  mapBuyPurchaseOrderToBuyerLines,
  mapTradingOrderToBuyerLines,
  mapTradingOrdersToBuyerLines,
  parseTradingGetOrdersXml,
} from './purchase-client';

test('asArray normalizes singleton / array / null', () => {
  assert.deepEqual(asArray(undefined), []);
  assert.deepEqual(asArray(null), []);
  assert.deepEqual(asArray({ a: 1 }), [{ a: 1 }]);
  assert.deepEqual(asArray([{ a: 1 }, { a: 2 }]), [{ a: 1 }, { a: 2 }]);
});

test('extractTradingShipmentTracking reads first ShipmentTrackingDetails', () => {
  assert.deepEqual(
    extractTradingShipmentTracking({
      ShipmentTrackingDetails: {
        ShipmentTrackingNumber: '1Z999AA10123456784',
        ShippingCarrierUsed: 'UPS',
      },
    }),
    { trackingNumber: '1Z999AA10123456784', carrierCode: 'UPS' },
  );
  assert.deepEqual(extractTradingShipmentTracking({}), {
    trackingNumber: null,
    carrierCode: null,
  });
});

test('mapTradingOrderToBuyerLines maps transactions + order-level tracking fallback', () => {
  const lines = mapTradingOrderToBuyerLines({
    OrderID: '12-34567-89012',
    OrderStatus: 'Completed',
    SellerUserID: 'parts_seller',
    PaidTime: '2026-07-01T12:00:00.000Z',
    CheckoutStatus: { Status: 'Complete' },
    ShippingDetails: {
      ShipmentTrackingDetails: {
        ShipmentTrackingNumber: '794612345678',
        ShippingCarrierUsed: 'FedEx',
      },
    },
    TransactionArray: {
      Transaction: {
        OrderLineItemID: '111222333-444555666',
        TransactionID: '444555666',
        QuantityPurchased: 2,
        Item: {
          ItemID: '111222333',
          Title: 'Bose SoundLink',
          SKU: 'BOSE-SL',
          ConditionDisplayName: 'Used',
          ViewItemURL: 'https://www.ebay.com/itm/111222333',
        },
      },
    },
  });

  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0], {
    sourceOrderId: '12-34567-89012',
    sourceLineItemId: '111222333-444555666',
    sku: 'BOSE-SL',
    itemName: 'Bose SoundLink',
    quantity: 2,
    conditionGrade: 'Used',
    sellerUsername: 'parts_seller',
    legacyOrderId: '111222333-444555666',
    purchaseOrderStatus: 'Completed',
    paymentStatus: 'Complete',
    listingUrl: 'https://www.ebay.com/itm/111222333',
    trackingNumber: '794612345678',
    carrierCode: 'FedEx',
    orderNumber: '12-34567-89012',
    vendorOrSellerName: 'parts_seller',
  });
});

test('mapTradingOrderToBuyerLines prefers transaction-level tracking', () => {
  const [line] = mapTradingOrderToBuyerLines({
    OrderID: 'O-1',
    SellerUserID: 's1',
    ShippingDetails: {
      ShipmentTrackingDetails: {
        ShipmentTrackingNumber: 'ORDER-LEVEL',
        ShippingCarrierUsed: 'USPS',
      },
    },
    TransactionArray: {
      Transaction: [{
        OrderLineItemID: 'L-1',
        QuantityPurchased: 1,
        Item: { Title: 'A', ItemID: '9' },
        ShippingDetails: {
          ShipmentTrackingDetails: {
            ShipmentTrackingNumber: 'TX-LEVEL',
            ShippingCarrierUsed: 'UPS',
          },
        },
      }],
    },
  });
  assert.equal(line.trackingNumber, 'TX-LEVEL');
  assert.equal(line.carrierCode, 'UPS');
});

test('parseTradingGetOrdersXml + mapTradingOrdersToBuyerLines round-trip', () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<GetOrdersResponse xmlns="urn:ebay:apis:eBLBaseComponents">
  <Ack>Success</Ack>
  <HasMoreOrders>false</HasMoreOrders>
  <PageNumber>1</PageNumber>
  <OrderArray>
    <Order>
      <OrderID>99-888</OrderID>
      <OrderStatus>Completed</OrderStatus>
      <SellerUserID>vendor_x</SellerUserID>
      <ShippingDetails>
        <ShipmentTrackingDetails>
          <ShipmentTrackingNumber>1ZAAA</ShipmentTrackingNumber>
          <ShippingCarrierUsed>UPS</ShippingCarrierUsed>
        </ShipmentTrackingDetails>
      </ShippingDetails>
      <TransactionArray>
        <Transaction>
          <OrderLineItemID>100-200</OrderLineItemID>
          <QuantityPurchased>1</QuantityPurchased>
          <Item>
            <ItemID>100</ItemID>
            <Title>Widget</Title>
            <SKU>W-1</SKU>
          </Item>
        </Transaction>
        <Transaction>
          <OrderLineItemID>100-201</OrderLineItemID>
          <QuantityPurchased>3</QuantityPurchased>
          <Item>
            <ItemID>101</ItemID>
            <Title>Gadget</Title>
          </Item>
        </Transaction>
      </TransactionArray>
    </Order>
  </OrderArray>
</GetOrdersResponse>`;

  const parsed = parseTradingGetOrdersXml(xml);
  assert.equal(parsed.ack, 'Success');
  assert.equal(parsed.hasMoreOrders, false);
  assert.equal(parsed.orders.length, 1);
  assert.equal(parsed.errorMessage, null);

  const lines = mapTradingOrdersToBuyerLines(parsed.orders);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].sourceOrderId, '99-888');
  assert.equal(lines[0].sku, 'W-1');
  assert.equal(lines[0].trackingNumber, '1ZAAA');
  assert.equal(lines[1].quantity, 3);
  assert.equal(lines[1].itemName, 'Gadget');
});

test('parseTradingGetOrdersXml surfaces Failure Ack + Errors', () => {
  const xml = `<?xml version="1.0"?>
<GetOrdersResponse>
  <Ack>Failure</Ack>
  <Errors>
    <ShortMessage>Auth bad</ShortMessage>
    <LongMessage>IAF token expired</LongMessage>
  </Errors>
  <OrderArray/>
</GetOrdersResponse>`;
  const parsed = parseTradingGetOrdersXml(xml);
  assert.equal(parsed.ack, 'Failure');
  assert.match(parsed.errorMessage ?? '', /IAF token expired/);
  assert.equal(parsed.orders.length, 0);
});

test('mapBuyPurchaseOrderToBuyerLines maps line items + fulfillment tracking', () => {
  const lines = mapBuyPurchaseOrderToBuyerLines({
    purchaseOrderId: '4812345678901234',
    purchaseOrderStatus: 'FULFILLED',
    purchaseOrderPaymentStatus: 'PAID',
    shippingFulfillments: [{
      shipmentTrackingNumber: '9400111899223344556677',
      shippingCarrierCode: 'USPS',
      lineItemReferences: [{ lineItemId: 'LI-1', quantity: 1 }],
    }],
    lineItems: [
      {
        lineItemId: 'LI-1',
        title: 'Used amp',
        quantity: 1,
        itemId: 'v1|250032252772|0',
        orderId: '14-00038-68975',
        lineItemStatus: 'DELIVERED',
        lineItemPaymentStatus: 'PAID',
        seller: { username: 'exports_seller' },
        shippingDetail: { shippingCarrierCode: 'USPS' },
        legacyReference: {
          legacyItemId: '250032252772',
          legacyOrderId: '14-00038-68975',
          legacyTransactionId: '15650881015',
        },
      },
      {
        lineItemId: 'LI-2',
        title: 'No track yet',
        quantity: 2,
        seller: { username: 'other' },
        shippingDetail: { shippingCarrierCode: 'FedEx' },
        legacyReference: { legacyOrderId: '14-00038-68976' },
      },
    ],
  });

  assert.equal(lines.length, 2);
  assert.equal(lines[0].sourceOrderId, '4812345678901234');
  assert.equal(lines[0].sourceLineItemId, 'LI-1');
  assert.equal(lines[0].trackingNumber, '9400111899223344556677');
  assert.equal(lines[0].carrierCode, 'USPS');
  assert.equal(lines[0].legacyOrderId, '14-00038-68975');
  assert.equal(lines[0].sku, '250032252772');
  assert.equal(lines[0].listingUrl, 'https://www.ebay.com/itm/250032252772');
  assert.equal(lines[0].vendorOrSellerName, 'exports_seller');

  assert.equal(lines[1].trackingNumber, null);
  assert.equal(lines[1].carrierCode, 'FedEx'); // from shippingDetail fallback
  assert.equal(lines[1].quantity, 2);
});

test('buildGetOrdersDateFilter clamps ModTimeFrom to 30 days', () => {
  const now = Date.parse('2026-07-10T12:00:00.000Z');
  assert.deepEqual(buildGetOrdersDateFilter(null, now), { numberOfDays: 30 });

  const recent = buildGetOrdersDateFilter('2026-07-08T00:00:00.000Z', now);
  assert.equal(recent.modTimeFrom, '2026-07-08T00:00:00.000Z');

  const old = buildGetOrdersDateFilter('2026-01-01T00:00:00.000Z', now);
  assert.equal(old.modTimeFrom, '2026-06-10T12:00:00.000Z'); // now - 30d
});

test('buildGetOrdersRequestXml includes OrderRole=Buyer and pagination', () => {
  const xml = buildGetOrdersRequestXml({
    pageNumber: 2,
    sinceIso: '2026-07-01T00:00:00.000Z',
    nowMs: Date.parse('2026-07-10T00:00:00.000Z'),
  });
  assert.match(xml, /<OrderRole>Buyer<\/OrderRole>/);
  assert.match(xml, /<PageNumber>2<\/PageNumber>/);
  assert.match(xml, /<ModTimeFrom>2026-07-01T00:00:00\.000Z<\/ModTimeFrom>/);
  assert.doesNotMatch(xml, /NumberOfDays/);

  const first = buildGetOrdersRequestXml({ pageNumber: 1, sinceIso: null });
  assert.match(first, /<NumberOfDays>30<\/NumberOfDays>/);
});
