#!/usr/bin/env node

const path = require('path');
const { Client } = require('@upstash/qstash');

require('dotenv').config({ path: path.resolve('.env'), quiet: true });
require('dotenv').config({ path: path.resolve('.env.local'), quiet: true, override: false });

function getBaseUrl() {
  const explicit =
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');

  const normalized = String(explicit || '').trim().replace(/\/$/, '');
  if (!normalized) {
    throw new Error('APP_URL, NEXT_PUBLIC_APP_URL, or VERCEL_URL is required');
  }
  return normalized;
}

async function main() {
  const token = process.env.QSTASH_TOKEN;
  if (!token) {
    throw new Error('QSTASH_TOKEN is required');
  }

  const baseUrl = getBaseUrl();
  const destination = `${baseUrl}/api/qstash/google-sheets/transfer-orders`;

  const expectedSchedules = [
    { scheduleId: 'google-sheets-transfer-orders-0830-pacific', cron: '30 16 * * *' },
    { scheduleId: 'google-sheets-transfer-orders-1000-weekdays-pacific', cron: '0 18 * * *' },
    { scheduleId: 'google-sheets-transfer-orders-1600-weekdays-pacific', cron: '0 22 * * *' },
  ];

  const client = new Client({
    token,
    baseUrl: process.env.QSTASH_URL || undefined,
  });

  const verification = [];

  for (const schedule of expectedSchedules) {
    await client.schedules.create({
      scheduleId: schedule.scheduleId,
      destination,
      cron: schedule.cron,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
      retries: 3,
      timeout: '300s',
      label: 'google-sheets-transfer-orders',
    });

    const current = await client.schedules.get(schedule.scheduleId);
    verification.push({
      scheduleId: current.scheduleId,
      cron: current.cron,
      destination: current.destination,
      method: current.method,
      createdAt: current.createdAt,
    });
  }

  const mismatches = verification.filter(
    (item) =>
      expectedSchedules.find((s) => s.scheduleId === item.scheduleId)?.cron !== item.cron ||
      item.destination !== destination
  );

  const allSchedules = await client.schedules.list();
  const related = allSchedules.filter((schedule) =>
    String(schedule.destination || '').includes('/api/qstash/google-sheets/transfer-orders')
  );
  const expectedIds = new Set(expectedSchedules.map((s) => s.scheduleId));
  const extras = related
    .map((schedule) => schedule.scheduleId)
    .filter((id) => !expectedIds.has(String(id)));

  const result = {
    ok: mismatches.length === 0,
    baseUrl,
    destination,
    verification,
    relatedScheduleCount: related.length,
    extraRelatedScheduleIds: extras,
  };

  console.log(JSON.stringify(result, null, 2));

  if (mismatches.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
