import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { extractSipMessages } from '../../src/parser/sip-extractor.js';
import { correlateMessages } from '../../src/analysis/correlator.js';
import { runFindings } from '../../src/analysis/findings.js';

function loadFixture(name: string): string[] {
  const path = join(__dirname, '..', 'fixtures', name);
  return readFileSync(path, 'utf-8').split('\n');
}

describe('findings — v11 404 call', () => {
  const lines = loadFixture('webui-v11-single-leg-404.log');
  const sipMsgs = extractSipMessages(lines);
  const { calls } = correlateMessages(sipMsgs);
  const call = calls.find(c => c.cid === 118);

  it('finds the call', () => {
    expect(call).toBeDefined();
  });

  it('detects 404 error response finding', () => {
    const findings = runFindings(call!);
    const errorFinding = findings.find(f => f.ruleId === 'error-response');
    expect(errorFinding).toBeDefined();
    expect(errorFinding!.title).toContain('404');
    expect(errorFinding!.severity).toBe('warning');
  });
});

describe('findings — v13 success call', () => {
  const lines = loadFixture('webui-v13-two-leg-success.log');
  const sipMsgs = extractSipMessages(lines);
  const { calls } = correlateMessages(sipMsgs);
  const call = calls.find(c => c.cid === 5105);

  it('finds the call', () => {
    expect(call).toBeDefined();
  });

  it('runs findings without errors', () => {
    const findings = runFindings(call!);
    expect(Array.isArray(findings)).toBe(true);
  });
});
