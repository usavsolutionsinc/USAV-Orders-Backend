import { NextRequest, NextResponse } from 'next/server';

const ECWID_BASE_URL = 'https://app.ecwid.com/api/v3';
const ECWID_PAGE_LIMIT = 100;

interface EcwidCategory {
  id?: number | string;
  parentId?: number | string | null;
  name?: string | null;
  [key: string]: unknown;
}

interface RepairCategoryNode {
  id: string;
  name: string;
  parentId: string | null;
  hasChildren: boolean;
  isLeaf: boolean;
  depth: number;
  fullPath: string;
}

export async function GET(req: NextRequest) {
  try {
    const storeId = requiredEnvAny('ECWID_STORE_ID', ['ECWID_STOREID', 'ECWID_STORE', 'NEXT_PUBLIC_ECWID_STORE_ID']);
    const token = requiredEnvAny('ECWID_API_TOKEN', ['ECWID_TOKEN', 'ECWID_ACCESS_TOKEN', 'NEXT_PUBLIC_ECWID_API_TOKEN']);

    const categories = await fetchAllEcwidCategories(storeId, token);
    const categoryMap = buildCategoryMap(categories);
    const childMap = buildChildMap(categories);

    const configuredRootIds = parseConfiguredCategoryIds(process.env.ECWID_REPAIR_CATEGORY_IDS);
    const rootIds = configuredRootIds.length > 0
      ? configuredRootIds.filter((id) => categoryMap.has(id))
      : findFallbackRootIds(categories);

    if (rootIds.length === 0) {
      return NextResponse.json(
        {
          success: true,
          roots: [],
          currentParentId: null,
          breadcrumbs: [],
          categories: [],
          message: 'No repair root category found. Set ECWID_REPAIR_CATEGORY_IDS or create category named Bose Repair Service.',
        },
        { headers: { 'Cache-Control': 'private, max-age=60' } }
      );
    }

    const requestedParentId = asId(req.nextUrl.searchParams.get('parentId'));
    const rootSet = new Set(rootIds);

    let currentParentId: string | null = null;
    if (requestedParentId && isCategoryUnderRepairRoots(requestedParentId, rootSet, categoryMap)) {
      currentParentId = requestedParentId;
    }

    const levelCategories = getLevelCategories({
      currentParentId,
      rootIds,
      rootSet,
      categoryMap,
      childMap,
    });

    const breadcrumbs = buildBreadcrumbs(currentParentId, rootSet, categoryMap);

    return NextResponse.json(
      {
        success: true,
        roots: rootIds
          .map((id) => categoryMap.get(id))
          .filter(Boolean)
          .map((category) => ({ id: asId(category?.id), name: String(category?.name || '') })),
        currentParentId,
        breadcrumbs,
        categories: levelCategories,
      },
      { headers: { 'Cache-Control': 'private, max-age=120' } }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Ecwid repair categories error:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

function getLevelCategories(params: {
  currentParentId: string | null;
  rootIds: string[];
  rootSet: Set<string>;
  categoryMap: Map<string, EcwidCategory>;
  childMap: Map<string | null, string[]>;
}): RepairCategoryNode[] {
  const { currentParentId, rootIds, rootSet, categoryMap, childMap } = params;

  const idsAtLevel = currentParentId
    ? childMap.get(currentParentId) || []
    : rootIds.flatMap((rootId) => childMap.get(rootId) || []);

  return idsAtLevel
    .filter((id) => isCategoryUnderRepairRoots(id, rootSet, categoryMap))
    .map((id) => {
      const category = categoryMap.get(id);
      const parentId = asId(category?.parentId);
      const hasChildren = (childMap.get(id)?.length || 0) > 0;
      const fullPath = buildFullPath(id, categoryMap);
      const depth = Math.max(0, fullPath.split(' > ').length - 1);

      return {
        id,
        name: String(category?.name || '').trim() || `Category ${id}`,
        parentId,
        hasChildren,
        isLeaf: !hasChildren,
        depth,
        fullPath,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function buildBreadcrumbs(
  currentParentId: string | null,
  rootSet: Set<string>,
  categoryMap: Map<string, EcwidCategory>
): Array<{ id: string; name: string }> {
  if (!currentParentId) return [];

  const path: Array<{ id: string; name: string }> = [];
  const seen = new Set<string>();
  let cursor: string | null = currentParentId;

  while (cursor) {
    if (seen.has(cursor)) break;
    seen.add(cursor);

    const node = categoryMap.get(cursor);
    if (!node) break;

    path.unshift({
      id: cursor,
      name: String(node.name || '').trim() || `Category ${cursor}`,
    });

    if (rootSet.has(cursor)) break;

    cursor = asId(node.parentId);
  }

  return path;
}

function buildFullPath(categoryId: string, categoryMap: Map<string, EcwidCategory>): string {
  const names: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null = categoryId;

  while (cursor) {
    if (seen.has(cursor)) break;
    seen.add(cursor);

    const node = categoryMap.get(cursor);
    if (!node) break;

    const name = String(node.name || '').trim();
    if (name) names.unshift(name);

    cursor = asId(node.parentId);
  }

  return names.join(' > ');
}

function isCategoryUnderRepairRoots(
  categoryId: string,
  rootSet: Set<string>,
  categoryMap: Map<string, EcwidCategory>
): boolean {
  const seen = new Set<string>();
  let cursor: string | null = categoryId;

  while (cursor) {
    if (seen.has(cursor)) return false;
    seen.add(cursor);

    if (rootSet.has(cursor)) return true;

    const node = categoryMap.get(cursor);
    if (!node) return false;
    cursor = asId(node.parentId);
  }

  return false;
}

function buildCategoryMap(categories: EcwidCategory[]): Map<string, EcwidCategory> {
  const map = new Map<string, EcwidCategory>();
  for (const category of categories) {
    const id = asId(category.id);
    if (id) map.set(id, category);
  }
  return map;
}

function buildChildMap(categories: EcwidCategory[]): Map<string | null, string[]> {
  const map = new Map<string | null, string[]>();

  for (const category of categories) {
    const id = asId(category.id);
    if (!id) continue;

    const parentId = asId(category.parentId);
    const list = map.get(parentId) || [];
    list.push(id);
    map.set(parentId, list);
  }

  return map;
}

function findFallbackRootIds(categories: EcwidCategory[]): string[] {
  const exactMatch = categories
    .filter((category) => normalizeName(String(category.name || '')) === 'bose repair service')
    .map((category) => asId(category.id))
    .filter((id): id is string => Boolean(id));

  if (exactMatch.length > 0) return exactMatch;

  return categories
    .filter((category) => {
      const name = normalizeName(String(category.name || ''));
      return name.includes('repair') && name.includes('service');
    })
    .map((category) => asId(category.id))
    .filter((id): id is string => Boolean(id));
}

function parseConfiguredCategoryIds(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function asId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

async function fetchAllEcwidCategories(storeId: string, token: string): Promise<EcwidCategory[]> {
  const categories: EcwidCategory[] = [];
  let offset = 0;

  while (true) {
    const url = new URL(`${ECWID_BASE_URL}/${storeId}/categories`);
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('limit', String(ECWID_PAGE_LIMIT));

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const text = await safeReadText(response);
      throw new Error(`Ecwid category list request failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as { items?: EcwidCategory[] } | EcwidCategory[];
    const pageItems = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : [];
    categories.push(...pageItems);

    if (pageItems.length < ECWID_PAGE_LIMIT) {
      break;
    }

    offset += ECWID_PAGE_LIMIT;
  }

  return categories;
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function requiredEnvAny(primaryName: string, aliases: string[] = []): string {
  const keysToCheck = [primaryName, ...aliases];

  for (const key of keysToCheck) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  throw new Error(`Missing required environment variable: ${primaryName}`);
}
