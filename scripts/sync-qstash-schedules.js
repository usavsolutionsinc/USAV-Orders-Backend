#!/usr/bin/env node

const fs = require('fs');
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

function loadExpectedSchedules() {
  const file = path.resolve('src/config/qstash-schedules.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function main() {
  const token = process.env.QSTASH_TOKEN;
  if (!token) throw new Error('QSTASH_TOKEN is required');

  const client = new Client({
    token,
    baseUrl: process.env.QSTASH_URL || undefined,
  });

  const baseUrl = getBaseUrl();
  const expectedSchedules = loadExpectedSchedules();
  const expectedIds = new Set(expectedSchedules.map((schedule) => String(schedule.scheduleId)));

  const existingSchedules = await client.schedules.list();
  const obsoleteSchedules = existingSchedules.filter(
    (schedule) => !expectedIds.has(String(schedule.scheduleId)),
  );

  for (const schedule of obsoleteSchedules) {
    await client.schedules.delete(String(schedule.scheduleId));
  }

  const upserted = [];
  for (const schedule of expectedSchedules) {
    const destination = `${baseUrl}${schedule.path}`;
    await client.schedules.create({
      scheduleId: schedule.scheduleId,
      destination,
      cron: schedule.cron,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(schedule.headers || {}),
      },
      body: schedule.body === undefined ? undefined : JSON.stringify(schedule.body),
      retries: schedule.retries,
      timeout: typeof schedule.timeout === 'number' ? `${schedule.timeout}s` : schedule.timeout,
      label: schedule.label,
    });

    const current = await client.schedules.get(schedule.scheduleId);
    upserted.push({
      scheduleId: current.scheduleId,
      cron: current.cron,
      destination: current.destination,
      createdAt: current.createdAt,
    });
  }

  const finalSchedules = await client.schedules.list();
  const related = finalSchedules.map((schedule) => ({
    scheduleId: schedule.scheduleId,
    cron: schedule.cron,
    destination: schedule.destination,
  }));

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    deletedScheduleIds: obsoleteSchedules.map((schedule) => String(schedule.scheduleId)),
    upsertedCount: upserted.length,
    upserted,
    finalCount: finalSchedules.length,
    finalSchedules: related,
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
