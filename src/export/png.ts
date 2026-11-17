/**
 * PNG export — render SVG to canvas and download as PNG.
 */

import { downloadBlob } from './svg.js';

export async function exportPng(svgSource: string, filename: string): Promise<void> {
  if (!svgSource) return;

  return new Promise((resolve) => {
    const img = new Image();
    const svgBlob = new Blob([svgSource], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = 2; // Retina
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(scale, scale);

      // Dark background
      ctx.fillStyle = '#0f1117';
      ctx.fillRect(0, 0, img.width, img.height);
      ctx.drawImage(img, 0, 0);

      canvas.toBlob((blob) => {
        if (blob) downloadBlob(blob, `${filename}.png`);
        URL.revokeObjectURL(url);
        resolve();
      }, 'image/png');
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve();
    };

    img.src = url;
  });
}
