import { getNodesBounds, getViewportForBounds, type Node } from '@xyflow/react';
import { toPng, toSvg } from 'html-to-image';
import { jsPDF } from 'jspdf';
import type { ResolvedTheme } from './themes';

export interface PaperSize {
  id: string;
  label: string;
  w: number; // mm (vertical)
  h: number;
  group: 'Hoja' | 'Cartel / póster';
}

export const PAPERS: PaperSize[] = [
  { id: 'letter', label: 'Carta (21,6 × 27,9 cm)', w: 215.9, h: 279.4, group: 'Hoja' },
  { id: 'legal', label: 'Oficio (21,6 × 35,6 cm)', w: 215.9, h: 355.6, group: 'Hoja' },
  { id: 'a4', label: 'A4 (21 × 29,7 cm)', w: 210, h: 297, group: 'Hoja' },
  { id: 'tabloid', label: 'Tabloide (27,9 × 43,2 cm)', w: 279.4, h: 431.8, group: 'Hoja' },
  { id: 'a3', label: 'A3 (29,7 × 42 cm)', w: 297, h: 420, group: 'Cartel / póster' },
  { id: 'a2', label: 'A2 (42 × 59,4 cm)', w: 420, h: 594, group: 'Cartel / póster' },
  { id: 'a1', label: 'A1 (59,4 × 84,1 cm)', w: 594, h: 841, group: 'Cartel / póster' },
  { id: 'a0', label: 'A0 (84,1 × 118,9 cm)', w: 841, h: 1189, group: 'Cartel / póster' },
  { id: 'p18x24', label: 'Póster 18 × 24 in (45,7 × 61 cm)', w: 457.2, h: 609.6, group: 'Cartel / póster' },
  { id: 'p24x36', label: 'Póster 24 × 36 in (61 × 91,4 cm)', w: 609.6, h: 914.4, group: 'Cartel / póster' },
];

export type Orientation = 'auto' | 'portrait' | 'landscape';
export type Format = 'pdf' | 'png' | 'svg' | 'ged';

export interface ExportOptions {
  format: Format;
  paperId: string; // 'fit' = ajustar al árbol
  orientation: Orientation;
  dpi: number;
  marginMm: number;
  title: string;
  subtitle: string;
  frame: boolean;
  /** Dividir en varias hojas (para imprimir un cartel en casa y pegarlo) */
  tileOn: 'none' | 'letter' | 'a4';
}

const MAX_SIDE = 16000;
const MAX_AREA = 150_000_000; // límite seguro de canvas en Chrome/Firefox
const mmToPx = (mm: number, dpi: number) => Math.round((mm / 25.4) * dpi);

function viewportEl() {
  const el = document.querySelector<HTMLElement>('.react-flow__viewport');
  if (!el) throw new Error('No se encontró el lienzo');
  return el;
}

/** Tamaño final en mm, considerando orientación y el modo "ajustar al árbol". */
export function resolvePaper(o: ExportOptions, nodes: Node[]) {
  const b = getNodesBounds(nodes);
  if (o.paperId === 'fit') {
    // 1 px de pantalla ≈ 0,35 mm a escala 1:1; se agranda un poco para que se lea bien
    const scale = 0.32;
    const titleMm = o.title ? 30 : 0;
    return { wMm: b.width * scale + o.marginMm * 2, hMm: b.height * scale + o.marginMm * 2 + titleMm, bounds: b };
  }
  const p = PAPERS.find((x) => x.id === o.paperId) ?? PAPERS[0];
  const landscape = o.orientation === 'landscape' || (o.orientation === 'auto' && b.width > b.height * 1.05);
  return landscape ? { wMm: p.h, hMm: p.w, bounds: b } : { wMm: p.w, hMm: p.h, bounds: b };
}

/** Ajusta los DPI si el lienzo sería demasiado grande para el navegador. */
export function safeDpi(wMm: number, hMm: number, dpi: number) {
  let d = dpi;
  while (d > 40 && (mmToPx(wMm, d) > MAX_SIDE || mmToPx(hMm, d) > MAX_SIDE || mmToPx(wMm, d) * mmToPx(hMm, d) > MAX_AREA)) d -= 10;
  return d;
}

/** Dibuja el árbol completo en un canvas del tamaño del papel, con título, márgenes y marco. */
export async function renderToCanvas(o: ExportOptions, nodes: Node[], theme: ResolvedTheme, dpiOverride?: number) {
  const { wMm, hMm, bounds } = resolvePaper(o, nodes);
  const dpi = dpiOverride ?? safeDpi(wMm, hMm, o.dpi);
  const W = mmToPx(wMm, dpi);
  const H = mmToPx(hMm, dpi);
  const margin = mmToPx(o.marginMm, dpi);
  const unit = Math.min(W, H) / 100; // escala tipográfica relativa al papel

  const titleH = o.title ? unit * (o.subtitle ? 12 : 9) : 0;
  const contentW = W - margin * 2;
  const contentH = H - margin * 2 - titleH;

  const vp = getViewportForBounds(bounds, contentW, contentH, 0.01, 20, 0.04);
  const dataUrl = await toPng(viewportEl(), {
    width: contentW,
    height: contentH,
    pixelRatio: 1,
    cacheBust: false,
    style: {
      width: `${contentW}px`,
      height: `${contentH}px`,
      transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`,
    },
  });

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);
  if (theme.vignette) {
    const grad = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(90,60,20,0.28)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }
  if (o.frame) {
    ctx.strokeStyle = theme.accent;
    const m = margin * 0.45;
    ctx.lineWidth = Math.max(2, unit * 0.35);
    ctx.strokeRect(m, m, W - m * 2, H - m * 2);
    ctx.lineWidth = Math.max(1, unit * 0.12);
    const m2 = m + unit * 0.9;
    ctx.strokeRect(m2, m2, W - m2 * 2, H - m2 * 2);
  }
  if (o.title) {
    const titleFont = theme.titleFont;
    const script = titleFont.includes('Great Vibes');
    const size = unit * (script ? 7.5 : 5.5);
    const weight = script ? 400 : 700;
    await document.fonts.load(`${weight} ${size}px ${titleFont}`).catch(() => undefined);
    ctx.fillStyle = theme.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${weight} ${size}px ${titleFont}`;
    ctx.fillText(o.title, W / 2, margin + titleH * (o.subtitle ? 0.4 : 0.5), W - margin * 2);
    if (o.subtitle) {
      ctx.fillStyle = theme.muted;
      ctx.font = `400 ${unit * 2.2}px ${theme.font}`;
      ctx.fillText(o.subtitle, W / 2, margin + titleH * 0.8, W - margin * 2);
    }
  }
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  ctx.drawImage(img, margin, margin + titleH);
  return { canvas, wMm, hMm, dpi };
}

function download(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
}

const slug = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'arbol';

export async function exportTree(o: ExportOptions, nodes: Node[], theme: ResolvedTheme) {
  const name = slug(o.title);

  if (o.format === 'svg') {
    const b = getNodesBounds(nodes);
    const pad = 60;
    const w = Math.round(b.width + pad * 2);
    const h = Math.round(b.height + pad * 2);
    const url = await toSvg(viewportEl(), {
      width: w,
      height: h,
      backgroundColor: theme.bg,
      style: { width: `${w}px`, height: `${h}px`, transform: `translate(${pad - b.x}px, ${pad - b.y}px) scale(1)` },
    });
    download(url, `${name}.svg`);
    return { dpi: 0 };
  }

  const { canvas, wMm, hMm, dpi } = await renderToCanvas(o, nodes, theme);

  if (o.format === 'png') {
    const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/png'));
    const url = URL.createObjectURL(blob);
    download(url, `${name}.png`);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return { dpi };
  }

  // PDF
  if (o.tileOn === 'none') {
    const pdf = new jsPDF({ orientation: wMm > hMm ? 'landscape' : 'portrait', unit: 'mm', format: [wMm, hMm] });
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, wMm, hMm);
    pdf.save(`${name}.pdf`);
    return { dpi };
  }

  // Mosaico: cada hoja lleva un trozo con 8 mm de solape para recortar y pegar
  const sheet = PAPERS.find((p) => p.id === (o.tileOn === 'a4' ? 'a4' : 'letter'))!;
  const landscape = wMm > hMm;
  const sw = landscape ? sheet.h : sheet.w;
  const sh = landscape ? sheet.w : sheet.h;
  const printable = 6; // margen no imprimible típico
  const overlap = 8;
  const stepW = sw - printable * 2 - overlap;
  const stepH = sh - printable * 2 - overlap;
  const cols = Math.ceil((wMm - overlap) / stepW);
  const rows = Math.ceil((hMm - overlap) / stepH);
  const pxPerMm = canvas.width / wMm;

  const pdf = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: [sw, sh] });
  const tile = document.createElement('canvas');
  const tw = Math.round((stepW + overlap) * pxPerMm);
  const th = Math.round((stepH + overlap) * pxPerMm);
  tile.width = tw;
  tile.height = th;
  const tctx = tile.getContext('2d')!;
  let first = true;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!first) pdf.addPage([sw, sh], landscape ? 'landscape' : 'portrait');
      first = false;
      tctx.fillStyle = '#ffffff';
      tctx.fillRect(0, 0, tw, th);
      tctx.drawImage(canvas, Math.round(c * stepW * pxPerMm), Math.round(r * stepH * pxPerMm), tw, th, 0, 0, tw, th);
      pdf.addImage(tile.toDataURL('image/jpeg', 0.92), 'JPEG', printable, printable, stepW + overlap, stepH + overlap);
      // guías de solape
      pdf.setDrawColor(160);
      pdf.setLineDashPattern([1.5, 1.5], 0);
      pdf.setLineWidth(0.2);
      pdf.line(printable + stepW, printable, printable + stepW, printable + stepH + overlap);
      pdf.line(printable, printable + stepH, printable + stepW + overlap, printable + stepH);
      pdf.setFontSize(7);
      pdf.setTextColor(120);
      pdf.text(`Fila ${r + 1}/${rows} · Columna ${c + 1}/${cols}  —  pega encima de la línea punteada`, printable, sh - 2);
    }
  }
  pdf.save(`${name}-mosaico-${rows}x${cols}.pdf`);
  return { dpi, sheets: rows * cols };
}
