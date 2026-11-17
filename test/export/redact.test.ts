import { describe, it, expect } from 'vitest';
import { redactText } from '../../src/export/redact.js';

describe('redactText', () => {
  it('masks phone numbers', () => {
    expect(redactText('+15551001001')).toBe('+1555***1001');
    expect(redactText('sip:+15555005005@host')).toBe('sip:+1555***5005@host');
  });

  it('masks IP addresses', () => {
    expect(redactText('c=IN IP4 52.115.232.218')).toBe('c=IN IP4 52.XX.XX.218');
  });

  it('redacts SIP user URIs', () => {
    expect(redactText('sip:john.smith@example.com')).toBe('sip:REDACTED@example.com');
  });

  it('redacts crypto keys', () => {
    expect(redactText('a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:3kQfXAP83YPhEiAVSriZVQ4gGbiqzCe/9KUH8qw7|2^31'))
      .toContain('inline:[REDACTED]');
  });

  it('redacts ICE passwords', () => {
    expect(redactText('a=ice-pwd:TgXwoDJxkbmnZPll4bGt0GpD')).toBe('a=ice-pwd:[REDACTED]');
  });

  it('redacts display names', () => {
    expect(redactText('"john.smith" <sip:+15556006006@host>')).toContain('"REDACTED"');
  });

  it('supports selective categories', () => {
    const text = '+15551001001 at 10.56.20.193';
    const result = redactText(text, { categories: ['phone'] });
    expect(result).toContain('+1555***1001');
    expect(result).toContain('10.56.20.193'); // IP not redacted
  });
});
