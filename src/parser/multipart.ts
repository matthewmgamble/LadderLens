/**
 * MSGID multipart reassembly for v13 chunked SIP messages.
 *
 * v13 logs split large SIP messages into multiple parts:
 *   MSGID:426897 SIZE:820 PART:001-003
 *   ...content...
 *   MSGID:426897 SIZE:820 PART:002-003
 *   ...content...
 *   MSGID:426897 SIZE:540 PART:003-003
 *   ...content...
 *
 * Parts share the same MSGID and are numbered sequentially.
 * We buffer parts and emit the reassembled message when all parts arrive.
 */

export interface MsgIdPart {
  msgId: number;
  size: number;
  partNum: number;
  totalParts: number;
  content: string;
}

export interface ReassembledMessage {
  msgId: number;
  totalSize: number;
  content: string;
  partCount: number;
}

export class MultipartAssembler {
  private buffers = new Map<number, { parts: Map<number, string>; totalParts: number; totalSize: number }>();

  /**
   * Add a part. Returns the reassembled message if all parts are now present,
   * or null if still waiting for more parts.
   */
  addPart(part: MsgIdPart): ReassembledMessage | null {
    let buf = this.buffers.get(part.msgId);
    if (!buf) {
      buf = { parts: new Map(), totalParts: part.totalParts, totalSize: 0 };
      this.buffers.set(part.msgId, buf);
    }

    buf.parts.set(part.partNum, part.content);
    buf.totalSize += part.size;

    if (buf.parts.size === buf.totalParts) {
      // Reassemble in order
      const pieces: string[] = [];
      for (let i = 1; i <= buf.totalParts; i++) {
        pieces.push(buf.parts.get(i) ?? '');
      }
      this.buffers.delete(part.msgId);
      return {
        msgId: part.msgId,
        totalSize: buf.totalSize,
        content: pieces.join(''),
        partCount: buf.totalParts,
      };
    }

    return null;
  }

  /** Check if we're waiting on any incomplete messages */
  get pendingCount(): number {
    return this.buffers.size;
  }

  /** Clear all pending buffers */
  clear(): void {
    this.buffers.clear();
  }
}
