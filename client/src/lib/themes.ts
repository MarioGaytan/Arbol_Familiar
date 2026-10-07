import type { CSSProperties } from 'react';
import type { EdgeStyle, Pattern, PhotoShape, TreeSettings } from '../types';

export interface Theme {
  id: string;
  name: string;
  bg: string;
  pattern: Pattern;
  patternColor: string;
  cardBg: string;
  cardBorder: string;
  text: string;
  muted: string;
  accent: string;
  edge: string;
  font: string;
  nameFont: string;
  titleFont: string;
  radius: number;
  photoShape: PhotoShape;
  edgeStyle: EdgeStyle;
  maleTint: string;
  femaleTint: string;
  /** Viñeta oscura en los bordes al exportar (efecto pergamino) */
  vignette?: boolean;
}

export const THEMES: Theme[] = [
  {
    id: 'clasico',
    name: 'Clásico',
    bg: '#f6f1e7',
    pattern: 'dots',
    patternColor: '#d9ccb4',
    cardBg: '#fffdf8',
    cardBorder: '#d8c7a6',
    text: '#3b2f22',
    muted: '#86735b',
    accent: '#8a5a2b',
    edge: '#8f7a5c',
    font: 'Lora, Georgia, serif',
    nameFont: '"Playfair Display", Georgia, serif',
    titleFont: '"Playfair Display", Georgia, serif',
    radius: 14,
    photoShape: 'circle',
    edgeStyle: 'smoothstep',
    maleTint: '#e7eef2',
    femaleTint: '#f6e8e4',
  },
  {
    id: 'moderno',
    name: 'Moderno',
    bg: '#f4f6fb',
    pattern: 'dots',
    patternColor: '#cfd6e6',
    cardBg: '#ffffff',
    cardBorder: '#e2e7f1',
    text: '#1d2433',
    muted: '#6b7590',
    accent: '#4f5bd5',
    edge: '#9aa5c4',
    font: 'Inter, system-ui, sans-serif',
    nameFont: 'Inter, system-ui, sans-serif',
    titleFont: 'Inter, system-ui, sans-serif',
    radius: 18,
    photoShape: 'rounded',
    edgeStyle: 'smoothstep',
    maleTint: '#eaf0ff',
    femaleTint: '#fdeef5',
  },
  {
    id: 'bosque',
    name: 'Bosque',
    bg: '#eef3ec',
    pattern: 'lines',
    patternColor: '#dbe6d6',
    cardBg: '#fbfdf9',
    cardBorder: '#b9d0b2',
    text: '#22372a',
    muted: '#5f7a66',
    accent: '#2f6f4f',
    edge: '#6e9578',
    font: 'Inter, system-ui, sans-serif',
    nameFont: 'Lora, Georgia, serif',
    titleFont: 'Lora, Georgia, serif',
    radius: 16,
    photoShape: 'circle',
    edgeStyle: 'default',
    maleTint: '#e5efe6',
    femaleTint: '#f3efe2',
  },
  {
    id: 'pergamino',
    name: 'Pergamino',
    bg: '#efe2c4',
    pattern: 'none',
    patternColor: '#e0cfa5',
    cardBg: '#f9f0da',
    cardBorder: '#a98a55',
    text: '#3d2b14',
    muted: '#7c6440',
    accent: '#7a4b1c',
    edge: '#7a5c32',
    font: 'Lora, Georgia, serif',
    nameFont: '"Great Vibes", "Playfair Display", cursive',
    titleFont: '"Great Vibes", "Playfair Display", cursive',
    radius: 6,
    photoShape: 'circle',
    edgeStyle: 'default',
    maleTint: '#f2e6c9',
    femaleTint: '#f5e3cf',
    vignette: true,
  },
  {
    id: 'noche',
    name: 'Noche',
    bg: '#141a2a',
    pattern: 'dots',
    patternColor: '#26304a',
    cardBg: '#1d2539',
    cardBorder: '#33405f',
    text: '#eef1f8',
    muted: '#9aa6c4',
    accent: '#e5b45b',
    edge: '#5d6b8f',
    font: 'Inter, system-ui, sans-serif',
    nameFont: '"Playfair Display", Georgia, serif',
    titleFont: '"Playfair Display", Georgia, serif',
    radius: 16,
    photoShape: 'circle',
    edgeStyle: 'smoothstep',
    maleTint: '#1f2a42',
    femaleTint: '#2a2238',
  },
  {
    id: 'pastel',
    name: 'Pastel',
    bg: '#fdf8f4',
    pattern: 'cross',
    patternColor: '#f1e2d6',
    cardBg: '#ffffff',
    cardBorder: '#f0d9cf',
    text: '#4a3b45',
    muted: '#9b8592',
    accent: '#d77a8f',
    edge: '#c9aab6',
    font: 'Inter, system-ui, sans-serif',
    nameFont: 'Lora, Georgia, serif',
    titleFont: '"Great Vibes", "Playfair Display", cursive',
    radius: 22,
    photoShape: 'circle',
    edgeStyle: 'default',
    maleTint: '#e6f1fb',
    femaleTint: '#fde8ef',
  },
];

export interface ResolvedTheme extends Theme {
  showDates: boolean;
  showRelations: boolean;
}

export function resolveTheme(s: TreeSettings = {}): ResolvedTheme {
  const base = THEMES.find((t) => t.id === s.preset) ?? THEMES[0];
  return {
    ...base,
    accent: s.accent ?? base.accent,
    edge: s.edgeColor ?? base.edge,
    bg: s.background ?? base.bg,
    photoShape: s.photoShape ?? base.photoShape,
    edgeStyle: s.edgeStyle ?? base.edgeStyle,
    pattern: s.pattern ?? base.pattern,
    showDates: s.showDates ?? true,
    showRelations: s.showRelations ?? true,
  };
}

/** Variables CSS que consumen las tarjetas y las líneas (y que se capturan al exportar). */
export function themeVars(t: ResolvedTheme): CSSProperties {
  return {
    '--bg': t.bg,
    '--card-bg': t.cardBg,
    '--card-border': t.cardBorder,
    '--text': t.text,
    '--muted': t.muted,
    '--accent': t.accent,
    '--edge': t.edge,
    '--font': t.font,
    '--name-font': t.nameFont,
    '--radius': `${t.radius}px`,
    '--male-tint': t.maleTint,
    '--female-tint': t.femaleTint,
    '--photo-radius': t.photoShape === 'circle' ? '50%' : t.photoShape === 'rounded' ? '22%' : '6px',
  } as CSSProperties;
}

export const SWATCHES = [
  '#8a5a2b', '#c0392b', '#d35400', '#e5b45b', '#2f6f4f', '#16a085',
  '#2c7be5', '#4f5bd5', '#8e44ad', '#d77a8f', '#5d6b8f', '#2d3436',
];
