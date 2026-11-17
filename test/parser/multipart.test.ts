import { describe, it, expect } from 'vitest';
import { MultipartAssembler } from '../../src/parser/multipart.js';

describe('MultipartAssembler', () => {
  it('passes through single-part messages immediately', () => {
    const asm = new MultipartAssembler();
    const result = asm.addPart({
      msgId: 426866,
      size: 603,
      partNum: 1,
      totalParts: 1,
      content: 'OPTIONS sip:foo SIP/2.0\r\nContent-Length: 0\r\n\r\n',
    });
    expect(result).not.toBeNull();
    expect(result!.msgId).toBe(426866);
    expect(result!.content).toContain('OPTIONS');
    expect(result!.partCount).toBe(1);
    expect(asm.pendingCount).toBe(0);
  });

  it('reassembles multi-part messages in order', () => {
    const asm = new MultipartAssembler();

    const r1 = asm.addPart({
      msgId: 426897,
      size: 820,
      partNum: 1,
      totalParts: 3,
      content: 'INVITE sip:foo SIP/2.0\nFrom: bar\n',
    });
    expect(r1).toBeNull();
    expect(asm.pendingCount).toBe(1);

    const r2 = asm.addPart({
      msgId: 426897,
      size: 820,
      partNum: 2,
      totalParts: 3,
      content: 'To: baz\nContent-Type: application/sdp\n',
    });
    expect(r2).toBeNull();

    const r3 = asm.addPart({
      msgId: 426897,
      size: 540,
      partNum: 3,
      totalParts: 3,
      content: '\nv=0\nm=audio 50332 RTP/AVP 0\n',
    });
    expect(r3).not.toBeNull();
    expect(r3!.msgId).toBe(426897);
    expect(r3!.partCount).toBe(3);
    expect(r3!.content).toContain('INVITE sip:foo');
    expect(r3!.content).toContain('To: baz');
    expect(r3!.content).toContain('v=0');
    expect(asm.pendingCount).toBe(0);
  });

  it('handles out-of-order parts', () => {
    const asm = new MultipartAssembler();

    asm.addPart({ msgId: 100, size: 100, partNum: 2, totalParts: 2, content: 'part2' });
    const result = asm.addPart({ msgId: 100, size: 100, partNum: 1, totalParts: 2, content: 'part1' });
    expect(result).not.toBeNull();
    expect(result!.content).toBe('part1part2');
  });

  it('handles multiple concurrent message IDs', () => {
    const asm = new MultipartAssembler();

    asm.addPart({ msgId: 100, size: 50, partNum: 1, totalParts: 2, content: 'A1' });
    asm.addPart({ msgId: 200, size: 50, partNum: 1, totalParts: 2, content: 'B1' });
    expect(asm.pendingCount).toBe(2);

    const r1 = asm.addPart({ msgId: 100, size: 50, partNum: 2, totalParts: 2, content: 'A2' });
    expect(r1).not.toBeNull();
    expect(r1!.content).toBe('A1A2');
    expect(asm.pendingCount).toBe(1);

    const r2 = asm.addPart({ msgId: 200, size: 50, partNum: 2, totalParts: 2, content: 'B2' });
    expect(r2).not.toBeNull();
    expect(r2!.content).toBe('B1B2');
    expect(asm.pendingCount).toBe(0);
  });
});
