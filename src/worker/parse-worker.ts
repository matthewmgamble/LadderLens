/**
 * Web Worker that parses Ribbon SBC log files off the main thread.
 *
 * Uses streaming (Blob.stream() + TextDecoderStream) to avoid loading
 * the entire file into memory at once.
 */

import { SipExtractor } from '../parser/sip-extractor.js';
import { parseLogLine, detectVersion, isLogLine } from '../parser/log-line.js';
import { correlateMessages } from '../analysis/correlator.js';
import type { WorkerRequest, WorkerResponse } from './worker-protocol.js';
import type { LogVersion, ParseResult } from '../model/types.js';

const DEFAULT_MAX_SIZE_MB = 200;
const PROGRESS_INTERVAL_BYTES = 500_000; // Report progress every ~500KB

let cancelled = false;

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;

  if (msg.type === 'cancel') {
    cancelled = true;
    return;
  }

  if (msg.type === 'parse') {
    cancelled = false;
    await parseFile(msg.file, msg.maxSizeMb ?? DEFAULT_MAX_SIZE_MB);
  }
};

function post(msg: WorkerResponse): void {
  self.postMessage(msg);
}

async function parseFile(file: File, maxSizeMb: number): Promise<void> {
  const startTime = performance.now();

  // Size check
  if (file.size > maxSizeMb * 1024 * 1024) {
    post({ type: 'error', message: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is ${maxSizeMb}MB.` });
    return;
  }

  try {
    const extractor = new SipExtractor();
    let detectedVersion: LogVersion | null = null;
    let lineNumber = 0;
    let bytesProcessed = 0;
    let lastProgressBytes = 0;
    let partialLine = '';

    const stream = file.stream();
    const reader = stream.pipeThrough(new TextDecoderStream()).getReader();

    while (true) {
      if (cancelled) {
        post({ type: 'cancelled' });
        return;
      }

      const { done, value } = await reader.read();
      if (done) break;

      bytesProcessed += new Blob([value]).size;

      // Split into lines, handling partial lines across chunks
      const text = partialLine + value;
      const lines = text.split('\n');
      partialLine = lines.pop() ?? '';

      for (const line of lines) {
        lineNumber++;
        extractor.processLine(line, lineNumber);

        // Auto-detect version from first parseable line
        if (detectedVersion === null && isLogLine(line)) {
          detectedVersion = detectVersion(line);
        }
      }

      // Report progress periodically
      if (bytesProcessed - lastProgressBytes > PROGRESS_INTERVAL_BYTES) {
        lastProgressBytes = bytesProcessed;
        post({
          type: 'progress',
          bytesProcessed,
          totalBytes: file.size,
          linesProcessed: lineNumber,
        });
      }
    }

    // Process any remaining partial line
    if (partialLine) {
      lineNumber++;
      extractor.processLine(partialLine, lineNumber);
    }

    extractor.finish(lineNumber);

    if (cancelled) {
      post({ type: 'cancelled' });
      return;
    }

    // Build SIP messages and correlate into calls
    const sipMessages = extractor.buildSipMessages();
    const { calls, unmatchedMessages, warnings } = correlateMessages(sipMessages);

    const parseDurationMs = performance.now() - startTime;

    const result: ParseResult = {
      version: detectedVersion ?? 'v13',
      calls,
      unmatchedMessages,
      warnings,
      totalLines: lineNumber,
      totalBytes: file.size,
      parseDurationMs,
    };

    post({ type: 'complete', result });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
}
