/**
 * Timestamp parsing for Ribbon SBC log formats.
 *
 * v11: [2022-12-05 18:34:37,978]
 * v13: [2026-11-17T14:00:24Z,073]
 */

/** v11 format: [YYYY-MM-DD HH:MM:SS,mmm] */
const V11_RE = /^\[(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}),(\d{3})\]$/;

/** v13 format: [YYYY-MM-DDTHH:MM:SSZ,mmm] */
const V13_RE = /^\[(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z,(\d{3})\]$/;

export interface ParsedTimestamp {
  /** Epoch milliseconds (UTC) */
  epochMs: number;
  /** Original timestamp string including brackets */
  raw: string;
  /** Whether the original had an explicit timezone (v13 has Z, v11 is ambiguous) */
  hasTimezone: boolean;
}

/**
 * Parse a timestamp string from either v11 or v13 format.
 * Returns null if the string doesn't match either format.
 */
export function parseTimestamp(raw: string): ParsedTimestamp | null {
  let m = V13_RE.exec(raw);
  if (m) {
    const epochMs = Date.UTC(
      parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]),
      parseInt(m[4]), parseInt(m[5]), parseInt(m[6]),
      parseInt(m[7]),
    );
    return { epochMs, raw, hasTimezone: true };
  }

  m = V11_RE.exec(raw);
  if (m) {
    // v11 timestamps have no timezone indicator — treat as UTC for ordering
    const epochMs = Date.UTC(
      parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]),
      parseInt(m[4]), parseInt(m[5]), parseInt(m[6]),
      parseInt(m[7]),
    );
    return { epochMs, raw, hasTimezone: false };
  }

  return null;
}

/**
 * Format epoch ms as a readable time string (HH:MM:SS.mmm).
 */
export function formatTime(epochMs: number): string {
  const d = new Date(epochMs);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  const ms = String(d.getUTCMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

/**
 * Format a relative time offset in ms as "+0.123s" or "+1.234s".
 */
export function formatRelativeTime(offsetMs: number): string {
  const sign = offsetMs >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMs);
  if (abs < 1000) {
    return `${sign}${abs}ms`;
  }
  return `${sign}${(abs / 1000).toFixed(3)}s`;
}
