/**
 * SVG export — download the ladder diagram as an SVG file.
 */

export function exportSvg(svgSource: string, filename: string): void {
  if (!svgSource) return;
  const blob = new Blob([svgSource], { type: 'image/svg+xml' });
  downloadBlob(blob, `${filename}.svg`);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
