/**
 * Opaque cursor encoding for run-history pagination.
 *
 * The cursor wraps a (started_at, id) pair so the next page query can
 * say `WHERE (started_at, id) < (?, ?)`. Encoding is base64url(JSON) —
 * not signed, but the cursor only carries data the API has already
 * returned, so there's no bypass risk from a forged cursor.
 */

import { Buffer } from 'node:buffer';

export interface RunCursor {
  startedAt: string; // ISO timestamp
  id: string; // uuid
}

export function encodeCursor(cursor: RunCursor): string {
  const json = JSON.stringify(cursor);
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function decodeCursor(value: string | null | undefined): RunCursor | null {
  if (!value) return null;
  try {
    const json = Buffer.from(value, 'base64url').toString('utf8');
    const obj = JSON.parse(json) as unknown;
    if (
      obj &&
      typeof obj === 'object' &&
      typeof (obj as RunCursor).startedAt === 'string' &&
      typeof (obj as RunCursor).id === 'string'
    ) {
      return obj as RunCursor;
    }
    return null;
  } catch {
    return null;
  }
}

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export function clampLimit(raw: string | null | undefined): number {
  if (!raw) return DEFAULT_PAGE_SIZE;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(n, MAX_PAGE_SIZE);
}
