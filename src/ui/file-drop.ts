/**
 * File drop zone and progress UI.
 *
 * Renders a drag-and-drop target area with file picker fallback,
 * progress bar during parsing, and cancel support.
 */

import type { WorkerRequest, WorkerResponse } from '../worker/worker-protocol.js';
import type { ParseResult } from '../model/types.js';

export interface FileDropOptions {
  container: HTMLElement;
  onComplete: (result: ParseResult) => void;
  onError: (message: string) => void;
}

export class FileDrop {
  private container: HTMLElement;
  private onComplete: (result: ParseResult) => void;
  private onError: (message: string) => void;
  private worker: Worker | null = null;
  private dropZone!: HTMLElement;
  private progressBar!: HTMLElement;
  private progressFill!: HTMLElement;
  private progressText!: HTMLElement;
  private cancelBtn!: HTMLElement;
  private statusText!: HTMLElement;

  constructor(opts: FileDropOptions) {
    this.container = opts.container;
    this.onComplete = opts.onComplete;
    this.onError = opts.onError;
    this.render();
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="file-drop-zone" id="dropZone">
        <div class="file-drop-content">
          <svg class="file-drop-icon" viewBox="0 0 48 48" width="48" height="48">
            <path d="M24 4L12 16h8v12h8V16h8L24 4z" fill="currentColor" opacity="0.6"/>
            <path d="M8 36v4c0 2.2 1.8 4 4 4h24c2.2 0 4-1.8 4-4v-4H8z" fill="currentColor" opacity="0.4"/>
          </svg>
          <p class="file-drop-label">Drop a Ribbon SBC WebUI export here</p>
          <p class="file-drop-sublabel">or <button class="file-pick-btn" id="filePick">choose file</button></p>
          <p class="file-drop-hint">.log files up to 200MB</p>
        </div>
        <input type="file" id="fileInput" accept=".log,.txt" style="display:none">
      </div>
      <div class="file-progress" id="progressArea" style="display:none">
        <div class="progress-bar" id="progressBar">
          <div class="progress-fill" id="progressFill"></div>
        </div>
        <div class="progress-info">
          <span id="progressText">Parsing...</span>
          <button class="cancel-btn" id="cancelBtn">Cancel</button>
        </div>
      </div>
      <div class="file-status" id="statusText"></div>
    `;

    this.dropZone = this.container.querySelector('#dropZone')!;
    this.progressBar = this.container.querySelector('#progressBar')!;
    this.progressFill = this.container.querySelector('#progressFill')!;
    this.progressText = this.container.querySelector('#progressText')!;
    this.cancelBtn = this.container.querySelector('#cancelBtn')!;
    this.statusText = this.container.querySelector('#statusText')!;

    const fileInput = this.container.querySelector('#fileInput') as HTMLInputElement;
    const filePick = this.container.querySelector('#filePick')!;
    const progressArea = this.container.querySelector('#progressArea') as HTMLElement;

    // Drag and drop
    this.dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.dropZone.classList.add('drag-over');
    });
    this.dropZone.addEventListener('dragleave', () => {
      this.dropZone.classList.remove('drag-over');
    });
    this.dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dropZone.classList.remove('drag-over');
      const file = (e as DragEvent).dataTransfer?.files[0];
      if (file) this.startParse(file);
    });

    // File picker
    filePick.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) this.startParse(file);
      fileInput.value = '';
    });

    // Cancel
    this.cancelBtn.addEventListener('click', () => {
      if (this.worker) {
        const msg: WorkerRequest = { type: 'cancel' };
        this.worker.postMessage(msg);
      }
    });
  }

  private startParse(file: File): void {
    this.statusText.textContent = '';
    this.dropZone.style.display = 'none';
    const progressArea = this.container.querySelector('#progressArea') as HTMLElement;
    progressArea.style.display = 'block';
    this.progressFill.style.width = '0%';
    this.progressText.textContent = `Parsing ${file.name}...`;

    // Create worker
    this.worker = new Worker(
      new URL('../worker/parse-worker.ts', import.meta.url),
      { type: 'module' }
    );

    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;

      switch (msg.type) {
        case 'progress': {
          const pct = (msg.bytesProcessed / msg.totalBytes * 100).toFixed(1);
          this.progressFill.style.width = `${pct}%`;
          const mbDone = (msg.bytesProcessed / 1024 / 1024).toFixed(1);
          const mbTotal = (msg.totalBytes / 1024 / 1024).toFixed(1);
          this.progressText.textContent = `${mbDone}MB / ${mbTotal}MB — ${msg.linesProcessed.toLocaleString()} lines`;
          break;
        }
        case 'complete':
          this.cleanup();
          this.showDone(file.name, msg.result);
          this.onComplete(msg.result);
          break;
        case 'error':
          this.cleanup();
          this.showError(msg.message);
          this.onError(msg.message);
          break;
        case 'cancelled':
          this.cleanup();
          this.reset();
          break;
      }
    };

    this.worker.onerror = (err) => {
      this.cleanup();
      this.showError(err.message || 'Worker error');
      this.onError(err.message || 'Worker error');
    };

    const msg: WorkerRequest = { type: 'parse', file };
    this.worker.postMessage(msg);
  }

  private cleanup(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  private showDone(fileName: string, result: ParseResult): void {
    const progressArea = this.container.querySelector('#progressArea') as HTMLElement;
    progressArea.style.display = 'none';
    this.statusText.innerHTML = `
      <span class="status-success">Parsed <strong>${fileName}</strong>:
      ${result.calls.length} calls, ${result.totalLines.toLocaleString()} lines
      in ${(result.parseDurationMs / 1000).toFixed(1)}s</span>
    `;
  }

  private showError(message: string): void {
    const progressArea = this.container.querySelector('#progressArea') as HTMLElement;
    progressArea.style.display = 'none';
    this.dropZone.style.display = '';
    this.statusText.innerHTML = `<span class="status-error">${message}</span>`;
  }

  private reset(): void {
    const progressArea = this.container.querySelector('#progressArea') as HTMLElement;
    progressArea.style.display = 'none';
    this.dropZone.style.display = '';
    this.statusText.textContent = '';
  }

  /** Show the drop zone again (e.g. for loading a new file) */
  showDropZone(): void {
    this.reset();
  }
}
