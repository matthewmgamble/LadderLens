/**
 * Typed message protocol between main thread and parse worker.
 */

import type { ParseResult } from '../model/types.js';

/** Messages sent TO the worker */
export type WorkerRequest =
  | { type: 'parse'; file: File; maxSizeMb?: number }
  | { type: 'cancel' };

/** Messages sent FROM the worker */
export type WorkerResponse =
  | { type: 'progress'; bytesProcessed: number; totalBytes: number; linesProcessed: number }
  | { type: 'complete'; result: ParseResult }
  | { type: 'error'; message: string }
  | { type: 'cancelled' };
