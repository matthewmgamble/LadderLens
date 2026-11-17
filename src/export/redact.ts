/**
 * Sensitive field redaction.
 *
 * Strips or masks phone numbers, IP addresses, authentication data,
 * and other PII from SIP message text and call records.
 */

/** Default redaction patterns */
const PATTERNS: { name: string; pattern: RegExp; replacement: string }[] = [
  // Phone numbers: +14034783920 → +1403***3920
  {
    name: 'phone',
    pattern: /(\+?\d{1,3})(\d{3})(\d{3})(\d{4})/g,
    replacement: '$1$2***$4',
  },
  // IP addresses: 10.56.20.193 → 10.XX.XX.193
  {
    name: 'ipv4',
    pattern: /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})/g,
    replacement: '$1.XX.XX.$4',
  },
  // SIP URIs email-like user parts: user@domain → REDACTED@domain
  {
    name: 'sip-user',
    pattern: /sip:([^@+\d][^@]*)@/g,
    replacement: 'sip:REDACTED@',
  },
  // Authorization/WWW-Authenticate headers
  {
    name: 'auth',
    pattern: /(Authorization|WWW-Authenticate|Proxy-Authorization|Proxy-Authenticate):\s*.+/gi,
    replacement: '$1: [REDACTED]',
  },
  // Crypto keys in SDP (a=crypto:...)
  {
    name: 'crypto',
    pattern: /(inline:)[A-Za-z0-9+/=|^]+/g,
    replacement: '$1[REDACTED]',
  },
  // ICE credentials
  {
    name: 'ice',
    pattern: /(ice-pwd:)\S+/g,
    replacement: '$1[REDACTED]',
  },
  // Display names in quotes
  {
    name: 'display-name',
    pattern: /"[^"]+"/g,
    replacement: '"REDACTED"',
  },
];

export interface RedactOptions {
  /** Which pattern categories to apply (default: all) */
  categories?: string[];
}

/**
 * Redact sensitive fields from a text string.
 */
export function redactText(text: string, options?: RedactOptions): string {
  const categories = options?.categories
    ? new Set(options.categories)
    : null;

  let result = text;
  for (const p of PATTERNS) {
    if (categories && !categories.has(p.name)) continue;
    result = result.replace(p.pattern, p.replacement);
  }
  return result;
}

/**
 * Get available redaction categories.
 */
export function getRedactionCategories(): { name: string; description: string }[] {
  return [
    { name: 'phone', description: 'Phone numbers (partial mask)' },
    { name: 'ipv4', description: 'IPv4 addresses (partial mask)' },
    { name: 'sip-user', description: 'SIP URI user parts' },
    { name: 'auth', description: 'Authentication headers' },
    { name: 'crypto', description: 'SDP crypto keys' },
    { name: 'ice', description: 'ICE credentials' },
    { name: 'display-name', description: 'Display names' },
  ];
}
