/**
 * Troubleshooting findings engine.
 *
 * Runs registered rules against a call to flag potential issues.
 */

import type { Call, Finding } from '../model/types.js';
import { findErrorResponses } from './rules/error-responses.js';
import { findTimeouts } from './rules/timeouts.js';
import { findRetransmissions } from './rules/retransmissions.js';
import { findMediaIssues } from './rules/media.js';
import { findIdentityIssues } from './rules/identity.js';

export type FindingRule = (call: Call) => Finding[];

const rules: FindingRule[] = [
  findErrorResponses,
  findTimeouts,
  findRetransmissions,
  findMediaIssues,
  findIdentityIssues,
];

/**
 * Run all rules against a call and return findings.
 */
export function runFindings(call: Call): Finding[] {
  const findings: Finding[] = [];
  for (const rule of rules) {
    try {
      findings.push(...rule(call));
    } catch {
      // Rule errors should not break the UI
    }
  }
  // Sort by severity
  const severityOrder = { critical: 0, error: 1, warning: 2, info: 3 };
  findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  return findings;
}
