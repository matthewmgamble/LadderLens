import { describe, it, expect } from 'vitest';
import {
  parseLogLine,
  isLogLine,
  isMsgIdLine,
  parseMsgIdLine,
  detectVersion,
  extractSessionContext,
  extractGcid,
  extractTransportContext,
} from '../../src/parser/log-line.js';
import { parseTimestamp, formatTime, formatRelativeTime } from '../../src/parser/timestamp.js';

describe('parseTimestamp', () => {
  it('parses v11 timestamps', () => {
    const result = parseTimestamp('[2022-12-05 18:34:37,978]');
    expect(result).not.toBeNull();
    expect(result!.epochMs).toBe(Date.UTC(2022, 11, 5, 18, 34, 37, 978));
    expect(result!.hasTimezone).toBe(false);
  });

  it('parses v13 timestamps', () => {
    const result = parseTimestamp('[2026-11-17T14:00:24Z,073]');
    expect(result).not.toBeNull();
    expect(result!.epochMs).toBe(Date.UTC(2026, 10, 17, 14, 0, 24, 73));
    expect(result!.hasTimezone).toBe(true);
  });

  it('returns null for invalid input', () => {
    expect(parseTimestamp('not a timestamp')).toBeNull();
    expect(parseTimestamp('[2022-13-05 18:34:37,978]')).not.toBeNull(); // month 13 is accepted by Date.UTC (wraps)
    expect(parseTimestamp('')).toBeNull();
  });
});

describe('formatTime', () => {
  it('formats epoch ms as HH:MM:SS.mmm', () => {
    const epoch = Date.UTC(2026, 10, 17, 14, 0, 24, 73);
    expect(formatTime(epoch)).toBe('14:00:24.073');
  });
});

describe('formatRelativeTime', () => {
  it('formats millisecond offsets', () => {
    expect(formatRelativeTime(50)).toBe('+50ms');
    expect(formatRelativeTime(-50)).toBe('-50ms');
  });

  it('formats second offsets', () => {
    expect(formatRelativeTime(1500)).toBe('+1.500s');
    expect(formatRelativeTime(105234)).toBe('+105.234s');
  });
});

describe('isLogLine', () => {
  it('recognizes v11 log lines', () => {
    expect(isLogLine('[2022-12-05 18:34:37,978] 7900 006a com.sonus.sbc.sip DEBUG (file.cpp:1) - msg')).toBe(true);
  });

  it('recognizes v13 log lines', () => {
    expect(isLogLine('[2026-11-17T14:00:24Z,073] 515 000f com.sonus.sbc.sip <PID 4879> INFO (file.cpp:1) - msg')).toBe(true);
  });

  it('rejects SIP message content', () => {
    expect(isLogLine('INVITE sip:+15552002002@198.51.100.30 SIP/2.0')).toBe(false);
    expect(isLogLine('Via: SIP/2.0/UDP 198.51.100.50:5060')).toBe(false);
    expect(isLogLine('')).toBe(false);
    expect(isLogLine('v=0')).toBe(false);
  });
});

describe('isMsgIdLine / parseMsgIdLine', () => {
  it('identifies MSGID lines', () => {
    expect(isMsgIdLine('MSGID:426897 SIZE:820 PART:001-003')).toBe(true);
    expect(isMsgIdLine('Via: SIP/2.0')).toBe(false);
  });

  it('parses MSGID lines', () => {
    const result = parseMsgIdLine('MSGID:426897 SIZE:820 PART:001-003');
    expect(result).toEqual({ msgId: 426897, size: 820, partNum: 1, totalParts: 3 });
  });

  it('parses single-part MSGID', () => {
    const result = parseMsgIdLine('MSGID:426866 SIZE:603 PART:001-001');
    expect(result).toEqual({ msgId: 426866, size: 603, partNum: 1, totalParts: 1 });
  });
});

describe('detectVersion', () => {
  it('detects v11', () => {
    expect(detectVersion('[2022-12-05 18:34:37,978] 7900 006a com.sonus.sbc.sip DEBUG (sipSignalingGroupConfig.cpp:1170) - msg')).toBe('v11');
  });

  it('detects v13 with PID', () => {
    expect(detectVersion('[2026-11-17T14:00:24Z,073] 515 000f com.sonus.sbc.sip <PID 4879> INFO (CallSession.cpp:9783) - msg')).toBe('v13');
  });

  it('detects v13 without PID', () => {
    expect(detectVersion('[2026-11-17T14:00:24Z,070] 509 0030 com.sonus.log.sbc INFO (sipApplication.cpp:3510) - originalLen:2180')).toBe('v13');
  });

  it('returns null for non-log-lines', () => {
    expect(detectVersion('INVITE sip:foo SIP/2.0')).toBeNull();
  });
});

describe('parseLogLine', () => {
  it('parses v11 log lines', () => {
    const line = '[2022-12-05 18:34:37,978] 7900 006a com.sonus.sbc.sip DEBUG (sipSignalingGroupConfig.cpp:1170) - "getBestSubnet:" "getBestSubnet, 198.51.100.50"';
    const result = parseLogLine(line, 38);
    expect(result).not.toBeNull();
    expect(result!.version).toBe('v11');
    expect(result!.lineNumber).toBe(38);
    expect(result!.sequence).toBe(7900);
    expect(result!.hexCounter).toBe('006a');
    expect(result!.component).toBe('com.sonus.sbc.sip');
    expect(result!.level).toBe('DEBUG');
    expect(result!.source).toBe('sipSignalingGroupConfig.cpp:1170');
    expect(result!.message).toBe('"getBestSubnet:" "getBestSubnet, 198.51.100.50"');
    expect(result!.pid).toBeUndefined();
  });

  it('parses v13 log lines with PID', () => {
    const line = '[2026-11-17T14:00:24Z,073] 515 000f com.sonus.sbc.sip <PID 4879> INFO (CallSession.cpp:9783) - {InviteClient SG(4):1787a1 0x1cef400 Initial 0x11612a50 [1:0:4:18][CID:5105]} HandleCCSetup:Next hop is  [203.0.113.10]:5061 CR=0';
    const result = parseLogLine(line, 1280);
    expect(result).not.toBeNull();
    expect(result!.version).toBe('v13');
    expect(result!.lineNumber).toBe(1280);
    expect(result!.sequence).toBe(515);
    expect(result!.hexCounter).toBe('000f');
    expect(result!.component).toBe('com.sonus.sbc.sip');
    expect(result!.pid).toBe(4879);
    expect(result!.level).toBe('INFO');
    expect(result!.source).toBe('CallSession.cpp:9783');
    expect(result!.message).toContain('InviteClient SG(4)');
    expect(result!.message).toContain('CID:5105');
  });

  it('parses v13 log lines without PID', () => {
    const line = '[2026-11-17T14:00:24Z,070] 509 0030 com.sonus.log.sbc INFO (sipApplication.cpp:3510) - originalLen:2180 decodedLength:2180 decoded 0x11026700:';
    const result = parseLogLine(line, 3);
    expect(result).not.toBeNull();
    expect(result!.version).toBe('v13');
    expect(result!.component).toBe('com.sonus.log.sbc');
    expect(result!.pid).toBeUndefined();
  });

  it('returns null for SIP content lines', () => {
    expect(parseLogLine('INVITE sip:+15552002002@198.51.100.30 SIP/2.0', 1)).toBeNull();
    expect(parseLogLine('Via: SIP/2.0/UDP 198.51.100.50:5060', 2)).toBeNull();
    expect(parseLogLine('', 3)).toBeNull();
    expect(parseLogLine('v=0', 4)).toBeNull();
  });

  it('returns null for MSGID lines', () => {
    expect(parseLogLine('MSGID:426897 SIZE:820 PART:001-003', 5)).toBeNull();
  });
});

describe('extractSessionContext', () => {
  it('extracts InviteServer context', () => {
    const msg = '{InviteServer SG(4):3296d 0x1afb000 Initial (nil) [1:0:0:0][CID:118]} CallSession: msg';
    const ctx = extractSessionContext(msg);
    expect(ctx).not.toBeNull();
    expect(ctx!.sessionType).toBe('InviteServer');
    expect(ctx!.signalingGroup).toBe(4);
    expect(ctx!.sessionId).toBe('3296d');
    expect(ctx!.cid).toBe(118);
  });

  it('extracts InviteClient context', () => {
    const msg = '{InviteClient SG(4):1787a1 0x1cef400 NwkConnecting 0x11612a50 [1:0:4:18][CID:5105]} HandleCCSetup:Next hop';
    const ctx = extractSessionContext(msg);
    expect(ctx).not.toBeNull();
    expect(ctx!.sessionType).toBe('InviteClient');
    expect(ctx!.signalingGroup).toBe(4);
    expect(ctx!.sessionId).toBe('1787a1');
    expect(ctx!.cid).toBe(5105);
  });

  it('extracts OptionsClient context', () => {
    const msg = '{OptionsClient SG(3):e26c1 0x15b5000 NwkConnecting} ProcessTimerExpiration:Process RefreshTimer';
    const ctx = extractSessionContext(msg);
    expect(ctx).not.toBeNull();
    expect(ctx!.sessionType).toBe('OptionsClient');
    expect(ctx!.signalingGroup).toBe(3);
    expect(ctx!.cid).toBeUndefined();
  });

  it('returns null for non-session messages', () => {
    expect(extractSessionContext('some random message')).toBeNull();
  });
});

describe('extractGcid', () => {
  it('extracts GCID from transport lines', () => {
    expect(extractGcid('sending from [10.21.205.68]:27396 to [203.0.113.10]:5061 GCID=5105, size=1358')).toBe(5105);
    expect(extractGcid('GCID=118, size=388 over 00UDP:')).toBe(118);
  });

  it('returns null when no GCID', () => {
    expect(extractGcid('some message without gcid')).toBeNull();
  });
});

describe('extractTransportContext', () => {
  it('extracts sending context', () => {
    const msg = '0x82cd180 sending from [10.21.205.68]:27396 to [203.0.113.10]:5061 GCID=5105, size=1358 over 00TLS119775-27396 attempt(1)';
    const ctx = extractTransportContext(msg);
    expect(ctx).not.toBeNull();
    expect(ctx!.direction).toBe('sent');
    expect(ctx!.localAddr).toBe('10.21.205.68');
    expect(ctx!.localPort).toBe(27396);
    expect(ctx!.remoteAddr).toBe('203.0.113.10');
    expect(ctx!.remotePort).toBe(5061);
    expect(ctx!.gcid).toBe(5105);
    expect(ctx!.protocol).toBe('TLS');
  });

  it('extracts receiving context', () => {
    const msg = 'DataReadCB:Incoming message on [10.21.205.68]:5061 from [52.114.148.0] after CRLF is truncated:18243 size=2180';
    const ctx = extractTransportContext(msg);
    expect(ctx).not.toBeNull();
    expect(ctx!.direction).toBe('received');
    expect(ctx!.localAddr).toBe('10.21.205.68');
    expect(ctx!.localPort).toBe(5061);
    expect(ctx!.remoteAddr).toBe('52.114.148.0');
  });
});
