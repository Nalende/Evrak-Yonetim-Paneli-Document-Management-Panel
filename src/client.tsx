import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Circle,
  Code2,
  Compass,
  Copy,
  Download,
  Edit2,
  ExternalLink,
  Eye,
  EyeOff,
  FileCheck2,
  FileText,
  FileUp,
  FolderOpen,
  FolderPlus,
  Globe,
  GraduationCap,
  Grid,
  GripHorizontal,
  GripVertical,
  Hand,
  KeyRound,
  Layers,
  Loader2,
  Lock,
  LogIn,
  LogOut,
  MapPin,
  Maximize2,
  Menu,
  Mouse,
  MousePointer,
  MousePointerClick,
  Pause,
  Play,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  RotateCcw,
  Scale,
  Search,
  Settings,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Unlock,
  Upload,
  Volume2,
  VolumeX,
  X,
  XCircle,
  Zap,
  ZoomOut,
} from 'lucide-react';
import { nanoid } from 'nanoid';
import { PageFlip } from 'page-flip';
import { create } from 'zustand';
import './styles.css';

// ============================================================================
// 1. TİPLER VE SABİTLER (TYPES & DIMENSIONS)
// ============================================================================

export type PaperSize = 'A4' | 'A3';
export type HotspotShape = 'rect' | 'ellipse' | 'pin';

export interface Hotspot {
  id: string;
  shape: HotspotShape;
  x: number;
  y: number;
  width: number;
  height: number;
  title?: string;
  message: string;
}

export interface PageItem {
  id: string;
  orderIndex: number;
  imageUrl: string;
  thumbnailUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  paperSize: PaperSize;
  sourceFileName: string;
  hotspots: Hotspot[];
  createdAt: string;
}

export interface FolderItem {
  id: string;
  ownerId?: string;
  title: string;
  description?: string;
  category?: string;
  isPublished?: boolean;
  shareToken?: string;
  sharePin?: string;
  viewCount?: number;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
  pages: PageItem[];
}

export interface AuthUser {
  id: string;
  username: string;
  email?: string;
  displayName: string;
  workspaceTitle: string;
  workspaceSubtitle: string;
  workspaceSlug: string;
  shareToken: string;
  workspacePin?: string;
  authProvider: 'local' | 'google';
  hasPassword?: boolean;
  avatarUrl?: string;
  role: 'superadmin' | 'user';
  createdAt: string;
}

export interface PublicWorkspace {
  id: string;
  displayName: string;
  workspaceTitle: string;
  workspaceSubtitle: string;
  workspaceSlug: string;
  shareToken: string;
  hasPin: boolean;
}

export interface ScreenCutoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  shape: 'rect' | 'ellipse' | 'pin';
}

export const DEFAULT_GOOGLE_CLIENT_ID = '';

export function extractCleanGoogleClientId(raw?: string): string {
  if (!raw || typeof raw !== 'string') return '';
  const m = raw.match(/([0-9]+-[a-zA-Z0-9_]+\.apps\.googleusercontent\.com)/i);
  return m ? m[1] : '';
}

export function isSafeAvatarUrl(url?: string): boolean {
  if (!url || typeof url !== 'string') return false;
  return url.startsWith('https://') || url.startsWith('/media/');
}

export const FOLDER_DIMENSIONS = {
  BACK_WIDTH: 240,
  BACK_HEIGHT: 317,
  FLAP_START_X: 18,
  FLAP_WIDTH: 102,
  EYELET_X: 12,
  EYELET_Y1: 118.5,
  EYELET_Y2: 198.5,
  BOX_X1: 31,
  BOX_Y1: 28,
  BOX_Y2: 278,
  BOX_WIDTH: 77,
  BOX_HEIGHT: 250,
  FLAP_BOTTOM_CREASE_Y: 288,
  BOX_HORIZONTAL_LINES_Y: [28, 43, 58, 73, 88, 146, 161, 176, 233, 248, 263, 278] as const,
} as const;

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

const AUTH_TOKEN_KEY = 'belediye_auth_token';

function getStoredToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

function setStoredToken(token: string | null) {
  try {
    if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
    else localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {
    // ignore
  }
}

// ============================================================================
// 2. SIFIR BAĞIMLILIK ISO/IEC 18004 VEKTÖREL QR KOD ÜRETİCİSİ
// ============================================================================

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function rsComputeEc(data: Uint8Array, ecLen: number): Uint8Array {
  const gen = rsGeneratorPoly(ecLen);
  const res = new Uint8Array(data.length + ecLen);
  res.set(data);
  for (let i = 0; i < data.length; i++) {
    const coef = res[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        res[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return res.slice(data.length);
}

interface QrVersionSpec {
  version: number;
  dataBytes: number;
  ecPerBlock: number;
  blocks: number[];
  align: number[];
  remBits: number;
}

// ISO/IEC 18004 ECC Level M Specs (Versions 1..12)
const QR_M_SPECS: QrVersionSpec[] = [
  { version: 1, dataBytes: 16, ecPerBlock: 10, blocks: [16], align: [], remBits: 0 },
  { version: 2, dataBytes: 28, ecPerBlock: 16, blocks: [28], align: [6, 18], remBits: 7 },
  { version: 3, dataBytes: 44, ecPerBlock: 26, blocks: [44], align: [6, 22], remBits: 7 },
  { version: 4, dataBytes: 64, ecPerBlock: 18, blocks: [32, 32], align: [6, 26], remBits: 7 },
  { version: 5, dataBytes: 86, ecPerBlock: 24, blocks: [43, 43], align: [6, 30], remBits: 7 },
  { version: 6, dataBytes: 108, ecPerBlock: 16, blocks: [27, 27, 27, 27], align: [6, 34], remBits: 7 },
  { version: 7, dataBytes: 124, ecPerBlock: 18, blocks: [31, 31, 31, 31], align: [6, 22, 38], remBits: 0 },
  { version: 8, dataBytes: 154, ecPerBlock: 22, blocks: [38, 38, 39, 39], align: [6, 24, 42], remBits: 0 },
  { version: 9, dataBytes: 182, ecPerBlock: 22, blocks: [36, 36, 36, 37, 37], align: [6, 26, 46], remBits: 0 },
  { version: 10, dataBytes: 216, ecPerBlock: 26, blocks: [43, 43, 43, 43, 44], align: [6, 28, 50], remBits: 0 },
  { version: 11, dataBytes: 254, ecPerBlock: 30, blocks: [50, 51, 51, 51, 51], align: [6, 30, 54], remBits: 0 },
  { version: 12, dataBytes: 290, ecPerBlock: 22, blocks: [36, 36, 36, 36, 36, 36, 37, 37], align: [6, 32, 58], remBits: 0 },
];

function computeBchFormat(data5: number): number {
  let d = data5 << 10;
  const gen = 0x537;
  for (let i = 14; i >= 10; i--) {
    if ((d >> i) & 1) d ^= gen << (i - 10);
  }
  return ((data5 << 10) | d) ^ 0x5412;
}

function computeBchVersion(version6: number): number {
  let d = version6 << 12;
  const gen = 0x1f25;
  for (let i = 17; i >= 12; i--) {
    if ((d >> i) & 1) d ^= gen << (i - 12);
  }
  return (version6 << 12) | d;
}

function generateQrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  const spec =
    QR_M_SPECS.find((s) => {
      const countBits = s.version <= 9 ? 8 : 16;
      return 4 + countBits + bytes.length * 8 <= s.dataBytes * 8;
    }) || QR_M_SPECS[QR_M_SPECS.length - 1];

  const version = spec.version;
  const size = 17 + version * 4;
  const countBits = version <= 9 ? 8 : 16;

  // Build data bits
  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };
  pushBits(0b0100, 4); // Byte mode
  pushBits(bytes.length, countBits);
  for (const b of bytes) pushBits(b, 8);
  const maxBits = spec.dataBytes * 8;
  for (let i = 0; i < 4 && bits.length < maxBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const dataCodewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    dataCodewords.push(v);
  }
  let padToggle = 0;
  while (dataCodewords.length < spec.dataBytes) {
    dataCodewords.push(padToggle % 2 === 0 ? 0xec : 0x11);
    padToggle++;
  }

  // Split blocks and compute EC
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  for (const bLen of spec.blocks) {
    const blk = new Uint8Array(dataCodewords.slice(offset, offset + bLen));
    dataBlocks.push(blk);
    ecBlocks.push(rsComputeEc(blk, spec.ecPerBlock));
    offset += bLen;
  }

  // Interleave
  const allCodewords: number[] = [];
  const maxDataLen = Math.max(...spec.blocks);
  for (let i = 0; i < maxDataLen; i++) {
    for (const blk of dataBlocks) {
      if (i < blk.length) allCodewords.push(blk[i]);
    }
  }
  for (let i = 0; i < spec.ecPerBlock; i++) {
    for (const ec of ecBlocks) {
      allCodewords.push(ec[i]);
    }
  }

  const finalBits: number[] = [];
  for (const cw of allCodewords) {
    for (let i = 7; i >= 0; i--) finalBits.push((cw >> i) & 1);
  }
  for (let i = 0; i < spec.remBits; i++) finalBits.push(0);

  // Initialize base matrix
  const baseModules: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const isFunc: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  const setFunc = (r: number, c: number, dark: boolean) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      baseModules[r][c] = dark;
      isFunc[r][c] = true;
    }
  };

  const drawFinder = (top: number, left: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = top + r;
        const cc = left + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const isDark =
          r >= 0 &&
          r <= 6 &&
          c >= 0 &&
          c <= 6 &&
          (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        setFunc(rr, cc, isDark);
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Dark module
  setFunc(size - 8, 8, true);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (!isFunc[6][i]) setFunc(6, i, i % 2 === 0);
    if (!isFunc[i][6]) setFunc(i, 6, i % 2 === 0);
  }

  // Alignment patterns
  const alignCoords = spec.align;
  for (const ar of alignCoords) {
    for (const ac of alignCoords) {
      if (isFunc[ar][ac]) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const isDark = Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0);
          setFunc(ar + dr, ac + dc, isDark);
        }
      }
    }
  }

  // Reserve format info cells
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      isFunc[8][i] = true;
      isFunc[i][8] = true;
    }
  }
  for (let i = size - 8; i < size; i++) {
    isFunc[8][i] = true;
    isFunc[i][8] = true;
  }

  // Version info (V7+)
  if (version >= 7) {
    const vBits = computeBchVersion(version);
    for (let i = 0; i < 18; i++) {
      const dark = ((vBits >> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = size - 11 + (i % 3);
      setFunc(a, b, dark);
      setFunc(b, a, dark);
    }
  }

  // Place data bits in zigzag
  let bitIdx = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        const upward = ((right + 1) & 2) === 0;
        const r = upward ? size - 1 - vert : vert;
        if (!isFunc[r][c] && bitIdx < finalBits.length) {
          baseModules[r][c] = finalBits[bitIdx++] === 1;
        }
      }
    }
  }

  // Evaluate all 8 masks and pick lowest penalty
  const maskFns = [
    (r: number, c: number) => (r + c) % 2 === 0,
    (r: number) => r % 2 === 0,
    (_r: number, c: number) => c % 3 === 0,
    (r: number, c: number) => (r + c) % 3 === 0,
    (r: number, c: number) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r: number, c: number) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r: number, c: number) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r: number, c: number) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ];

  let bestMask = 0;
  let bestScore = Infinity;
  let bestMatrix: boolean[][] = baseModules;

  for (let m = 0; m < 8; m++) {
    const grid = baseModules.map((row, r) =>
      row.map((val, c) => (!isFunc[r][c] && maskFns[m](r, c) ? !val : val))
    );

    // Format bits for Level M (00) + mask (3 bits)
    const fmt = computeBchFormat((0b00 << 3) | m);
    for (let i = 0; i < 6; i++) grid[8][i] = ((fmt >> i) & 1) === 1;
    grid[8][7] = ((fmt >> 6) & 1) === 1;
    grid[8][8] = ((fmt >> 7) & 1) === 1;
    grid[7][8] = ((fmt >> 8) & 1) === 1;
    for (let i = 9; i < 15; i++) grid[14 - i][8] = ((fmt >> i) & 1) === 1;

    for (let i = 0; i < 8; i++) grid[size - 1 - i][8] = ((fmt >> i) & 1) === 1;
    for (let i = 8; i < 15; i++) grid[8][size - 15 + i] = ((fmt >> i) & 1) === 1;

    // Penalty score
    let score = 0;
    for (let r = 0; r < size; r++) {
      let runLen = 1;
      for (let c = 1; c < size; c++) {
        if (grid[r][c] === grid[r][c - 1]) {
          runLen++;
          if (runLen === 5) score += 3;
          else if (runLen > 5) score += 1;
        } else {
          runLen = 1;
        }
      }
    }
    for (let c = 0; c < size; c++) {
      let runLen = 1;
      for (let r = 1; r < size; r++) {
        if (grid[r][c] === grid[r - 1][c]) {
          runLen++;
          if (runLen === 5) score += 3;
          else if (runLen > 5) score += 1;
        } else {
          runLen = 1;
        }
      }
    }
    for (let r = 0; r < size - 1; r++) {
      for (let c = 0; c < size - 1; c++) {
        const v = grid[r][c];
        if (grid[r][c + 1] === v && grid[r + 1][c] === v && grid[r + 1][c + 1] === v) {
          score += 3;
        }
      }
    }

    let darkCount = 0;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (grid[r][c]) darkCount++;
      }
    }
    const percent = (darkCount * 100) / (size * size);
    score += Math.floor(Math.abs(percent - 50) / 5) * 10;

    if (score < bestScore) {
      bestScore = score;
      bestMask = m;
      bestMatrix = grid;
    }
  }
  void bestMask;
  return bestMatrix;
}

export const QrCodeSvg: React.FC<{ value: string; size?: number; className?: string }> = ({
  value,
  size = 220,
  className = '',
}) => {
  const matrix = useMemo(() => generateQrMatrix(value), [value]);
  const n = matrix.length;
  const quiet = 4;
  const total = n + quiet * 2;

  const rects: string[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (matrix[r][c]) {
        rects.push(`M${c + quiet},${r + quiet}h1v1h-1z`);
      }
    }
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${total} ${total}`}
      shapeRendering="crispEdges"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width={total} height={total} fill="#ffffff" />
      <path d={rects.join('')} fill="#0f172a" />
    </svg>
  );
};

function renderQrPosterDataUrl(
  url: string,
  title: string,
  subtitle: string,
  badge: string
): string {
  const matrix = generateQrMatrix(url);
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 1220;
  const ctx = canvas.getContext('2d')!;

  // Background
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Inner card
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(44, 44, canvas.width - 88, canvas.height - 88, 28);
  ctx.fill();

  // Header band
  ctx.fillStyle = '#f59e0b';
  ctx.beginPath();
  ctx.roundRect(44, 44, canvas.width - 88, 128, [28, 28, 0, 0]);
  ctx.fill();

  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 26px "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(badge.toLocaleUpperCase('tr-TR'), canvas.width / 2, 102);

  ctx.font = '600 18px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = '#1e293b';
  ctx.fillText('3D FİZİKSEL DOSYA VE EVRAK DİZİLİM REHBERİ', canvas.width / 2, 140);

  // Title
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 34px "Segoe UI", Arial, sans-serif';
  const words = title.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width <= 720) cur = t;
    else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  lines.slice(0, 2).forEach((ln, i) => {
    ctx.fillText(ln, canvas.width / 2, 245 + i * 44);
  });

  // Subtitle
  ctx.fillStyle = '#475569';
  ctx.font = '500 21px "Segoe UI", Arial, sans-serif';
  ctx.fillText(subtitle.slice(0, 64), canvas.width / 2, 345);

  // QR Box
  const qrSize = 480;
  const qrX = (canvas.width - qrSize) / 2;
  const qrY = 395;

  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(qrX - 24, qrY - 24, qrSize + 48, qrSize + 48, 24);
  ctx.stroke();

  const n = matrix.length;
  const quiet = 4;
  const total = n + quiet * 2;
  const cell = qrSize / total;
  ctx.fillStyle = '#0f172a';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (matrix[r][c]) {
        ctx.fillRect(
          Math.floor(qrX + (c + quiet) * cell),
          Math.floor(qrY + (r + quiet) * cell),
          Math.ceil(cell),
          Math.ceil(cell)
        );
      }
    }
  }

  // Instructions
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 24px "Segoe UI", Arial, sans-serif';
  ctx.fillText('TELEFON KAMERASI İLE QR KODU OKUTUN', canvas.width / 2, 955);

  ctx.fillStyle = '#475569';
  ctx.font = '500 20px "Segoe UI", Arial, sans-serif';
  ctx.fillText(
    'Evrak dizilim sırasını, A3 katlama şeklini ve kritik uyarıları',
    canvas.width / 2,
    995
  );
  ctx.fillText('adım adım 3 boyutlu olarak inceleyebilirsiniz.', canvas.width / 2, 1025);

  // URL box at bottom
  ctx.fillStyle = '#f1f5f9';
  ctx.beginPath();
  ctx.roundRect(96, 1068, canvas.width - 192, 64, 14);
  ctx.fill();
  ctx.fillStyle = '#334155';
  ctx.font = '600 18px monospace';
  ctx.fillText(url.length > 58 ? `${url.slice(0, 55)}...` : url, canvas.width / 2, 1106);

  return canvas.toDataURL('image/png');
}

function downloadQrPosterPng(url: string, title: string, subtitle: string, badge: string) {
  const dataUrl = renderQrPosterDataUrl(url, title, subtitle, badge);
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `QR-Rehber-${title.replace(/[^a-zA-Z0-9_-]+/g, '_')}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function printQrPoster(url: string, title: string, subtitle: string, badge: string) {
  const dataUrl = renderQrPosterDataUrl(url, title, subtitle, badge);
  const win = window.open('', '_blank', 'width=720,height=920');
  if (!win) return;
  const doc = win.document;
  doc.title = `${title} — QR Rehber Kartı`;
  doc.body.innerHTML = '';
  doc.body.setAttribute(
    'style',
    'margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#fff;'
  );
  const img = doc.createElement('img');
  img.src = dataUrl;
  img.alt = `${title} QR Kodu`;
  img.setAttribute('style', 'max-width:94vw;max-height:94vh;');
  img.addEventListener('load', () => {
    setTimeout(() => win.print(), 250);
  });
  doc.body.appendChild(img);
}

// ============================================================================
// 3. REST API İSTEMCİSİ (API CLIENT)
// ============================================================================

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(init?.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    let errMsg = `İstek başarısız (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error?.message) errMsg = data.error.message;
    } catch {
      // ignore
    }
    throw new Error(errMsg);
  }
  return res.json() as Promise<T>;
}

export interface AuthStatusResponse {
  needsInitialSetup: boolean;
  allowPublicRegistration: boolean;
  googleClientId: string;
  user: AuthUser | null;
}

export interface AuthSuccessResponse {
  token: string;
  user: AuthUser;
}

export interface PublicWorkspaceResponse {
  requiresPin: boolean;
  workspace: PublicWorkspace;
  folders: FolderItem[];
}

export interface PublicFolderResponse {
  requiresPin: boolean;
  title?: string;
  folder?: FolderItem;
  workspace?: PublicWorkspace | null;
}

export const apiClient = {
  async getAuthStatus(): Promise<AuthStatusResponse> {
    return requestJson<AuthStatusResponse>('/api/auth/status');
  },
  async setupInitialAdmin(payload: {
    username: string;
    password: string;
    displayName: string;
    workspaceTitle?: string;
    workspaceSubtitle?: string;
  }): Promise<AuthSuccessResponse> {
    return requestJson<AuthSuccessResponse>('/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },
  async login(payload: { username: string; password: string }): Promise<AuthSuccessResponse> {
    return requestJson<AuthSuccessResponse>('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },
  async register(payload: {
    username: string;
    password: string;
    displayName: string;
    email?: string;
    workspaceTitle?: string;
  }): Promise<AuthSuccessResponse> {
    return requestJson<AuthSuccessResponse>('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },
  async loginGoogle(payload: {
    credential?: string;
    accessToken?: string;
  }): Promise<AuthSuccessResponse> {
    return requestJson<AuthSuccessResponse>('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },
  async saveGoogleClientId(googleClientId: string): Promise<{ googleClientId: string }> {
    return requestJson<{ googleClientId: string }>('/api/auth/google/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ googleClientId }),
    });
  },
  async updateWorkspaceSettings(payload: {
    username?: string;
    displayName?: string;
    workspaceTitle?: string;
    workspaceSubtitle?: string;
    workspaceSlug?: string;
    workspacePin?: string;
    newPassword?: string;
    googleClientId?: string;
    allowPublicRegistration?: boolean;
  }): Promise<{ user: AuthUser; googleClientId: string; allowPublicRegistration: boolean }> {
    return requestJson('/api/workspace/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },

  async getPublicWorkspace(identifier: string, pin?: string): Promise<PublicWorkspaceResponse> {
    const qs = pin ? `?pin=${encodeURIComponent(pin)}` : '';
    return requestJson<PublicWorkspaceResponse>(
      `/api/public/workspace/${encodeURIComponent(identifier)}${qs}`
    );
  },
  async getPublicFolder(
    identifier: string,
    pin?: string,
    workspaceId?: string
  ): Promise<PublicFolderResponse> {
    const params = new URLSearchParams();
    if (pin) params.set('pin', pin);
    if (workspaceId) params.set('workspace', workspaceId);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return requestJson<PublicFolderResponse>(
      `/api/public/folder/${encodeURIComponent(identifier)}${qs}`
    );
  },

  async listFolders(pin?: string): Promise<{
    folders: FolderItem[];
    workspace?: PublicWorkspace | null;
    requiresPin?: boolean;
  }> {
    const qs = pin ? `?pin=${encodeURIComponent(pin)}` : '';
    return requestJson(`/api/folders${qs}`);
  },
  async getFolder(folderId: string, pin?: string): Promise<PublicFolderResponse> {
    const qs = pin ? `?pin=${encodeURIComponent(pin)}` : '';
    return requestJson<PublicFolderResponse>(`/api/folders/${encodeURIComponent(folderId)}${qs}`);
  },
  async createFolder(title?: string): Promise<FolderItem> {
    const data = await requestJson<{ folder: FolderItem }>('/api/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(title ? { title } : {}),
    });
    return data.folder;
  },
  async updateFolder(
    folderId: string,
    payload: {
      title?: string;
      description?: string;
      category?: string;
      isPublished?: boolean;
      sharePin?: string;
    }
  ): Promise<FolderItem> {
    const data = await requestJson<{ folder: FolderItem }>(`/api/folders/${folderId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return data.folder;
  },
  async renameFolder(folderId: string, title: string): Promise<FolderItem> {
    return this.updateFolder(folderId, { title });
  },
  async deleteFolder(folderId: string): Promise<void> {
    await requestJson<{ success: boolean }>(`/api/folders/${folderId}`, { method: 'DELETE' });
  },
  async reorderFolders(folderIds: string[]): Promise<FolderItem[]> {
    const data = await requestJson<{ folders: FolderItem[] }>('/api/folders/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderIds }),
    });
    return data.folders;
  },
  async uploadPages(
    folderId: string,
    files: File[],
    insertAtIndex?: number
  ): Promise<{ folder: FolderItem; addedPages: PageItem[] }> {
    const form = new FormData();
    for (const f of files) form.append('files', f);
    if (insertAtIndex !== undefined) form.append('insertAtIndex', String(insertAtIndex));
    return requestJson<{ folder: FolderItem; addedPages: PageItem[] }>(
      `/api/folders/${folderId}/pages`,
      { method: 'POST', body: form }
    );
  },
  async replacePageDocument(folderId: string, pageId: string, file: File): Promise<FolderItem> {
    const form = new FormData();
    form.append('file', file);
    const data = await requestJson<{ folder: FolderItem }>(
      `/api/folders/${folderId}/pages/${pageId}/replace`,
      { method: 'POST', body: form }
    );
    return data.folder;
  },
  async updatePage(
    folderId: string,
    pageId: string,
    payload: { paperSize?: PaperSize; hotspots?: Hotspot[] }
  ): Promise<FolderItem> {
    const data = await requestJson<{ folder: FolderItem }>(
      `/api/folders/${folderId}/pages/${pageId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );
    return data.folder;
  },
  async deletePage(folderId: string, pageId: string): Promise<FolderItem> {
    const data = await requestJson<{ folder: FolderItem }>(
      `/api/folders/${folderId}/pages/${pageId}`,
      { method: 'DELETE' }
    );
    return data.folder;
  },
  async reorderPages(folderId: string, pageIds: string[]): Promise<FolderItem> {
    const data = await requestJson<{ folder: FolderItem }>(
      `/api/folders/${folderId}/pages/reorder`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageIds }),
      }
    );
    return data.folder;
  },
};

// ============================================================================
// 4. SES SENTEZLEYİCİ, POPOVER KONUMLANDIRICI & FLIPBOOK YAPRAK ÜRETİCİSİ
// ============================================================================

let audioCtx: AudioContext | null = null;
let isMuted = false;

export function setPageSoundMuted(muted: boolean) {
  isMuted = muted;
}

export function getPageSoundMuted(): boolean {
  return isMuted;
}

export function playPaperTurnSound() {
  if (isMuted || typeof window === 'undefined') return;
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    if (!audioCtx) audioCtx = new AudioContextClass();
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});

    const duration = 0.24;
    const sampleRate = audioCtx.sampleRate;
    const bufferSize = Math.floor(sampleRate * duration);
    const buffer = audioCtx.createBuffer(1, bufferSize, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      const t = i / bufferSize;
      const env = Math.sin(t * Math.PI) * Math.pow(1 - t, 0.7);
      data[i] = (Math.random() * 2 - 1) * env * 0.28;
    }

    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1400, audioCtx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(2600, audioCtx.currentTime + duration * 0.6);
    filter.Q.setValueAtTime(1.4, audioCtx.currentTime);

    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.01, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0.22, audioCtx.currentTime + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.005, audioCtx.currentTime + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);
    noise.start();
  } catch {
    // ignore
  }
}

export function computeSmartPopoverPlacement(
  target: ScreenCutoutRect,
  viewportWidth: number,
  viewportHeight: number,
  cardWidth = 360,
  cardHeight = 215
) {
  const gap = 20;
  const margin = 16;

  if (target.x + target.width + gap + cardWidth <= viewportWidth - margin) {
    return {
      left: target.x + target.width + gap,
      top: clamp(target.centerY - cardHeight / 2, margin + 64, viewportHeight - cardHeight - margin - 72),
      placement: 'right' as const,
    };
  }
  if (target.x - gap - cardWidth >= margin) {
    return {
      left: target.x - gap - cardWidth,
      top: clamp(target.centerY - cardHeight / 2, margin + 64, viewportHeight - cardHeight - margin - 72),
      placement: 'left' as const,
    };
  }
  if (target.y + target.height + gap + cardHeight <= viewportHeight - margin - 60) {
    return {
      left: clamp(target.centerX - cardWidth / 2, margin, viewportWidth - cardWidth - margin),
      top: target.y + target.height + gap,
      placement: 'bottom' as const,
    };
  }
  return {
    left: clamp(target.centerX - cardWidth / 2, margin, viewportWidth - cardWidth - margin),
    top: clamp(target.y - gap - cardHeight, margin + 68, viewportHeight - cardHeight - margin - 72),
    placement: 'top' as const,
  };
}

const FLIPBOOK_SHEET_W = 960;
const FLIPBOOK_SHEET_H = 1358;
const FLIPBOOK_BLANK_DATA_URL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

function releaseCanvasMemory(canvas: HTMLCanvasElement | null | undefined) {
  if (!canvas) return;
  try {
    canvas.width = 0;
    canvas.height = 0;
  } catch {
    // ignore
  }
}

function drawKraftBackground(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  variant: 'front' | 'inside' | 'back'
) {
  const grad = ctx.createLinearGradient(x, y, x + w, y + h);
  if (variant === 'front') {
    grad.addColorStop(0, '#c8a67b');
    grad.addColorStop(0.55, '#bc996e');
    grad.addColorStop(1, '#ae8b60');
  } else if (variant === 'inside') {
    grad.addColorStop(0, '#be9b70');
    grad.addColorStop(1, '#a88459');
  } else {
    grad.addColorStop(0, '#b59268');
    grad.addColorStop(1, '#9d7a50');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);

  for (let i = 0; i < 1600; i++) {
    const rx = x + Math.random() * w;
    const ry = y + Math.random() * h;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(55, 38, 20, 0.04)' : 'rgba(255, 235, 205, 0.03)';
    ctx.fillRect(rx, ry, 2, 2);
  }
}

function drawEyeletsOnLeftMargin(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const scale = w / 760;
  const holeX = Math.round(28 * scale);
  const ys = [h * 0.37, h * 0.63];
  for (const cy of ys) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(holeX, cy, 11 * scale, 0, Math.PI * 2);
    ctx.fillStyle = '#57534e';
    ctx.fill();
    ctx.lineWidth = 2.5 * scale;
    ctx.strokeStyle = '#a8a29e';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(holeX, cy, 6 * scale, 0, Math.PI * 2);
    ctx.fillStyle = '#1c1917';
    ctx.fill();
    ctx.restore();
  }
}

function renderCoverFrontCanvas(
  folder: FolderItem,
  _firstPageImg: HTMLImageElement | null,
  w = FLIPBOOK_SHEET_W,
  h = FLIPBOOK_SHEET_H
): HTMLCanvasElement {
  const scale = w / 760;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Yalnızca yarım kapak kanadını (0..flapW) çiz; flapW..w arası şeffaf kalır ki alttaki 1. sayfa görünsün
  ctx.clearRect(0, 0, w, h);

  const flapW = Math.round(w * 0.52);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(0, 0, flapW, h, [4 * scale, 18 * scale, 18 * scale, 4 * scale]);
  ctx.clip();

  drawKraftBackground(ctx, 0, 0, flapW, h, 'front');

  ctx.strokeStyle = 'rgba(65, 45, 25, 0.45)';
  ctx.lineWidth = 2 * scale;
  ctx.beginPath();
  ctx.moveTo(52 * scale, 0);
  ctx.lineTo(52 * scale, h);
  ctx.stroke();

  drawEyeletsOnLeftMargin(ctx, w, h);

  const boxX = Math.round(76 * scale);
  const boxY = Math.round((FOLDER_DIMENSIONS.BOX_Y1 / 317) * h);
  const boxW = flapW - Math.round(102 * scale);
  const boxH = Math.round((FOLDER_DIMENSIONS.BOX_HEIGHT / 317) * h);

  ctx.strokeStyle = '#2b2118';
  ctx.lineWidth = 2.4 * scale;
  ctx.strokeRect(boxX, boxY, boxW, boxH);

  for (const lineYMm of FOLDER_DIMENSIONS.BOX_HORIZONTAL_LINES_Y) {
    if (lineYMm === FOLDER_DIMENSIONS.BOX_Y1 || lineYMm === FOLDER_DIMENSIONS.BOX_Y2) continue;
    const yPx = Math.round((lineYMm / 317) * h);
    ctx.beginPath();
    ctx.moveTo(boxX, yPx);
    ctx.lineTo(boxX + boxW, yPx);
    ctx.stroke();
  }

  ctx.save();
  ctx.fillStyle = '#172554';
  ctx.font = `bold ${Math.round(21 * scale)}px "Segoe UI", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const words = folder.title.toLocaleUpperCase('tr-TR').split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(test).width <= boxW - 20 * scale) {
      cur = test;
    } else {
      if (cur) lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);

  const centerY = Math.round(((88 + 146) / 2 / 317) * h);
  const lineH = Math.round(26 * scale);
  const startY = centerY - ((lines.length - 1) * lineH) / 2;
  lines.slice(0, 4).forEach((ln, i) => {
    ctx.fillText(ln, boxX + boxW / 2, startY + i * lineH);
  });
  ctx.restore();

  ctx.save();
  ctx.fillStyle = 'rgba(43, 33, 24, 0.75)';
  ctx.font = `bold ${Math.round(13 * scale)}px "Segoe UI", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('RESMİ BAŞVURU DOSYASI', boxX + boxW / 2, Math.round((198 / 317) * h));
  ctx.font = `600 ${Math.round(11 * scale)}px "Segoe UI", Arial, sans-serif`;
  ctx.fillText(
    `TOPLAM ${folder.pages.length} EVRAK SAYFASI`,
    boxX + boxW / 2,
    Math.round((214 / 317) * h)
  );
  ctx.restore();

  // Sağ yarım kapak kenar çerçevesi (dış kenar dokusu için ince kenarlık)
  ctx.strokeStyle = 'rgba(55, 38, 20, 0.35)';
  ctx.lineWidth = 1.5 * scale;
  ctx.beginPath();
  ctx.roundRect(0, 0, flapW, h, [4 * scale, 18 * scale, 18 * scale, 4 * scale]);
  ctx.stroke();

  ctx.restore();
  return canvas;
}

function renderCoverInsideLeftCanvas(
  folder: FolderItem,
  w = FLIPBOOK_SHEET_W,
  h = FLIPBOOK_SHEET_H
): HTMLCanvasElement {
  const scale = w / 760;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.clearRect(0, 0, w, h);

  const flapW = Math.round(w * 0.52);
  const startX = w - flapW;

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(startX, 0, flapW, h, [18 * scale, 4 * scale, 4 * scale, 18 * scale]);
  ctx.clip();

  drawKraftBackground(ctx, startX, 0, flapW, h, 'inside');

  const padX = Math.round(24 * scale);
  const padY = Math.round(48 * scale);
  const boxX = startX + padX;
  const boxW = flapW - padX * 2;
  const boxH = h - padY * 2;

  ctx.fillStyle = 'rgba(255, 252, 245, 0.88)';
  ctx.strokeStyle = '#6e5032';
  ctx.lineWidth = 2 * scale;
  ctx.beginPath();
  ctx.roundRect(boxX, padY, boxW, boxH, 10 * scale);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#1e293b';
  ctx.font = `bold ${Math.round(17 * scale)}px "Segoe UI", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('EVRAK DİZİLİM SIRASI', boxX + boxW / 2, padY + Math.round(42 * scale));

  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1.5 * scale;
  ctx.beginPath();
  ctx.moveTo(boxX + 18 * scale, padY + 60 * scale);
  ctx.lineTo(boxX + boxW - 18 * scale, padY + 60 * scale);
  ctx.stroke();

  const sorted = [...folder.pages].sort((a, b) => a.orderIndex - b.orderIndex);
  ctx.textAlign = 'left';
  sorted.slice(0, 14).forEach((p, idx) => {
    const y = padY + Math.round((98 + idx * 38) * scale);
    ctx.fillStyle = '#b45309';
    ctx.font = `bold ${Math.round(14 * scale)}px "Segoe UI", Arial, sans-serif`;
    ctx.fillText(`${idx + 1}.`, boxX + 20 * scale, y);

    ctx.fillStyle = '#0f172a';
    ctx.font = `600 ${Math.round(13 * scale)}px "Segoe UI", Arial, sans-serif`;
    ctx.fillText(p.sourceFileName.slice(0, 22), boxX + 44 * scale, y);
  });

  const spineW = Math.round(40 * scale);
  const spineGrad = ctx.createLinearGradient(w - spineW, 0, w, 0);
  spineGrad.addColorStop(0, 'rgba(0,0,0,0)');
  spineGrad.addColorStop(1, 'rgba(0,0,0,0.32)');
  ctx.fillStyle = spineGrad;
  ctx.fillRect(w - spineW, 0, spineW, h);

  ctx.restore();
  return canvas;
}

function renderPaperBackLeftCanvas(
  pageIndex: number,
  totalPages: number,
  sourceName: string,
  w = FLIPBOOK_SHEET_W,
  h = FLIPBOOK_SHEET_H
): HTMLCanvasElement {
  const scale = w / 760;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#fcfbf9';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(203, 213, 225, 0.45)';
  ctx.lineWidth = 2 * scale;
  ctx.strokeRect(48 * scale, 48 * scale, w - 96 * scale, h - 96 * scale);

  ctx.fillStyle = '#94a3b8';
  ctx.font = `bold ${Math.round(18 * scale)}px "Segoe UI", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(`${pageIndex + 1}. EVRAK ARKA YÜZÜ`, w / 2, h / 2 - 14 * scale);
  ctx.font = `${Math.round(15 * scale)}px "Segoe UI", Arial, sans-serif`;
  ctx.fillText(`(${sourceName})`, w / 2, h / 2 + 16 * scale);

  const holeX = w - 28 * scale;
  for (const cy of [h * 0.37, h * 0.63]) {
    ctx.beginPath();
    ctx.arc(holeX, cy, 7 * scale, 0, Math.PI * 2);
    ctx.fillStyle = '#cbd5e1';
    ctx.fill();
  }

  const spineW = 50 * scale;
  const spineGrad = ctx.createLinearGradient(w - spineW, 0, w, 0);
  spineGrad.addColorStop(0, 'rgba(0,0,0,0)');
  spineGrad.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = spineGrad;
  ctx.fillRect(w - spineW, 0, spineW, h);

  ctx.fillStyle = '#64748b';
  ctx.font = `bold ${Math.round(13 * scale)}px "Segoe UI", Arial, sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText(`${pageIndex + 1} / ${totalPages}`, 56 * scale, h - 26 * scale);

  return canvas;
}

function renderDocumentFrontRightCanvas(
  img: HTMLImageElement,
  pageIndex: number,
  totalPages: number,
  paperSize: 'A4' | 'A3',
  w = FLIPBOOK_SHEET_W,
  h = FLIPBOOK_SHEET_H
): HTMLCanvasElement {
  const scale = w / 760;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  drawKraftBackground(ctx, 0, 0, w, h, 'back');

  const marginR = Math.round(20 * scale);
  const marginY = Math.round(18 * scale);
  const pw = w - marginR;
  const ph = h - marginY * 2;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 10 * scale;
  ctx.shadowOffsetX = 3 * scale;
  ctx.shadowOffsetY = 2 * scale;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, marginY, pw, ph);
  ctx.restore();

  if (paperSize === 'A3') {
    const srcSliceW = img.width / 4;
    ctx.drawImage(img, 0, 0, srcSliceW, img.height, 0, marginY, pw / 2, ph);
    ctx.drawImage(img, srcSliceW * 3, 0, srcSliceW, img.height, pw / 2, marginY, pw / 2, ph);

    const foldGrad = ctx.createLinearGradient(pw / 2 - 18 * scale, 0, pw / 2 + 8 * scale, 0);
    foldGrad.addColorStop(0, 'rgba(0,0,0,0)');
    foldGrad.addColorStop(0.7, 'rgba(0,0,0,0.24)');
    foldGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = foldGrad;
    ctx.fillRect(pw / 2 - 18 * scale, marginY, 26 * scale, ph);

    ctx.strokeStyle = '#d97706';
    ctx.setLineDash([8 * scale, 6 * scale]);
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.moveTo(pw / 2, marginY);
    ctx.lineTo(pw / 2, marginY + ph);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    const imgRatio = img.width / img.height;
    const pageRatio = pw / ph;
    let drawW = pw;
    let drawH = ph;
    let drawX = 0;
    let drawY = marginY;

    if (Math.abs(imgRatio - pageRatio) > 0.06) {
      if (imgRatio > pageRatio) {
        drawW = pw;
        drawH = pw / imgRatio;
        drawY = marginY + (ph - drawH) / 2;
      } else {
        drawH = ph;
        drawW = ph * imgRatio;
        drawX = (pw - drawW) / 2;
      }
    }
    ctx.drawImage(img, drawX, drawY, drawW, drawH);
  }

  const holeX = 26 * scale;
  for (const cy of [h * 0.37, h * 0.63]) {
    ctx.beginPath();
    ctx.arc(holeX, cy, 7 * scale, 0, Math.PI * 2);
    ctx.fillStyle = '#6b533b';
    ctx.fill();
    ctx.lineWidth = 1.5 * scale;
    ctx.strokeStyle = '#94a3b8';
    ctx.stroke();
  }

  const spineW = 48 * scale;
  const spineGrad = ctx.createLinearGradient(0, 0, spineW, 0);
  spineGrad.addColorStop(0, 'rgba(0,0,0,0.26)');
  spineGrad.addColorStop(0.5, 'rgba(0,0,0,0.06)');
  spineGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = spineGrad;
  ctx.fillRect(0, 0, spineW, h);

  ctx.fillStyle = '#475569';
  ctx.font = `bold ${Math.round(13 * scale)}px "Segoe UI", Arial, sans-serif`;
  ctx.textAlign = 'right';
  ctx.fillText(`Sayfa ${pageIndex + 1} / ${totalPages}`, pw - 20 * scale, marginY + ph - 16 * scale);

  return canvas;
}

function renderBackCoverCanvas(
  w = FLIPBOOK_SHEET_W,
  h = FLIPBOOK_SHEET_H
): HTMLCanvasElement {
  const scale = w / 760;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  drawKraftBackground(ctx, 0, 0, w, h, 'back');
  drawEyeletsOnLeftMargin(ctx, w, h);

  const spineW = 48 * scale;
  const spineGrad = ctx.createLinearGradient(0, 0, spineW, 0);
  spineGrad.addColorStop(0, 'rgba(0,0,0,0.30)');
  spineGrad.addColorStop(0.5, 'rgba(0,0,0,0.08)');
  spineGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = spineGrad;
  ctx.fillRect(0, 0, spineW, h);

  ctx.save();
  ctx.strokeStyle = 'rgba(65, 45, 25, 0.28)';
  ctx.lineWidth = 2 * scale;
  ctx.strokeRect(64 * scale, 54 * scale, w - 112 * scale, h - 108 * scale);

  ctx.fillStyle = 'rgba(55, 38, 22, 0.55)';
  ctx.font = `bold ${Math.round(16 * scale)}px "Segoe UI", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('DOSYA ARKA KAPAK İÇ YÜZÜ', w / 2, h / 2 - 10 * scale);
  ctx.font = `600 ${Math.round(13 * scale)}px "Segoe UI", Arial, sans-serif`;
  ctx.fillText('(Tüm Evraklar İncelendi)', w / 2, h / 2 + 16 * scale);
  ctx.restore();

  return canvas;
}

// ============================================================================
// 5. DURUM YÖNETİMİ (ZUSTAND STORES: AUTH, ADMIN & VIEWER)
// ============================================================================

interface AuthState {
  user: AuthUser | null;
  pendingGoogleOnboarding: boolean;
  needsInitialSetup: boolean;
  allowPublicRegistration: boolean;
  googleClientId: string;
  isInitializing: boolean;
  isSubmitting: boolean;
  error: string | null;

  checkAuthStatus: () => Promise<void>;
  clearError: () => void;
  setError: (msg: string | null) => void;
  setupInitialAdmin: (payload: {
    username: string;
    password: string;
    displayName: string;
    workspaceTitle?: string;
    workspaceSubtitle?: string;
  }) => Promise<boolean>;
  login: (username: string, password: string) => Promise<boolean>;
  register: (payload: {
    username: string;
    password: string;
    displayName: string;
    email?: string;
    workspaceTitle?: string;
  }) => Promise<boolean>;
  loginWithGoogleCredential: (credential: string) => Promise<boolean>;
  loginWithGoogleAccessToken: (accessToken: string) => Promise<boolean>;
  saveGoogleClientId: (googleClientId: string) => Promise<boolean>;
  finishGoogleOnboarding: () => void;
  updateWorkspaceSettings: (payload: {
    username?: string;
    displayName?: string;
    workspaceTitle?: string;
    workspaceSubtitle?: string;
    workspaceSlug?: string;
    workspacePin?: string;
    newPassword?: string;
    googleClientId?: string;
    allowPublicRegistration?: boolean;
  }) => Promise<boolean>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  pendingGoogleOnboarding: false,
  needsInitialSetup: false,
  allowPublicRegistration: true,
  googleClientId: DEFAULT_GOOGLE_CLIENT_ID,
  isInitializing: true,
  isSubmitting: false,
  error: null,

  clearError: () => set({ error: null }),
  setError: (msg) => set({ error: msg }),

  checkAuthStatus: async () => {
    set({ isInitializing: true, error: null });
    try {
      const status = await apiClient.getAuthStatus();
      if (!status.user && getStoredToken()) {
        setStoredToken(null);
      }
      set({
        needsInitialSetup: status.needsInitialSetup,
        allowPublicRegistration: status.allowPublicRegistration,
        googleClientId:
          extractCleanGoogleClientId(status.googleClientId) || DEFAULT_GOOGLE_CLIENT_ID,
        user: status.user,
        isInitializing: false,
      });
    } catch (err: any) {
      set({
        isInitializing: false,
        error: err.message || 'Oturum durumu kontrol edilemedi.',
      });
    }
  },

  setupInitialAdmin: async (payload) => {
    set({ isSubmitting: true, error: null });
    try {
      const res = await apiClient.setupInitialAdmin(payload);
      setStoredToken(res.token);
      set({
        user: res.user,
        pendingGoogleOnboarding: false,
        needsInitialSetup: false,
        isSubmitting: false,
      });
      return true;
    } catch (err: any) {
      set({ isSubmitting: false, error: err.message || 'Kurulum tamamlanamadı.' });
      return false;
    }
  },

  login: async (username, password) => {
    set({ isSubmitting: true, error: null });
    try {
      const res = await apiClient.login({ username, password });
      setStoredToken(res.token);
      set({ user: res.user, pendingGoogleOnboarding: false, isSubmitting: false });
      return true;
    } catch (err: any) {
      set({ isSubmitting: false, error: err.message || 'Giriş yapılamadı.' });
      return false;
    }
  },

  register: async (payload) => {
    set({ isSubmitting: true, error: null });
    try {
      const res = await apiClient.register(payload);
      setStoredToken(res.token);
      set({
        user: res.user,
        pendingGoogleOnboarding: false,
        needsInitialSetup: false,
        isSubmitting: false,
      });
      return true;
    } catch (err: any) {
      set({ isSubmitting: false, error: err.message || 'Kayıt oluşturulamadı.' });
      return false;
    }
  },

  loginWithGoogleCredential: async (credential) => {
    set({ isSubmitting: true, error: null });
    try {
      const res = await apiClient.loginGoogle({ credential });
      setStoredToken(res.token);
      set({
        user: res.user,
        pendingGoogleOnboarding: true,
        needsInitialSetup: false,
        isSubmitting: false,
      });
      return true;
    } catch (err: any) {
      set({ isSubmitting: false, error: err.message || 'Google ile giriş yapılamadı.' });
      return false;
    }
  },

  loginWithGoogleAccessToken: async (accessToken) => {
    set({ isSubmitting: true, error: null });
    try {
      const res = await apiClient.loginGoogle({ accessToken });
      setStoredToken(res.token);
      set({
        user: res.user,
        pendingGoogleOnboarding: true,
        needsInitialSetup: false,
        isSubmitting: false,
      });
      return true;
    } catch (err: any) {
      set({ isSubmitting: false, error: err.message || 'Google bağlantısı başarısız.' });
      return false;
    }
  },

  saveGoogleClientId: async (googleClientId) => {
    set({ isSubmitting: true, error: null });
    try {
      const res = await apiClient.saveGoogleClientId(googleClientId);
      set({
        googleClientId: res.googleClientId,
        isSubmitting: false,
      });
      return true;
    } catch (err: any) {
      set({
        isSubmitting: false,
        error: err.message || 'Google Client ID kaydedilemedi.',
      });
      return false;
    }
  },

  finishGoogleOnboarding: () => set({ pendingGoogleOnboarding: false, error: null }),

  updateWorkspaceSettings: async (payload) => {
    set({ isSubmitting: true, error: null });
    try {
      const res = await apiClient.updateWorkspaceSettings(payload);
      set({
        user: res.user,
        googleClientId: res.googleClientId,
        allowPublicRegistration: res.allowPublicRegistration,
        isSubmitting: false,
      });
      return true;
    } catch (err: any) {
      set({ isSubmitting: false, error: err.message || 'Ayarlar güncellenemedi.' });
      return false;
    }
  },

  logout: () => {
    setStoredToken(null);
    set({ user: null, pendingGoogleOnboarding: false, error: null });
  },
}));

interface AdminState {
  folders: FolderItem[];
  selectedFolderId: string | null;
  editingFolderId: string | null;
  activeHotspotPageId: string | null;
  isLoading: boolean;
  isUploading: boolean;
  uploadMessage: string | null;
  error: string | null;

  fetchFolders: () => Promise<void>;
  resetAdminState: () => void;
  selectFolder: (folderId: string | null) => void;
  setEditingFolderId: (folderId: string | null) => void;
  openHotspotEditor: (pageId: string | null) => void;
  clearError: () => void;

  createFolder: (title?: string) => Promise<FolderItem | null>;
  renameFolder: (folderId: string, title: string) => Promise<void>;
  updateFolderMeta: (
    folderId: string,
    payload: {
      title?: string;
      description?: string;
      category?: string;
      isPublished?: boolean;
      sharePin?: string;
    }
  ) => Promise<FolderItem | null>;
  deleteFolder: (folderId: string) => Promise<void>;
  reorderFolders: (folderIds: string[]) => Promise<void>;

  uploadPages: (files: File[], insertAtIndex?: number) => Promise<void>;
  replacePageDocument: (pageId: string, file: File) => Promise<void>;
  updatePageSize: (pageId: string, paperSize: PaperSize) => Promise<void>;
  updatePageHotspots: (pageId: string, hotspots: Hotspot[]) => Promise<void>;
  deletePage: (pageId: string) => Promise<void>;
  reorderPages: (pageIds: string[]) => Promise<void>;
}

export const useAdminStore = create<AdminState>((set, get) => ({
  folders: [],
  selectedFolderId: null,
  editingFolderId: null,
  activeHotspotPageId: null,
  isLoading: false,
  isUploading: false,
  uploadMessage: null,
  error: null,

  fetchFolders: async () => {
    set({ isLoading: true, error: null });
    try {
      const { folders } = await apiClient.listFolders();
      const currentSelected = get().selectedFolderId;
      const stillExists = folders.some((f) => f.id === currentSelected);
      set({
        folders,
        isLoading: false,
        selectedFolderId: stillExists ? currentSelected : folders[0]?.id ?? null,
      });
    } catch (err: any) {
      set({ isLoading: false, error: err.message || 'Dosyalar yüklenemedi.' });
    }
  },
  resetAdminState: () =>
    set({
      folders: [],
      selectedFolderId: null,
      editingFolderId: null,
      activeHotspotPageId: null,
      error: null,
    }),
  selectFolder: (folderId) => set({ selectedFolderId: folderId }),
  setEditingFolderId: (folderId) => set({ editingFolderId: folderId }),
  openHotspotEditor: (pageId) => set({ activeHotspotPageId: pageId }),
  clearError: () => set({ error: null }),

  createFolder: async (title) => {
    set({ error: null });
    try {
      const created = await apiClient.createFolder(title);
      set((state) => ({
        folders: [...state.folders, created],
        selectedFolderId: created.id,
        editingFolderId: created.id,
      }));
      return created;
    } catch (err: any) {
      set({ error: err.message || 'Yeni dosya oluşturulamadı.' });
      return null;
    }
  },

  renameFolder: async (folderId, title) => {
    const trimmed = title.trim();
    if (!trimmed) {
      set({ editingFolderId: null });
      return;
    }
    try {
      const updated = await apiClient.renameFolder(folderId, trimmed);
      set((state) => ({
        folders: state.folders.map((f) => (f.id === folderId ? updated : f)),
        editingFolderId: null,
      }));
    } catch (err: any) {
      set({ error: err.message || 'Dosya adı güncellenemedi.', editingFolderId: null });
    }
  },

  updateFolderMeta: async (folderId, payload) => {
    try {
      const updated = await apiClient.updateFolder(folderId, payload);
      set((state) => ({
        folders: state.folders.map((f) => (f.id === folderId ? updated : f)),
      }));
      return updated;
    } catch (err: any) {
      set({ error: err.message || 'Dosya bilgileri güncellenemedi.' });
      return null;
    }
  },

  deleteFolder: async (folderId) => {
    try {
      await apiClient.deleteFolder(folderId);
      set((state) => {
        const remaining = state.folders.filter((f) => f.id !== folderId);
        return {
          folders: remaining,
          selectedFolderId:
            state.selectedFolderId === folderId ? remaining[0]?.id ?? null : state.selectedFolderId,
        };
      });
    } catch (err: any) {
      set({ error: err.message || 'Dosya silinemedi.' });
    }
  },

  reorderFolders: async (folderIds) => {
    const prev = get().folders;
    const map = new Map(prev.map((f) => [f.id, f]));
    const optimistic = folderIds
      .map((id, i) => {
        const item = map.get(id);
        return item ? { ...item, orderIndex: i } : null;
      })
      .filter(Boolean) as FolderItem[];
    set({ folders: optimistic });

    try {
      const updated = await apiClient.reorderFolders(folderIds);
      set({ folders: updated });
    } catch (err: any) {
      set({ folders: prev, error: err.message || 'Dosya sıralaması kaydedilemedi.' });
    }
  },

  uploadPages: async (files, insertAtIndex) => {
    const folderId = get().selectedFolderId;
    if (!folderId || files.length === 0) return;

    set({
      isUploading: true,
      uploadMessage: `${files.length} belge yüksek çözünürlüklü sayfa görsellerine dönüştürülüyor...`,
      error: null,
    });

    try {
      const { folder } = await apiClient.uploadPages(folderId, files, insertAtIndex);
      set((state) => ({
        folders: state.folders.map((f) => (f.id === folderId ? folder : f)),
        isUploading: false,
        uploadMessage: null,
      }));
    } catch (err: any) {
      set({
        isUploading: false,
        uploadMessage: null,
        error: err.message || 'Evrak yükleme ve dönüştürme işlemi başarısız oldu.',
      });
    }
  },

  replacePageDocument: async (pageId, file) => {
    const folderId = get().selectedFolderId;
    if (!folderId) return;

    set({
      isUploading: true,
      uploadMessage: 'Evrak güncelleniyor ve yüksek çözünürlüklü görsele dönüştürülüyor...',
      error: null,
    });

    try {
      const updatedFolder = await apiClient.replacePageDocument(folderId, pageId, file);
      set((state) => ({
        folders: state.folders.map((f) => (f.id === folderId ? updatedFolder : f)),
        isUploading: false,
        uploadMessage: null,
      }));
    } catch (err: any) {
      set({
        isUploading: false,
        uploadMessage: null,
        error: err.message || 'Evrak değiştirilemedi.',
      });
    }
  },

  updatePageSize: async (pageId, paperSize) => {
    const folderId = get().selectedFolderId;
    if (!folderId) return;

    set((state) => ({
      folders: state.folders.map((f) =>
        f.id === folderId
          ? {
              ...f,
              pages: f.pages.map((p) => (p.id === pageId ? { ...p, paperSize } : p)),
            }
          : f
      ),
    }));

    try {
      const updatedFolder = await apiClient.updatePage(folderId, pageId, { paperSize });
      set((state) => ({
        folders: state.folders.map((f) => (f.id === folderId ? updatedFolder : f)),
      }));
    } catch (err: any) {
      set({ error: err.message || 'Kağıt boyutu güncellenemedi.' });
    }
  },

  updatePageHotspots: async (pageId, hotspots) => {
    const folderId = get().selectedFolderId;
    if (!folderId) return;

    set((state) => ({
      folders: state.folders.map((f) =>
        f.id === folderId
          ? {
              ...f,
              pages: f.pages.map((p) => (p.id === pageId ? { ...p, hotspots } : p)),
            }
          : f
      ),
    }));

    try {
      const updatedFolder = await apiClient.updatePage(folderId, pageId, { hotspots });
      set((state) => ({
        folders: state.folders.map((f) => (f.id === folderId ? updatedFolder : f)),
      }));
    } catch (err: any) {
      set({ error: err.message || 'Uyarı noktaları kaydedilemedi.' });
    }
  },

  deletePage: async (pageId) => {
    const folderId = get().selectedFolderId;
    if (!folderId) return;

    try {
      const updatedFolder = await apiClient.deletePage(folderId, pageId);
      set((state) => ({
        folders: state.folders.map((f) => (f.id === folderId ? updatedFolder : f)),
        activeHotspotPageId:
          state.activeHotspotPageId === pageId ? null : state.activeHotspotPageId,
      }));
    } catch (err: any) {
      set({ error: err.message || 'Sayfa silinemedi.' });
    }
  },

  reorderPages: async (pageIds) => {
    const folderId = get().selectedFolderId;
    if (!folderId) return;

    const prevFolders = get().folders;
    const currentFolder = prevFolders.find((f) => f.id === folderId);
    if (!currentFolder) return;

    const map = new Map(currentFolder.pages.map((p) => [p.id, p]));
    const reorderedPages = pageIds
      .map((id, idx) => {
        const item = map.get(id);
        return item ? { ...item, orderIndex: idx } : null;
      })
      .filter(Boolean) as FolderItem['pages'];

    set((state) => ({
      folders: state.folders.map((f) =>
        f.id === folderId ? { ...f, pages: reorderedPages } : f
      ),
    }));

    try {
      const updatedFolder = await apiClient.reorderPages(folderId, pageIds);
      set((state) => ({
        folders: state.folders.map((f) => (f.id === folderId ? updatedFolder : f)),
      }));
    } catch (err: any) {
      set({ folders: prevFolders, error: err.message || 'Sayfa sıralaması güncellenemedi.' });
    }
  },
}));

const completedSpotlightPageIds = new Set<string>();

const MIN_VIEWER_ZOOM = 0.2;
const MAX_VIEWER_ZOOM = 4.5;
const PAN_LIMIT_X = 2600;
const PAN_LIMIT_Y = 2200;

function clampViewerZoom(zoom: number): number {
  return Math.max(MIN_VIEWER_ZOOM, Math.min(MAX_VIEWER_ZOOM, Number(zoom.toFixed(2))));
}

function clampViewerPan(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.max(-PAN_LIMIT_X, Math.min(PAN_LIMIT_X, x)),
    y: Math.max(-PAN_LIMIT_Y, Math.min(PAN_LIMIT_Y, y)),
  };
}

function computeAnchoredPanForZoom(
  anchorX: number,
  anchorY: number,
  vcx: number,
  vcy: number,
  baseShiftX: number,
  startZoom: number,
  nextZoom: number,
  startPanX: number,
  startPanY: number
): { x: number; y: number } {
  const docX = (anchorX - vcx - (baseShiftX * startZoom + startPanX)) / startZoom;
  const docY = (anchorY - vcy - startPanY) / startZoom;
  return clampViewerPan(
    anchorX - vcx - docX * nextZoom - baseShiftX * nextZoom,
    anchorY - vcy - docY * nextZoom
  );
}

interface ViewerState {
  folder: FolderItem | null;
  workspace: PublicWorkspace | null;
  requiresPin: boolean;
  lockedTitle: string | null;
  isLoading: boolean;
  error: string | null;
  currentPageIndex: number;
  a3UnfoldTarget: Record<string, number>;
  a3UnfoldCurrent: Record<string, number>;
  defaultFitZoom: number;
  zoomLevel: number;
  panOffset: { x: number; y: number };
  isSpotlightActive: boolean;
  activeHotspotIndex: number;
  acknowledgedPages: Record<string, boolean>;

  loadFolder: (
    identifier: string,
    opts?: { isPublic?: boolean; pin?: string; workspaceId?: string }
  ) => Promise<void>;
  resetViewer: () => void;
  setDefaultFitZoom: (fitZoom: number, applyNow?: boolean) => void;
  setZoomLevel: (zoom: number) => void;
  setZoomAndPan: (zoom: number, x: number, y: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetCameraView: () => void;
  setPanOffset: (x: number, y: number) => void;
  addPanOffset: (dxPx: number, dyPx: number) => void;
  openCoverAndStart: () => void;
  goToNextPage: () => void;
  goToPrevPage: () => void;
  jumpToPage: (index: number) => void;
  syncFromFlipbookSpread: (docPageIndex: number) => void;
  setA3UnfoldTarget: (pageId: string, val: number) => void;
  toggleA3Unfold: (pageId: string) => void;
  setA3UnfoldCurrent: (pageId: string, val: number) => void;
  triggerPageSpotlightIfNeeded: (pageIndex: number, forceReplay?: boolean) => void;
  acknowledgeCurrentSpotlight: () => void;
  replayCurrentPageSpotlights: () => void;
}

export const useViewerStore = create<ViewerState>((set, get) => ({
  folder: null,
  workspace: null,
  requiresPin: false,
  lockedTitle: null,
  isLoading: false,
  error: null,
  currentPageIndex: -1,
  a3UnfoldTarget: {},
  a3UnfoldCurrent: {},
  defaultFitZoom: 1.0,
  zoomLevel: 1.0,
  panOffset: { x: 0, y: 0 },
  isSpotlightActive: false,
  activeHotspotIndex: 0,
  acknowledgedPages: {},

  loadFolder: async (identifier, opts) => {
    set({
      isLoading: true,
      error: null,
      requiresPin: false,
      lockedTitle: null,
      folder: null,
      currentPageIndex: -1,
      a3UnfoldTarget: {},
      a3UnfoldCurrent: {},
      zoomLevel: 1.0,
      panOffset: { x: 0, y: 0 },
      isSpotlightActive: false,
      activeHotspotIndex: 0,
    });
    try {
      const res = opts?.isPublic
        ? await apiClient.getPublicFolder(identifier, opts?.pin, opts?.workspaceId)
        : await apiClient.getFolder(identifier, opts?.pin);

      if (res.requiresPin || !res.folder) {
        set({
          isLoading: false,
          requiresPin: Boolean(res.requiresPin),
          lockedTitle: res.title || 'Korumalı Dosya',
          workspace: res.workspace ?? null,
          error: res.requiresPin ? (opts?.pin ? 'Girdiğiniz erişim şifresi hatalı.' : null) : 'Dosya bulunamadı.',
        });
        return;
      }

      const ackMap: Record<string, boolean> = {};
      for (const p of res.folder.pages) {
        if (completedSpotlightPageIds.has(p.id)) ackMap[p.id] = true;
      }
      set({
        folder: res.folder,
        workspace: res.workspace ?? null,
        requiresPin: false,
        isLoading: false,
        acknowledgedPages: ackMap,
      });
    } catch (err: any) {
      set({ isLoading: false, error: err.message || 'Başvuru dosyası yüklenemedi.' });
    }
  },

  resetViewer: () =>
    set({
      folder: null,
      workspace: null,
      requiresPin: false,
      lockedTitle: null,
      currentPageIndex: -1,
      a3UnfoldTarget: {},
      a3UnfoldCurrent: {},
      zoomLevel: 1.0,
      panOffset: { x: 0, y: 0 },
      isSpotlightActive: false,
      activeHotspotIndex: 0,
    }),

  setDefaultFitZoom: (fitZoom, applyNow = false) => {
    const clampedFit = clampViewerZoom(Math.min(1.0, fitZoom));
    if (applyNow) {
      set({ defaultFitZoom: clampedFit, zoomLevel: clampedFit, panOffset: { x: 0, y: 0 } });
    } else {
      set({ defaultFitZoom: clampedFit });
    }
  },
  setZoomLevel: (zoom) => {
    set({ zoomLevel: clampViewerZoom(zoom) });
  },
  setZoomAndPan: (zoom, x, y) => {
    set({
      zoomLevel: clampViewerZoom(zoom),
      panOffset: clampViewerPan(x, y),
    });
  },
  zoomIn: () => {
    const cur = get().zoomLevel;
    const step = cur < 1.0 ? 0.15 : 0.25;
    get().setZoomLevel(cur + step);
  },
  zoomOut: () => {
    const cur = get().zoomLevel;
    const step = cur <= 1.0 ? 0.15 : 0.25;
    get().setZoomLevel(cur - step);
  },
  resetCameraView: () => set({ zoomLevel: get().defaultFitZoom, panOffset: { x: 0, y: 0 } }),
  setPanOffset: (x, y) =>
    set({
      panOffset: clampViewerPan(x, y),
    }),
  addPanOffset: (dxPx, dyPx) =>
    set((state) => ({
      panOffset: clampViewerPan(state.panOffset.x + dxPx, state.panOffset.y + dyPx),
    })),

  openCoverAndStart: () => {
    const { folder } = get();
    playPaperTurnSound();
    if (!folder || folder.pages.length === 0) {
      set({ currentPageIndex: 0 });
      return;
    }
    set({ currentPageIndex: 0 });
    setTimeout(() => {
      get().triggerPageSpotlightIfNeeded(0, false);
    }, 650);
  },

  goToNextPage: () => {
    const { folder, currentPageIndex, isSpotlightActive, a3UnfoldTarget } = get();
    if (!folder || isSpotlightActive) return;
    if (currentPageIndex === -1) {
      get().openCoverAndStart();
      return;
    }
    if (currentPageIndex >= folder.pages.length) return;

    const currentPage = folder.pages[currentPageIndex];
    if (currentPage && currentPage.paperSize === 'A3' && (a3UnfoldTarget[currentPage.id] ?? 0) > 0.05) {
      set((state) => ({ a3UnfoldTarget: { ...state.a3UnfoldTarget, [currentPage.id]: 0 } }));
    }

    playPaperTurnSound();
    const nextIdx = currentPageIndex + 1;
    set({ currentPageIndex: nextIdx, panOffset: { x: 0, y: 0 } });
    if (nextIdx < folder.pages.length) {
      setTimeout(() => {
        get().triggerPageSpotlightIfNeeded(nextIdx, false);
      }, 650);
    }
  },

  goToPrevPage: () => {
    const { folder, currentPageIndex, isSpotlightActive, a3UnfoldTarget } = get();
    if (!folder || isSpotlightActive || currentPageIndex <= -1) return;

    const currentPage = folder.pages[currentPageIndex];
    if (currentPage && currentPage.paperSize === 'A3' && (a3UnfoldTarget[currentPage.id] ?? 0) > 0.05) {
      set((state) => ({ a3UnfoldTarget: { ...state.a3UnfoldTarget, [currentPage.id]: 0 } }));
    }

    playPaperTurnSound();
    set({ currentPageIndex: currentPageIndex - 1, panOffset: { x: 0, y: 0 } });
  },

  jumpToPage: (index) => {
    const { folder, isSpotlightActive, currentPageIndex } = get();
    if (!folder || isSpotlightActive) return;
    const clamped = Math.max(-1, Math.min(folder.pages.length, index));
    if (clamped === currentPageIndex) return;

    playPaperTurnSound();
    set({ currentPageIndex: clamped, panOffset: { x: 0, y: 0 } });
    if (clamped >= 0 && clamped < folder.pages.length) {
      setTimeout(() => {
        get().triggerPageSpotlightIfNeeded(clamped, false);
      }, 650);
    }
  },

  syncFromFlipbookSpread: (docPageIndex) => {
    const { folder, currentPageIndex } = get();
    if (!folder) return;
    const clamped = Math.max(-1, Math.min(folder.pages.length, docPageIndex));
    if (clamped === currentPageIndex) return;

    playPaperTurnSound();
    set({
      currentPageIndex: clamped,
      panOffset: { x: 0, y: 0 },
      a3UnfoldTarget: {},
    });
    if (clamped >= 0 && clamped < folder.pages.length) {
      setTimeout(() => {
        get().triggerPageSpotlightIfNeeded(clamped, false);
      }, 450);
    }
  },

  setA3UnfoldTarget: (pageId, val) => {
    const clamped = Math.max(0, Math.min(1, val));
    set((state) => ({ a3UnfoldTarget: { ...state.a3UnfoldTarget, [pageId]: clamped } }));

    const { folder, currentPageIndex } = get();
    if (!folder || currentPageIndex < 0) return;
    const pages = [...folder.pages].sort((a, b) => a.orderIndex - b.orderIndex);
    const activePage = pages[currentPageIndex];
    if (activePage && activePage.id === pageId && clamped >= 0.85) {
      setTimeout(() => {
        get().triggerPageSpotlightIfNeeded(currentPageIndex, false);
      }, 380);
    }
  },

  toggleA3Unfold: (pageId) => {
    playPaperTurnSound();
    const currentTarget = get().a3UnfoldTarget[pageId] ?? 0;
    get().setA3UnfoldTarget(pageId, currentTarget > 0.5 ? 0 : 1);
  },

  setA3UnfoldCurrent: (pageId, val) =>
    set((state) => ({ a3UnfoldCurrent: { ...state.a3UnfoldCurrent, [pageId]: val } })),

  triggerPageSpotlightIfNeeded: (pageIndex, forceReplay = false) => {
    const { folder, acknowledgedPages, a3UnfoldTarget } = get();
    if (!folder || pageIndex < 0) return;
    const pages = [...folder.pages].sort((a, b) => a.orderIndex - b.orderIndex);
    const page = pages[pageIndex];
    if (!page || page.hotspots.length === 0) {
      set({ isSpotlightActive: false });
      return;
    }
    if (!forceReplay && (completedSpotlightPageIds.has(page.id) || acknowledgedPages[page.id])) {
      return;
    }
    if (page.paperSize === 'A3' && (a3UnfoldTarget[page.id] ?? 0) < 0.85) {
      if (forceReplay) {
        set((state) => ({
          a3UnfoldTarget: { ...state.a3UnfoldTarget, [page.id]: 1 },
          isSpotlightActive: true,
          activeHotspotIndex: 0,
        }));
      }
      return;
    }
    set({ isSpotlightActive: true, activeHotspotIndex: 0 });
  },

  acknowledgeCurrentSpotlight: () => {
    const { folder, currentPageIndex, activeHotspotIndex, acknowledgedPages } = get();
    if (!folder) return;
    const pages = [...folder.pages].sort((a, b) => a.orderIndex - b.orderIndex);
    const page = pages[currentPageIndex];
    if (!page) return;

    if (activeHotspotIndex < page.hotspots.length - 1) {
      set({ activeHotspotIndex: activeHotspotIndex + 1 });
    } else {
      completedSpotlightPageIds.add(page.id);
      set({
        isSpotlightActive: false,
        activeHotspotIndex: 0,
        acknowledgedPages: { ...acknowledgedPages, [page.id]: true },
      });
    }
  },

  replayCurrentPageSpotlights: () => {
    const { currentPageIndex } = get();
    if (currentPageIndex >= 0) {
      get().triggerPageSpotlightIfNeeded(currentPageIndex, true);
    }
  },
}));

// ============================================================================
// 6. ORTAK BİLEŞENLER (CONFIRM DIALOG, PIN KARTI & KRAFT FOLDER ICON)
// ============================================================================

export const ConfirmDialog: React.FC<{
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({
  open,
  title,
  description,
  confirmLabel = 'Evet, Sil',
  cancelLabel = 'Vazgeç',
  onConfirm,
  onCancel,
}) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/75 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-md w-full p-6">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-full bg-red-500/15 text-red-400 shrink-0">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-white">{title}</h3>
            <p className="mt-1.5 text-sm text-slate-300 leading-relaxed">{description}</p>
          </div>
        </div>
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-500 shadow-lg shadow-red-600/20 transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export const PinGateCard: React.FC<{
  title: string;
  subtitle?: string;
  error?: string | null;
  onSubmitPin: (pin: string) => void;
}> = ({ title, subtitle, error, onSubmitPin }) => {
  const [pin, setPin] = useState('');
  return (
    <div className="min-h-screen w-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-2xl bg-slate-900 border border-slate-700/80 shadow-2xl p-8 text-center">
        <div className="w-14 h-14 rounded-2xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400 mx-auto mb-4">
          <Lock className="w-7 h-7" />
        </div>
        <h2 className="text-lg font-bold text-white">{title}</h2>
        <p className="text-xs text-slate-400 mt-1 mb-6">
          {subtitle || 'Bu dosya rehberini görüntülemek için paylaşım erişim şifresini (PIN) giriniz.'}
        </p>

        {error && (
          <div className="mb-4 px-3 py-2 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs font-medium">
            {error}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (pin.trim()) onSubmitPin(pin.trim());
          }}
          className="space-y-3"
        >
          <input
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="Erişim Şifresi / PIN"
            autoFocus
            className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-center text-sm font-bold tracking-widest text-white focus:outline-none focus:border-amber-500"
          />
          <button
            type="submit"
            className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-sm inline-flex items-center justify-center gap-2 transition-colors shadow-lg shadow-amber-500/20"
          >
            <Unlock className="w-4 h-4" />
            Kilidi Aç ve İncele
          </button>
        </form>
      </div>
    </div>
  );
};

export const KraftFolderIcon: React.FC<{
  title?: string;
  pageCount?: number;
  hasA3?: boolean;
  className?: string;
}> = ({ title, pageCount = 0, hasA3 = false, className = 'w-40 h-52' }) => {
  const {
    BACK_WIDTH,
    BACK_HEIGHT,
    FLAP_START_X,
    FLAP_WIDTH,
    EYELET_X,
    EYELET_Y1,
    EYELET_Y2,
    BOX_X1,
    BOX_Y1,
    BOX_WIDTH,
    BOX_HEIGHT,
    BOX_HORIZONTAL_LINES_Y,
    FLAP_BOTTOM_CREASE_Y,
  } = FOLDER_DIMENSIONS;

  return (
    <svg
      viewBox={`0 0 ${BACK_WIDTH} ${BACK_HEIGHT}`}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="kraftBackGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#b59268" />
          <stop offset="60%" stopColor="#a9855b" />
          <stop offset="100%" stopColor="#9b784e" />
        </linearGradient>
        <linearGradient id="kraftFlapGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#c8a77d" />
          <stop offset="55%" stopColor="#bd9b70" />
          <stop offset="100%" stopColor="#b18f64" />
        </linearGradient>
        <filter id="flapShadow" x="-10%" y="-5%" width="130%" height="110%">
          <feDropShadow dx="3.5" dy="1" stdDeviation="3.2" floodColor="#1c130b" floodOpacity="0.38" />
        </filter>
        <filter id="paperShadow" x="-5%" y="-5%" width="115%" height="110%">
          <feDropShadow dx="1.5" dy="1" stdDeviation="1.8" floodColor="#1c130b" floodOpacity="0.22" />
        </filter>
      </defs>

      <path
        d={`M 0,0 L ${BACK_WIDTH - 6},0 Q ${BACK_WIDTH},0 ${BACK_WIDTH},6 L ${BACK_WIDTH},${
          BACK_HEIGHT - 6
        } Q ${BACK_WIDTH},${BACK_HEIGHT} ${BACK_WIDTH - 6},${BACK_HEIGHT} L 0,${BACK_HEIGHT} Z`}
        fill="url(#kraftBackGrad)"
        stroke="#84633d"
        strokeWidth="0.8"
      />

      {pageCount > 0 && (
        <g filter="url(#paperShadow)">
          {pageCount > 1 && (
            <rect
              x="16"
              y="13"
              width="210"
              height="295"
              rx="1.5"
              fill="#f1f5f9"
              stroke="#cbd5e1"
              strokeWidth="0.6"
            />
          )}
          <rect
            x="12"
            y="10"
            width="210"
            height="297"
            rx="1.5"
            fill="#ffffff"
            stroke="#e2e8f0"
            strokeWidth="0.6"
          />
          <line x1="132" y1="42" x2="198" y2="42" stroke="#cbd5e1" strokeWidth="2.5" />
          <line x1="132" y1="58" x2="205" y2="58" stroke="#e2e8f0" strokeWidth="2" />
          <line x1="132" y1="70" x2="202" y2="70" stroke="#e2e8f0" strokeWidth="2" />
          <line x1="132" y1="82" x2="188" y2="82" stroke="#e2e8f0" strokeWidth="2" />
          <rect
            x="132"
            y="102"
            width="72"
            height="48"
            rx="2"
            fill="#f8fafc"
            stroke="#cbd5e1"
            strokeWidth="1"
          />
          {hasA3 && (
            <g>
              <rect x="136" y="268" width="76" height="22" rx="4" fill="#fef3c7" stroke="#d97706" strokeWidth="1" />
              <text
                x="174"
                y="282"
                textAnchor="middle"
                fontSize="8.5"
                fontWeight="bold"
                fill="#b45309"
                fontFamily="sans-serif"
              >
                A3 KATLI PROJE
              </text>
            </g>
          )}
        </g>
      )}

      <line
        x1={FLAP_START_X}
        y1="0"
        x2={FLAP_START_X}
        y2={BACK_HEIGHT}
        stroke="#6b4f30"
        strokeWidth="0.9"
      />
      {[EYELET_Y1, EYELET_Y2].map((cy, i) => (
        <g key={i}>
          <circle cx={EYELET_X} cy={cy} r="4.4" fill="#4a4238" stroke="#2b2118" strokeWidth="0.6" />
          <circle cx={EYELET_X} cy={cy} r="3.4" fill="none" stroke="#9ca3af" strokeWidth="0.7" />
          <circle cx={EYELET_X} cy={cy} r="2.3" fill="#1e293b" />
        </g>
      ))}

      <g filter="url(#flapShadow)">
        <path
          d={`M ${FLAP_START_X},0 L ${FLAP_START_X + FLAP_WIDTH - 8},0 Q ${
            FLAP_START_X + FLAP_WIDTH
          },0 ${FLAP_START_X + FLAP_WIDTH},8 L ${FLAP_START_X + FLAP_WIDTH},${
            BACK_HEIGHT - 8
          } Q ${FLAP_START_X + FLAP_WIDTH},${BACK_HEIGHT} ${
            FLAP_START_X + FLAP_WIDTH - 8
          },${BACK_HEIGHT} L ${FLAP_START_X},${BACK_HEIGHT} Z`}
          fill="url(#kraftFlapGrad)"
          stroke="#8c6b43"
          strokeWidth="0.7"
        />
        <line
          x1={FLAP_START_X}
          y1={FLAP_BOTTOM_CREASE_Y}
          x2={FLAP_START_X + FLAP_WIDTH}
          y2={FLAP_BOTTOM_CREASE_Y}
          stroke="#6b4f30"
          strokeWidth="0.6"
          strokeOpacity="0.45"
        />
        <rect
          x={BOX_X1}
          y={BOX_Y1}
          width={BOX_WIDTH}
          height={BOX_HEIGHT}
          fill="none"
          stroke="#2b2118"
          strokeWidth="1.2"
        />
        {BOX_HORIZONTAL_LINES_Y.map((lineY) =>
          lineY !== BOX_Y1 && lineY !== BOX_Y1 + BOX_HEIGHT ? (
            <line
              key={lineY}
              x1={BOX_X1}
              y1={lineY}
              x2={BOX_X1 + BOX_WIDTH}
              y2={lineY}
              stroke="#2b2118"
              strokeWidth="1.05"
            />
          ) : null
        )}
        {title && (
          <foreignObject x={BOX_X1 + 3} y={90} width={BOX_WIDTH - 6} height={54}>
            <div className="w-full h-full flex items-center justify-center text-center overflow-hidden px-0.5">
              <span className="text-[9.5px] leading-[11px] font-bold text-[#172554] uppercase tracking-tight break-words line-clamp-4">
                {title}
              </span>
            </div>
          </foreignObject>
        )}
      </g>
    </svg>
  );
};

// ============================================================================
// 7. İLK KURULUM, GİRİŞ & GOOGLE BAĞLANTI EKRANLARI
// ============================================================================

const FirstRunSetupView: React.FC<{
  isModal?: boolean;
  onClose?: () => void;
  onSuccess?: () => void;
}> = ({ isModal = false, onClose, onSuccess }) => {
  const { setupInitialAdmin, isSubmitting, error, clearError } = useAuthStore();
  const [displayName, setDisplayName] = useState('');
  const [workspaceTitle, setWorkspaceTitle] = useState('Resmi Başvuru Dosyası Rehberleri');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [localErr, setLocalErr] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setLocalErr(null);
    if (password !== passwordConfirm) {
      setLocalErr('Girdiğiniz şifreler birbiriyle eşleşmiyor.');
      return;
    }
    const ok = await setupInitialAdmin({
      displayName: displayName.trim(),
      workspaceTitle: workspaceTitle.trim() || undefined,
      username: username.trim(),
      password,
    });
    if (ok && onSuccess) onSuccess();
  };

  const card = (
    <div className="max-w-lg w-full rounded-2xl bg-slate-900 border border-slate-700/80 shadow-2xl p-8 relative">
      {isModal && onClose && (
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      )}
      <div className="flex items-center gap-3 mb-5">
        <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
          <ShieldCheck className="w-7 h-7" />
        </div>
        <div>
          <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-extrabold uppercase tracking-wider">
            İlk Kurulum Adımı
          </span>
          <h1 className="text-xl font-bold text-white mt-0.5">
            Yönetici Hesabını Oluşturun
          </h1>
        </div>
      </div>

      <p className="text-xs text-slate-300 leading-relaxed bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 mb-5">
        Sistemi ilk kez kullanıyorsunuz. Yönetim panelini koruma altına almak için bir yönetici kullanıcı adı ve şifresi belirleyin. Mevcut kayıtlı dosyalarınız otomatik olarak bu hesabın çalışma alanına aktarılacaktır.
      </p>

      {(localErr || error) && (
        <div className="mb-4 px-3.5 py-2.5 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-200 text-xs font-medium flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{localErr || error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1">
            Kurum / Birim veya Ad Soyad
          </label>
          <input
            type="text"
            required
            minLength={2}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Örn: Büyükşehir Belediyesi İmar Müdürlüğü"
            className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white focus:outline-none focus:border-amber-500"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1">
            Vatandaş Masaüstü (Vitrin) Başlığı
          </label>
          <input
            type="text"
            required
            minLength={2}
            value={workspaceTitle}
            onChange={(e) => setWorkspaceTitle(e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white focus:outline-none focus:border-amber-500"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1">
            Yönetici Kullanıcı Adı
          </label>
          <input
            type="text"
            required
            minLength={3}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Örn: admin"
            className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white focus:outline-none focus:border-amber-500"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Şifre (En az 4 karakter)
            </label>
            <input
              type="password"
              required
              minLength={4}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white focus:outline-none focus:border-amber-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Şifre Tekrar
            </label>
            <input
              type="password"
              required
              minLength={4}
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white focus:outline-none focus:border-amber-500"
            />
          </div>
        </div>

        <div className="pt-2 flex items-center justify-between gap-3">
          {!isModal ? (
            <Link
              to="/"
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 transition-colors"
            >
              ← Ana Sayfa
            </Link>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 transition-colors"
            >
              Vazgeç
            </button>
          )}
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex-1 py-2.5 px-5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-extrabold text-sm inline-flex items-center justify-center gap-2 transition-colors shadow-lg shadow-amber-500/20"
          >
            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Hesabı Oluştur ve Panele Gir
          </button>
        </div>
      </form>
    </div>
  );

  if (isModal) return card;
  return (
    <div className="min-h-screen w-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 overflow-y-auto">
      {card}
    </div>
  );
};

const AuthView: React.FC<{
  isModal?: boolean;
  onClose?: () => void;
  onSuccess?: () => void;
}> = ({ isModal = false, onClose, onSuccess }) => {
  const {
    user,
    pendingGoogleOnboarding,
    googleClientId,
    isSubmitting,
    error,
    clearError,
    setError,
    login,
    loginWithGoogleAccessToken,
    saveGoogleClientId,
    finishGoogleOnboarding,
    updateWorkspaceSettings,
  } = useAuthStore();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isPopupOpening, setIsPopupOpening] = useState(false);
  const [showClientIdSetup, setShowClientIdSetup] = useState(false);
  const [clientIdDraft, setClientIdDraft] = useState('');

  // Google ile bağlandıktan sonraki Kişisel Bilgi & Şifre Belirleme formu state'i
  const [profileDisplayName, setProfileDisplayName] = useState('');
  const [profileUsername, setProfileUsername] = useState('');
  const [profileWorkspaceTitle, setProfileWorkspaceTitle] = useState('');
  const [profileNewPassword, setProfileNewPassword] = useState('');
  const [profileLocalErr, setProfileLocalErr] = useState<string | null>(null);

  useEffect(() => {
    if (pendingGoogleOnboarding && user) {
      setProfileDisplayName(user.displayName || '');
      setProfileUsername(user.username || '');
      setProfileWorkspaceTitle(user.workspaceTitle || '');
      setProfileNewPassword('');
      setProfileLocalErr(null);
    }
  }, [pendingGoogleOnboarding, user]);

  // Gerçek Google OAuth2 (Identity Services) betiğini proaktif olarak yükle
  useEffect(() => {
    if ((window as any).google?.accounts?.oauth2) return;
    if (document.getElementById('google-gis-script')) return;

    const script = document.createElement('script');
    script.id = 'google-gis-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
  }, []);

  const ensureGoogleOAuth2Loaded = (): Promise<any> =>
    new Promise((resolve, reject) => {
      const ready = (window as any).google?.accounts?.oauth2;
      if (ready?.initTokenClient) {
        resolve(ready);
        return;
      }
      let script = document.getElementById('google-gis-script') as HTMLScriptElement | null;
      if (!script) {
        script = document.createElement('script');
        script.id = 'google-gis-script';
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
      const onLoad = () => {
        const oauth2 = (window as any).google?.accounts?.oauth2;
        if (oauth2?.initTokenClient) resolve(oauth2);
        else reject(new Error('Google OAuth2 istemcisi başlatılamadı.'));
      };
      const onErr = () =>
        reject(new Error('Google sunucularına (accounts.google.com) ulaşılamadı.'));
      script.addEventListener('load', onLoad, { once: true });
      script.addEventListener('error', onErr, { once: true });
    });

  const launchGoogleOAuthPopup = async (activeClientId: string) => {
    clearError();
    const cleanClientId = extractCleanGoogleClientId(activeClientId) || DEFAULT_GOOGLE_CLIENT_ID;
    if (!cleanClientId) {
      setShowClientIdSetup(true);
      setError('Google Client ID tanımlanmamış. Lütfen .env dosyasından veya ayar alanından ekleyin.');
      return;
    }
    setIsPopupOpening(true);
    try {
      const oauth2 = await ensureGoogleOAuth2Loaded();
      const tokenClient = oauth2.initTokenClient({
        client_id: cleanClientId,
        scope: 'openid email profile',
        callback: async (tokenResp: { access_token?: string; error?: string }) => {
          setIsPopupOpening(false);
          if (tokenResp?.access_token) {
            await loginWithGoogleAccessToken(tokenResp.access_token);
          } else {
            setError('Google hesap bağlantısı tamamlanmadı.');
          }
        },
        error_callback: (err: { type?: string }) => {
          setIsPopupOpening(false);
          if (err?.type === 'popup_failed_to_open') {
            setError(
              'Tarayıcı Google açılır penceresini engelledi. İzin verip tekrar "Google ile Bağlan" butonuna tıklayın.'
            );
          } else {
            setError('Google oturum açma penceresi kapatıldı.');
          }
        },
      });
      tokenClient.requestAccessToken({ prompt: 'consent select_account' });
    } catch (err: any) {
      setIsPopupOpening(false);
      setError(err?.message || 'Google OAuth2 popup penceresi açılamadı.');
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    const ok = await login(username.trim(), password);
    if (ok && onSuccess) onSuccess();
  };

  const handleGoogleConnectClick = () => {
    clearError();
    const cleanId = extractCleanGoogleClientId(googleClientId) || DEFAULT_GOOGLE_CLIENT_ID;
    void launchGoogleOAuthPopup(cleanId);
  };

  const handleSaveClientIdAndConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    const trimmed = extractCleanGoogleClientId(clientIdDraft) || clientIdDraft.trim();
    const ok = await saveGoogleClientId(trimmed);
    if (ok) {
      setShowClientIdSetup(false);
      await launchGoogleOAuthPopup(trimmed);
    }
  };

  const handleGoDirectlyToPanel = () => {
    finishGoogleOnboarding();
    if (onSuccess) onSuccess();
  };

  const handleCancelOrClose = () => {
    if (pendingGoogleOnboarding) {
      finishGoogleOnboarding();
    }
    if (onClose) onClose();
  };

  // ADIM 2: GOOGLE İLE BAĞLANDIKTAN SONRAKİ KİŞİSEL BİLGİLER & İSTEĞE BAĞLI ŞİFRE EKRANI
  if (pendingGoogleOnboarding && user) {
    const hasEdits =
      profileDisplayName.trim() !== (user.displayName || '').trim() ||
      profileUsername.trim().toLowerCase() !== (user.username || '').trim().toLowerCase() ||
      profileWorkspaceTitle.trim() !== (user.workspaceTitle || '').trim() ||
      profileNewPassword.trim().length > 0;

    const handleProfileSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      clearError();
      setProfileLocalErr(null);

      if (!hasEdits) {
        handleGoDirectlyToPanel();
        return;
      }

      if (profileNewPassword && profileNewPassword.length < 4) {
        setProfileLocalErr('Belirleyeceğiniz şifre en az 4 karakter olmalıdır.');
        return;
      }

      const ok = await updateWorkspaceSettings({
        username: profileUsername.trim(),
        displayName: profileDisplayName.trim(),
        workspaceTitle: profileWorkspaceTitle.trim(),
        newPassword: profileNewPassword || undefined,
      });

      if (ok) {
        handleGoDirectlyToPanel();
      }
    };

    const initials = (user.displayName || user.email || 'G')
      .split(/\s+/)
      .slice(0, 2)
      .map((s) => s.charAt(0).toLocaleUpperCase('tr-TR'))
      .join('');

    const profileCard = (
      <div className="max-w-lg w-full rounded-2xl bg-slate-900 border border-slate-700/80 shadow-2xl p-7 relative">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-bold text-white">Kişisel Bilgilerim ve Hesabım</h1>
              <p className="text-[11px] text-slate-400">
                Google hesabınız bağlandı • Bilgilerinizi düzenleyip panele geçebilirsiniz
              </p>
            </div>
          </div>
          {isModal && onClose && (
            <button
              type="button"
              onClick={handleCancelOrClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Google Hesap Özet Kartı */}
        <div className="mb-5 p-3.5 rounded-xl bg-slate-950/90 border border-emerald-500/30 flex items-center gap-3">
          {isSafeAvatarUrl(user.avatarUrl) ? (
            <img
              src={user.avatarUrl}
              alt={user.displayName}
              className="w-10 h-10 rounded-full border border-slate-700 object-cover shrink-0"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 font-extrabold text-xs flex items-center justify-center shrink-0">
              {initials}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold text-white truncate">{user.displayName}</div>
            <div className="text-[11px] text-slate-400 truncate">
              {user.email || `@${user.username}`}
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[10px] font-bold shrink-0">
            Google Bağlı
          </span>
        </div>

        {(profileLocalErr || error) && (
          <div className="mb-4 px-3.5 py-2.5 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-200 text-xs font-medium flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{profileLocalErr || error}</span>
          </div>
        )}

        <form onSubmit={handleProfileSubmit} className="space-y-3.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Ad Soyad / Kurum Adı
              </label>
              <input
                type="text"
                required
                minLength={2}
                value={profileDisplayName}
                onChange={(e) => setProfileDisplayName(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white focus:outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Kullanıcı Adı
              </label>
              <input
                type="text"
                required
                minLength={3}
                value={profileUsername}
                onChange={(e) => setProfileUsername(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-amber-300 font-mono focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Masaüstü / Vitrin Başlığı
            </label>
            <input
              type="text"
              required
              minLength={2}
              value={profileWorkspaceTitle}
              onChange={(e) => setProfileWorkspaceTitle(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white focus:outline-none focus:border-amber-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Şifre Belirle <span className="text-slate-400 font-normal">(İsteğe Bağlı)</span>
            </label>
            <input
              type="password"
              value={profileNewPassword}
              onChange={(e) => setProfileNewPassword(e.target.value)}
              placeholder={
                user.hasPassword
                  ? 'Değiştirmek istemiyorsanız boş bırakın'
                  : 'Kullanıcı adı ile giriş için şifre belirleyebilirsiniz'
              }
              className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white focus:outline-none focus:border-amber-500"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Hiçbir değişiklik yapmadan doğrudan <strong>Panele Git</strong> düğmesine basarak da devam edebilirsiniz.
            </p>
          </div>

          <div className="pt-2 flex flex-wrap items-center justify-end gap-2.5">
            {hasEdits && (
              <button
                type="button"
                onClick={handleGoDirectlyToPanel}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs transition-colors"
              >
                Değiştirmeden Panele Git
              </button>
            )}
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 sm:flex-none px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-extrabold text-sm inline-flex items-center justify-center gap-2 transition-colors shadow-lg shadow-amber-500/20"
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <span>{hasEdits ? 'Kaydet ve Panele Git' : 'Panele Git'}</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    );

    if (isModal) return profileCard;
    return (
      <div className="min-h-screen w-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 overflow-y-auto">
        {profileCard}
      </div>
    );
  }

  // ADIM 1: KULLANICI ADI + ŞİFRE VE ALTINDA GOOGLE İLE BAĞLAN POPUP SEÇENEĞİ
  const card = (
    <div className="max-w-md w-full rounded-2xl bg-slate-900 border border-slate-700/80 shadow-2xl p-7 relative">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400">
            <KeyRound className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white">Panelinize Giriş Yapın</h1>
            <p className="text-[11px] text-slate-400">Size Özel İzole 3D Dosya Masaüstü</p>
          </div>
        </div>
        {isModal && onClose ? (
          <button
            type="button"
            onClick={handleCancelOrClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        ) : (
          <Link
            to="/"
            className="text-xs font-semibold text-slate-400 hover:text-amber-400 transition-colors"
          >
            ← Ana Sayfa
          </Link>
        )}
      </div>

      {error && (
        <div className="mb-4 px-3.5 py-2.5 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-200 text-xs font-medium flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleLoginSubmit} className="space-y-3.5">
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1">
            Kullanıcı Adı veya E-Posta
          </label>
          <input
            type="text"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="kullanici_adi"
            className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white focus:outline-none focus:border-amber-500"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1">Şifre</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white focus:outline-none focus:border-amber-500"
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting || isPopupOpening}
          className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-extrabold text-sm inline-flex items-center justify-center gap-2 transition-colors shadow-lg shadow-amber-500/20"
        >
          {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
          Panele Giriş Yap
        </button>
      </form>

      <div className="mt-5 pt-5 border-t border-slate-800">
        <div className="text-center text-[11px] font-semibold text-slate-400 mb-3">
          VEYA HESABINIZ YOKSA / TEK TIKLA BAĞLANIN
        </div>

        {!showClientIdSetup ? (
          <>
            <button
              type="button"
              onClick={handleGoogleConnectClick}
              disabled={isSubmitting || isPopupOpening}
              className="w-full py-2.5 px-4 rounded-xl bg-white hover:bg-slate-100 disabled:opacity-60 text-slate-900 font-bold text-xs inline-flex items-center justify-center gap-2.5 transition-colors shadow"
            >
              {isPopupOpening ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-slate-700" />
                  <span>Google İzin Penceresi Açık...</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96z"
                    />
                  </svg>
                  <span>Google ile Bağlan</span>
                </>
              )}
            </button>
            <p className="text-[11px] text-slate-400 text-center mt-2.5 leading-snug">
              Google hesabınıza bağlandığınızda bilgileriniz doğrudan Google üzerinden çekilir.
            </p>
          </>
        ) : (
          <form
            onSubmit={handleSaveClientIdAndConnect}
            className="space-y-3 p-4 rounded-xl bg-slate-950 border border-amber-500/40"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-amber-300">
                Canlı Google OAuth Bağlantısı İçin Client ID Girin
              </span>
              <button
                type="button"
                onClick={() => setShowClientIdSetup(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              Gerçek Google OAuth popup penceresinin çalışması için Google Cloud Console →{' '}
              <strong>APIs &amp; Services → Credentials → OAuth client ID (Web application)</strong>{' '}
              altında Authorized JavaScript origins kısmına{' '}
              <code className="px-1.5 py-0.5 rounded bg-slate-800 text-amber-300 font-mono">
                {typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3001'}
              </code>{' '}
              ekleyip aldığınız Client ID kodunu aşağıya yapıştırın:
            </p>
            <input
              type="text"
              required
              value={clientIdDraft}
              onChange={(e) => setClientIdDraft(e.target.value)}
              placeholder="1234567890-xxxxx.apps.googleusercontent.com"
              className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-white focus:outline-none focus:border-amber-500"
            />
            <button
              type="submit"
              disabled={isSubmitting || isPopupOpening}
              className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-extrabold text-xs transition-colors"
            >
              {isSubmitting ? 'Kaydediliyor...' : "Kaydet ve Google Popup'ını Aç"}
            </button>
          </form>
        )}
      </div>
    </div>
  );

  if (isModal) return card;
  return (
    <div className="min-h-screen w-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 overflow-y-auto">
      {card}
    </div>
  );
};

const AuthModal: React.FC<{
  open: boolean;
  onClose: () => void;
}> = ({ open, onClose }) => {
  const { needsInitialSetup, clearError, finishGoogleOnboarding } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    if (open) clearError();
  }, [open, clearError]);

  if (!open) return null;

  const handleClose = () => {
    finishGoogleOnboarding();
    onClose();
  };

  const handleSuccess = () => {
    finishGoogleOnboarding();
    onClose();
    navigate('/admin');
  };

  return (
    <div
      onClick={handleClose}
      className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 overflow-y-auto"
    >
      <div onClick={(e) => e.stopPropagation()} className="w-full flex justify-center">
        {needsInitialSetup ? (
          <FirstRunSetupView isModal onClose={handleClose} onSuccess={handleSuccess} />
        ) : (
          <AuthView isModal onClose={handleClose} onSuccess={handleSuccess} />
        )}
      </div>
    </div>
  );
};

// ============================================================================
// 8. PAYLAŞIM, QR KOD & AYAR MODALLARI (SHARE & WORKSPACE SETTINGS)
// ============================================================================

const ShareModal: React.FC<{
  open: boolean;
  mode: 'workspace' | 'folder';
  folder?: FolderItem | null;
  onClose: () => void;
}> = ({ open, mode, folder, onClose }) => {
  const { user, updateWorkspaceSettings } = useAuthStore();
  const { updateFolderMeta } = useAdminStore();

  const [tab, setTab] = useState<'link' | 'security' | 'embed'>('link');
  const [copied, setCopied] = useState(false);
  const [copiedEmbed, setCopiedEmbed] = useState(false);
  const [pinDraft, setPinDraft] = useState('');
  const [slugDraft, setSlugDraft] = useState('');
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTab('link');
    setCopied(false);
    setCopiedEmbed(false);
    setSavedNotice(null);
    if (mode === 'workspace' && user) {
      setPinDraft(user.workspacePin || '');
      setSlugDraft(user.workspaceSlug || '');
    } else if (mode === 'folder' && folder) {
      setPinDraft(folder.sharePin || '');
    }
  }, [open, mode, user, folder]);

  if (!open || !user) return null;
  if (mode === 'folder' && !folder) return null;

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3001';
  const sharePath =
    mode === 'workspace'
      ? `/v/${user.workspaceSlug}`
      : `/d/${folder!.shareToken || folder!.id}`;
  const shareUrl = `${origin}${sharePath}`;
  const embedCode = `<iframe src="${shareUrl}?embed=1" width="100%" height="760" style="border:0;border-radius:16px;" allowfullscreen loading="lazy"></iframe>`;

  const cardTitle = mode === 'workspace' ? user.workspaceTitle : folder!.title;
  const cardSubtitle = mode === 'workspace' ? user.workspaceSubtitle : `${user.displayName} • ${folder!.pages.length} Sayfa Evrak`;

  const copyText = (text: string, which: 'link' | 'embed') => {
    navigator.clipboard?.writeText(text).catch(() => {});
    if (which === 'link') {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } else {
      setCopiedEmbed(true);
      setTimeout(() => setCopiedEmbed(false), 1800);
    }
  };

  const handleSaveSecurity = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavedNotice(null);
    if (mode === 'workspace') {
      const ok = await updateWorkspaceSettings({
        workspacePin: pinDraft.trim(),
        workspaceSlug: slugDraft.trim() || undefined,
      });
      if (ok) setSavedNotice('Masaüstü paylaşım güvenlik ayarları kaydedildi.');
    } else if (folder) {
      const updated = await updateFolderMeta(folder.id, { sharePin: pinDraft.trim() });
      if (updated) setSavedNotice('Dosya paylaşım şifresi güncellendi.');
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden">
        <div className="px-6 py-4 bg-slate-950/60 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400">
              <Share2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">
                {mode === 'workspace' ? 'Tüm Masaüstünü (Vitrini) Paylaş' : 'Tekil Dosyayı Paylaş'}
              </h3>
              <p className="text-[11px] text-slate-400 truncate max-w-xs">{cardTitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Sekmeler */}
        <div className="px-6 pt-3 flex items-center gap-2 border-b border-slate-800 bg-slate-950/30">
          <button
            type="button"
            onClick={() => setTab('link')}
            className={`pb-2.5 px-2 text-xs font-bold border-b-2 inline-flex items-center gap-1.5 transition-colors ${
              tab === 'link'
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <QrCode className="w-3.5 h-3.5" />
            Link & QR Kod
          </button>
          <button
            type="button"
            onClick={() => setTab('security')}
            className={`pb-2.5 px-2 text-xs font-bold border-b-2 inline-flex items-center gap-1.5 transition-colors ${
              tab === 'security'
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <Lock className="w-3.5 h-3.5" />
            Erişim & Güvenlik
          </button>
          <button
            type="button"
            onClick={() => setTab('embed')}
            className={`pb-2.5 px-2 text-xs font-bold border-b-2 inline-flex items-center gap-1.5 transition-colors ${
              tab === 'embed'
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            Web Sitesine Göm (Embed)
          </button>
        </div>

        <div className="p-6">
          {tab === 'link' && (
            <div className="space-y-5">
              <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-3.5 py-2.5 text-[11px] text-emerald-200 leading-relaxed">
                <strong>Vatandaş (Salt-Okunur) Modu:</strong> Bu linke giren kişiler hiçbir düzenleme/admin butonu görmeden yalnızca {mode === 'workspace' ? 'yayında olan dosyalarınızı' : 'bu 3D dosyayı'} inceleyebilir.
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Paylaşım Bağlantısı
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={shareUrl}
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                    className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs font-mono text-amber-300 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => copyText(shareUrl, 'link')}
                    className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs inline-flex items-center gap-1.5 shrink-0 transition-colors"
                  >
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'Kopyalandı' : 'Kopyala'}
                  </button>
                  <a
                    href={sharePath}
                    target="_blank"
                    rel="noreferrer"
                    title="Yeni Sekmede Aç"
                    className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-5 bg-slate-950/70 border border-slate-800 rounded-2xl p-4">
                <div className="p-2.5 bg-white rounded-xl shadow-lg shrink-0">
                  <QrCodeSvg value={shareUrl} size={156} />
                </div>
                <div className="flex-1 text-center sm:text-left">
                  <h4 className="text-sm font-bold text-white mb-1">
                    Banko & İlan Panosu QR Kodu
                  </h4>
                  <p className="text-xs text-slate-400 leading-relaxed mb-3.5">
                    Bu QR kodu indirip bankonuza veya web sitenize koyabilirsiniz. Vatandaşlar telefon kamerasıyla okutup dosyayı anında 3D görebilir.
                  </p>
                  <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        downloadQrPosterPng(shareUrl, cardTitle, cardSubtitle, user.displayName)
                      }
                      className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-amber-500 hover:text-slate-950 text-slate-200 font-bold text-xs inline-flex items-center gap-1.5 border border-slate-700 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      QR Kartı İndir (PNG)
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        printQrPoster(shareUrl, cardTitle, cardSubtitle, user.displayName)
                      }
                      className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs inline-flex items-center gap-1.5 border border-slate-700 transition-colors"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      Yazdır
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === 'security' && (
            <form onSubmit={handleSaveSecurity} className="space-y-4">
              {mode === 'folder' && folder && (
                <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-950/80 border border-slate-800">
                  <div>
                    <div className="text-xs font-bold text-white">Yayın Durumu (Vatandaş Erişimi)</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      Taslak modundaki dosyalar paylaşılan masaüstünde görünmez.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      updateFolderMeta(folder.id, { isPublished: !(folder.isPublished !== false) })
                    }
                    className={`px-3 py-1.5 rounded-lg text-xs font-extrabold inline-flex items-center gap-1.5 transition-colors ${
                      folder.isPublished !== false
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : 'bg-slate-800 text-slate-400 border border-slate-700'
                    }`}
                  >
                    {folder.isPublished !== false ? (
                      <>
                        <Globe className="w-3.5 h-3.5" /> Yayında
                      </>
                    ) : (
                      <>
                        <EyeOff className="w-3.5 h-3.5" /> Taslak (Gizli)
                      </>
                    )}
                  </button>
                </div>
              )}

              {mode === 'workspace' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Özel Masaüstü Kısa Link Kodu
                  </label>
                  <div className="flex items-center">
                    <span className="px-3 py-2 rounded-l-xl bg-slate-800 border border-r-0 border-slate-700 text-xs text-slate-400 font-mono">
                      /v/
                    </span>
                    <input
                      type="text"
                      value={slugDraft}
                      onChange={(e) => setSlugDraft(e.target.value)}
                      placeholder="imar-mudurlugu"
                      className="flex-1 px-3 py-2 rounded-r-xl bg-slate-950 border border-slate-700 text-xs font-mono text-white focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  İsteğe Bağlı Erişim Şifresi / PIN (Boş bırakılırsa herkese açık olur)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={pinDraft}
                    onChange={(e) => setPinDraft(e.target.value)}
                    placeholder="Örn: 1234 (Boş = Şifresiz)"
                    className="flex-1 px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                  {pinDraft && (
                    <button
                      type="button"
                      onClick={() => setPinDraft('')}
                      className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-300"
                    >
                      Şifreyi Kaldır
                    </button>
                  )}
                </div>
              </div>

              {savedNotice && (
                <div className="px-3 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs font-medium">
                  {savedNotice}
                </div>
              )}

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs inline-flex items-center gap-1.5 transition-colors"
                >
                  <Check className="w-4 h-4" />
                  Güvenlik Ayarlarını Kaydet
                </button>
              </div>
            </form>
          )}

          {tab === 'embed' && (
            <div className="space-y-4">
              <p className="text-xs text-slate-300 leading-relaxed">
                Aşağıdaki HTML kodunu kopyalayıp kurumunuzun veya ofisinizin mevcut web sitesine yapıştırarak bu 3D rehber ekranını doğrudan sayfanızın içine gömebilirsiniz:
              </p>
              <textarea
                readOnly
                rows={4}
                value={embedCode}
                onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                className="w-full p-3 rounded-xl bg-slate-950 border border-slate-700 text-xs font-mono text-sky-300 focus:outline-none resize-none"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => copyText(embedCode, 'embed')}
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs inline-flex items-center gap-1.5 transition-colors"
                >
                  {copiedEmbed ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copiedEmbed ? 'Embed Kodu Kopyalandı!' : 'Embed Kodunu Kopyala'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const WorkspaceSettingsModal: React.FC<{ open: boolean; onClose: () => void }> = ({
  open,
  onClose,
}) => {
  const { user, googleClientId, allowPublicRegistration, isSubmitting, error, updateWorkspaceSettings } =
    useAuthStore();

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [workspaceTitle, setWorkspaceTitle] = useState('');
  const [workspaceSubtitle, setWorkspaceSubtitle] = useState('');
  const [workspaceSlug, setWorkspaceSlug] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [gClientId, setGClientId] = useState('');
  const [allowReg, setAllowReg] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (open && user) {
      setUsername(user.username);
      setDisplayName(user.displayName);
      setWorkspaceTitle(user.workspaceTitle);
      setWorkspaceSubtitle(user.workspaceSubtitle);
      setWorkspaceSlug(user.workspaceSlug);
      setNewPassword('');
      setGClientId(googleClientId || '');
      setAllowReg(allowPublicRegistration);
      setSaved(false);
    }
  }, [open, user, googleClientId, allowPublicRegistration]);

  if (!open || !user) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(false);
    const ok = await updateWorkspaceSettings({
      username: username.trim(),
      displayName: displayName.trim(),
      workspaceTitle: workspaceTitle.trim(),
      workspaceSubtitle: workspaceSubtitle.trim(),
      workspaceSlug: workspaceSlug.trim(),
      newPassword: newPassword || undefined,
      ...(user.role === 'superadmin'
        ? { googleClientId: gClientId.trim(), allowPublicRegistration: allowReg }
        : {}),
    });
    if (ok) {
      setNewPassword('');
      setSaved(true);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden max-h-[92vh] flex flex-col">
        <div className="px-6 py-4 bg-slate-950/60 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Settings className="w-5 h-5 text-amber-400" />
            <h3 className="text-sm font-bold text-white">Masaüstü ve Hesap Ayarları</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-4 overflow-y-auto">
          {error && (
            <div className="px-3 py-2 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-200 text-xs">
              {error}
            </div>
          )}
          {saved && (
            <div className="px-3 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs font-semibold">
              Ayarlarınız başarıyla kaydedildi.
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Kurum / Birim veya Ad Soyad
              </label>
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Kullanıcı Adı
              </label>
              <input
                type="text"
                required
                minLength={3}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs font-mono text-amber-300 focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Paylaşılan Vitrin Başlığı
            </label>
            <input
              type="text"
              required
              value={workspaceTitle}
              onChange={(e) => setWorkspaceTitle(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-amber-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Vitrin Alt Açıklaması
            </label>
            <input
              type="text"
              value={workspaceSubtitle}
              onChange={(e) => setWorkspaceSubtitle(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-amber-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Özel Vitrin URL Kodu (/v/...)
            </label>
            <input
              type="text"
              required
              value={workspaceSlug}
              onChange={(e) => setWorkspaceSlug(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs font-mono text-amber-300 focus:outline-none focus:border-amber-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              {user.hasPassword === false
                ? 'Şifre Belirle (Kullanıcı adınızla giriş yapmak isterseniz)'
                : 'Şifre Değiştir (Değiştirmek istemiyorsanız boş bırakın)'}
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Yeni şifre..."
              className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-amber-500"
            />
          </div>

          {user.role === 'superadmin' && (
            <div className="pt-3 border-t border-slate-800 space-y-3">
              <div className="text-[11px] font-bold text-amber-400 uppercase tracking-wider">
                Platform Yönetici Ayarları
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Google OAuth Client ID (Online Gerçek Google Girişi İçin)
                </label>
                <input
                  type="text"
                  value={gClientId}
                  onChange={(e) => setGClientId(e.target.value)}
                  placeholder="xxxx.apps.googleusercontent.com"
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs font-mono text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <label className="flex items-center justify-between p-3 rounded-xl bg-slate-950/70 border border-slate-800 cursor-pointer">
                <div>
                  <div className="text-xs font-semibold text-white">Yeni Kullanıcı Kayıtlarına İzin Ver</div>
                  <div className="text-[11px] text-slate-400">
                    Diğer birimlerin veya kullanıcıların kendi çalışma alanını açmasına izin ver.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={allowReg}
                  onChange={(e) => setAllowReg(e.target.checked)}
                  className="w-4 h-4 accent-amber-500"
                />
              </label>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300"
            >
              Kapat
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs inline-flex items-center gap-1.5"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Değişiklikleri Kaydet
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ============================================================================
// 8.5. ONE-PAGE KARŞILAMA SAYFASI (WARM EDITORIAL DOCUMENT EXPERIENCE)
// ============================================================================

export const LANDING_BRAND_NAME = 'Evrak Yönetim Paneli';

const GoldFolderMark: React.FC<{ className?: string }> = ({ className = 'w-7 h-7' }) => (
  <svg viewBox="0 0 32 26" fill="none" className={className} aria-hidden="true">
    <path
      d="M3 6.5C3 4.84315 4.34315 3.5 6 3.5H12.2C13.05 3.5 13.86 3.86 14.43 4.49L16.1 6.35H26C27.6569 6.35 29 7.69315 29 9.35V20.5C29 22.1569 27.6569 23.5 26 23.5H6C4.34315 23.5 3 22.1569 3 20.5V6.5Z"
      stroke="#DFA85B"
      strokeWidth="1.8"
    />
    <path
      d="M5.5 9.5H27.5"
      stroke="#DFA85B"
      strokeWidth="1.3"
      strokeOpacity="0.65"
    />
  </svg>
);

const LandingNavbar: React.FC<{
  user: AuthUser | null;
  onOpenAuth: () => void;
  onLogout: () => void;
}> = ({ user, onOpenAuth, onLogout }) => {
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileOpen]);

  const navItems = [
    { href: '#nasil-calisir', label: 'Nasıl Çalışır?' },
    { href: '#ozellikler', label: 'Özellikler' },
    { href: '#kimler-icin', label: 'Kimler İçin?' },
    { href: '#sss', label: 'SSS' },
  ];

  return (
    <header className="relative z-30 bg-[#141A16]/95 border-b border-white/10">
      <div className="max-w-[1220px] mx-auto px-5 sm:px-8 h-20 flex items-center justify-between gap-4">
        <a
          href="#"
          className="inline-flex items-center gap-3 text-[#F6F2EA] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#DFA85B] rounded-lg"
        >
          <GoldFolderMark className="w-7 h-7 shrink-0" />
          <span className="font-editorial-serif text-lg sm:text-[20px] font-normal tracking-tight text-[#F6F2EA]">
            {LANDING_BRAND_NAME}
          </span>
        </a>

        <nav aria-label="Sayfa içi menü" className="hidden md:flex items-center gap-9">
          {navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-[14px] font-medium text-[#D9D4C8] hover:text-[#E7B970] transition-colors"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="hidden md:flex items-center gap-2.5">
          {user && (
            <button
              type="button"
              onClick={onLogout}
              title="Çıkış Yap"
              className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-[#E5E0D5] transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onOpenAuth}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full text-[#1A221E] font-bold text-[13.5px] shadow-[0_6px_20px_rgba(223,168,91,0.3)] transition-all hover:brightness-105 hover:-translate-y-0.5"
            style={{
              background: 'linear-gradient(135deg, #E8BC75 0%, #CE964B 100%)',
            }}
          >
            <span>Panele Giriş</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        <button
          type="button"
          aria-label={mobileOpen ? 'Menüyü kapat' : 'Menüyü aç'}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((v: boolean) => !v)}
          className="md:hidden p-2.5 rounded-xl bg-white/10 border border-white/15 text-[#F6F2EA]"
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {mobileOpen && (
        <div className="md:hidden bg-[#1B2822] border-t border-white/10 px-5 py-4 space-y-3 shadow-2xl">
          <nav aria-label="Mobil menü" className="flex flex-col space-y-1">
            {navItems.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className="px-3 py-2.5 rounded-lg text-sm font-medium text-[#F6F2EA] hover:bg-white/10"
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="pt-2 border-t border-white/10 flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setMobileOpen(false);
                onOpenAuth();
              }}
              className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full text-[#1A221E] font-bold text-sm"
              style={{
                background: 'linear-gradient(135deg, #E8BC75 0%, #CE964B 100%)',
              }}
            >
              <span>Panele Giriş</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            {user && (
              <button
                type="button"
                onClick={() => {
                  setMobileOpen(false);
                  onLogout();
                }}
                aria-label="Çıkış Yap"
                className="p-3 rounded-full bg-white/10 text-[#F6F2EA]"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
};

const HeroBinderAnnotations: React.FC<{
  isFullWidth: boolean;
  onToggle: (key: 'imza' | 'kase' | 'a3') => void;
}> = ({ isFullWidth, onToggle }) => {
  const dx = isFullWidth ? 416 : 0;
  const viewBox = isFullWidth ? '0 0 1376 768' : '0 0 960 768';

  return (
    <>
      {/* Fiziksel Masaüstü Pirinç / Kehribar İsimlik Etiketi */}
      <div
        aria-hidden="true"
        className={`pointer-events-none select-none absolute -rotate-2 px-3 py-1 rounded-sm bg-[#B98751]/90 border border-[#E3B87E]/75 shadow-[0_6px_16px_rgba(0,0,0,0.4)] ${
          isFullWidth ? 'left-[59.5%] bottom-[4.5%]' : 'left-[28%] bottom-[4%]'
        }`}
      >
        <span className="font-editorial-serif italic text-[9.5px] sm:text-[11px] font-semibold tracking-[0.14em] text-[#22180E] uppercase">
          ÖRNEK DOSYA
        </span>
      </div>

      {/* Vektörel Kılavuz Çizgileri */}
      <svg
        viewBox={viewBox}
        className="pointer-events-none absolute inset-0 w-full h-full"
        aria-hidden="true"
      >
        {/* A3 Proje paftası kılavuzu */}
        <path
          d={`M ${835 + dx} 72 Q ${825 + dx} 115 ${785 + dx} 150`}
          fill="none"
          stroke="#E5B567"
          strokeWidth="2.5"
          strokeDasharray="4 3"
        />
        <circle cx={785 + dx} cy="150" r="4.5" fill="#E5B567" />

        {/* Mavi resmi kaşe kılavuzu */}
        <path
          d={`M ${852 + dx} 380 Q ${842 + dx} 446 ${805 + dx} 504`}
          fill="none"
          stroke="#E5B567"
          strokeWidth="2.5"
        />
        <circle cx={805 + dx} cy="504" r="4.5" fill="#E5B567" />

        {/* Sarı imza alanı kılavuzu */}
        <path
          d={`M ${635 + dx} 678 Q ${685 + dx} 592 ${738 + dx} 496`}
          fill="none"
          stroke="#E5B567"
          strokeWidth="2.5"
        />
        <circle cx={738 + dx} cy="496" r="4.5" fill="#E5B567" />
      </svg>

      {/* 1. A3 Proje Etiketi */}
      <button
        type="button"
        onClick={() => onToggle('a3')}
        className={`absolute px-3 sm:px-3.5 py-1 rounded-full text-[10px] sm:text-xs font-bold text-[#1A221E] shadow-[0_6px_18px_rgba(0,0,0,0.4)] transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-white cursor-pointer ${
          isFullWidth ? 'top-[6%] right-[4.2%]' : 'top-[6%] right-[6%]'
        }`}
        style={{
          background: 'linear-gradient(135deg, #EBC17C 0%, #CE964B 100%)',
        }}
      >
        A3 Proje
      </button>

      {/* 2. Kaşe Alanı Etiketi */}
      <button
        type="button"
        onClick={() => onToggle('kase')}
        className={`absolute px-3.5 sm:px-4 py-1 sm:py-1.5 rounded-full bg-[#F5DFC0] hover:bg-[#F9E8CE] border border-[#D8A45A] text-[10px] sm:text-xs font-bold text-[#1F2925] shadow-[0_8px_22px_rgba(0,0,0,0.38)] transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E5B567] cursor-pointer ${
          isFullWidth ? 'top-[44.5%] right-[1.8%]' : 'top-[44.5%] right-[2%]'
        }`}
      >
        Kaşe Alanı
      </button>

      {/* 3. İmza Burada Etiketi */}
      <button
        type="button"
        onClick={() => onToggle('imza')}
        className={`absolute px-3.5 sm:px-4 py-1 sm:py-1.5 rounded-full bg-[#F5DFC0] hover:bg-[#F9E8CE] border border-[#D8A45A] text-[10px] sm:text-xs font-bold text-[#1F2925] shadow-[0_8px_22px_rgba(0,0,0,0.38)] transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E5B567] cursor-pointer ${
          isFullWidth ? 'bottom-[7%] left-[69%]' : 'bottom-[7%] left-[56%]'
        }`}
      >
        İmza Burada
      </button>
    </>
  );
};

const HeroSection: React.FC<{ onOpenAuth: () => void }> = ({ onOpenAuth }) => {
  const [selectedCallout, setSelectedCallout] = useState<'imza' | 'kase' | 'a3' | null>(null);

  const calloutDetails: Record<'imza' | 'kase' | 'a3', { title: string; desc: string }> = {
    imza: {
      title: 'İmza Burada',
      desc: 'Başvuru sahibinin ıslak imzası doğrudan evrak üzerinde işaretlenen kehribar kutuda gösterilir.',
    },
    kase: {
      title: 'Kaşe Alanı',
      desc: 'Kurum veya proje müellifi kaşesinin basılacağı nokta karışıklığa yer bırakmadan vurgulanır.',
    },
    a3: {
      title: 'A3 Proje Paftası',
      desc: 'Geniş teknik çizimler ve katlanabilir A3 projeler aynı klasör düzeni içinde rahatça açılıp incelenir.',
    },
  };

  const toggleCallout = (key: 'imza' | 'kase' | 'a3') => {
    setSelectedCallout((prev) => (prev === key ? null : key));
  };

  return (
    <section className="relative w-full bg-[#18120C] overflow-hidden">
      {/* Masaüstü Tam Genişlik Birleşik Ceviz Masa & Klasör Sahnesi (01_hero_arka_plan.png) */}
      <div className="hidden lg:block relative max-w-[1536px] mx-auto">
        <img
          src="/assets/landing/hero-bg.webp"
          width={1376}
          height={768}
          alt="Ceviz masa üzerinde açık kraft klasör, resmi evrak sayfası, sarı vurgulu imza alanı, mavi kurum kaşesi ve katlanabilir A3 proje paftası"
          className="w-full h-auto block select-none"
          style={{
            maskImage:
              'linear-gradient(to right, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 4%, rgba(0,0,0,1) 96%, rgba(0,0,0,0) 100%)',
            WebkitMaskImage:
              'linear-gradient(to right, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 4%, rgba(0,0,0,1) 96%, rgba(0,0,0,0) 100%)',
          }}
        />
        {/* Navbar Altı Yumuşak Gölge Geçişi */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-20"
          style={{
            background: 'linear-gradient(to bottom, rgba(20,26,22,0.55) 0%, rgba(20,26,22,0) 100%)',
          }}
        />
        {/* Sol Metin Okunabilirliği İçin Sıcak Editoryal Gradyan */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'linear-gradient(90deg, rgba(17,24,20,0.84) 0%, rgba(19,25,20,0.62) 34%, rgba(22,18,14,0.14) 52%, rgba(0,0,0,0) 68%)',
          }}
        />
        {/* 1376x768 Tam Sahne Etkileşimli İşaretçiler */}
        <div className="absolute inset-0">
          <HeroBinderAnnotations isFullWidth onToggle={toggleCallout} />
        </div>
      </div>

      {/* Sol Başlık ve CTA Alanı (Masaüstünde tam sahne üzerinde, mobilde üstte yığılı) */}
      <div className="relative z-20 lg:absolute lg:inset-0 lg:flex lg:items-center lg:pointer-events-none bg-gradient-to-b from-[#141A16] via-[#151712] to-[#18120C] lg:bg-none">
        <div className="max-w-[1240px] mx-auto px-5 sm:px-8 pt-8 pb-6 lg:py-0 w-full">
          <div className="lg:w-[46%] lg:max-w-[530px] space-y-5 relative z-30 lg:pointer-events-auto">
            <div className="flex items-center gap-3">
              <span className="text-[11px] sm:text-xs font-bold tracking-[0.14em] uppercase text-[#DFA85B]">
                KURUMLAR VE BAŞVURU SÜREÇLERİ İÇİN
              </span>
              <span aria-hidden="true" className="h-px flex-1 max-w-[90px] bg-[#DFA85B]/45" />
            </div>

            <h1 className="font-editorial-serif text-[38px] sm:text-[50px] lg:text-[56px] font-normal leading-[1.06] tracking-[-0.01em] text-[#F6F2EA] drop-shadow-[0_2px_12px_rgba(0,0,0,0.45)]">
              Başvuru dosyaları,
              <br />
              artık herkes için
              <br />
              <span className="text-[#DFA85B]">anlaşılır.</span>
            </h1>

            <p className="text-[14.5px] sm:text-[15.5px] text-[#DED8CC] leading-relaxed max-w-[440px] drop-shadow-[0_1px_6px_rgba(0,0,0,0.5)]">
              Evraklarınızı dijital bir klasör gibi paylaşın. Sayfalar kolayca incelensin; imza, kaşe ve eksik belge noktaları tam olması gereken yerde gösterilsin.
            </p>

            <div className="flex flex-wrap items-center gap-3.5 pt-1">
              <button
                type="button"
                onClick={onOpenAuth}
                className="inline-flex items-center gap-2.5 px-7 py-3.5 rounded-full text-[#1A221E] font-bold text-sm shadow-[0_10px_28px_rgba(223,168,91,0.35)] transition-all hover:brightness-105 hover:-translate-y-0.5"
                style={{
                  background: 'linear-gradient(135deg, #E8BC75 0%, #CE964B 100%)',
                }}
              >
                <span>Panele Giriş</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <a
                href="#nasil-calisir"
                className="inline-flex items-center gap-2.5 px-6 py-3.5 rounded-full bg-[#19241E]/85 hover:bg-[#24342C] text-[#F3EFE6] border border-[#DFA85B]/50 font-semibold text-sm backdrop-blur-xs transition-colors"
              >
                <span>Nasıl Çalışır?</span>
                <span className="w-5 h-5 rounded-full border border-[#DFA85B]/75 flex items-center justify-center text-[#DFA85B]">
                  <Play className="w-2.5 h-2.5 fill-current translate-x-[0.5px]" />
                </span>
              </a>
            </div>

            <div className="pt-2 flex items-center gap-2.5 text-xs sm:text-[13px] text-[#DFD9CE] drop-shadow-[0_1px_4px_rgba(0,0,0,0.6)]">
              <FileText className="w-4 h-4 text-[#DFA85B] shrink-0" />
              <span>PDF, Word, Excel ve görsel belgeler tek bir dosya deneyiminde.</span>
            </div>

            {selectedCallout && (
              <div
                role="status"
                className="mt-2 rounded-2xl bg-[#1A2620]/95 border border-[#DFA85B]/65 px-4 py-3 text-xs text-[#F6F2EA] flex items-center justify-between gap-3 shadow-2xl backdrop-blur-md"
              >
                <div>
                  <strong className="text-[#E8BC75] font-bold mr-2">
                    {calloutDetails[selectedCallout].title}:
                  </strong>
                  <span>{calloutDetails[selectedCallout].desc}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedCallout(null)}
                  aria-label="Kapat"
                  className="p-1 rounded-lg text-[#D7D1C5] hover:text-white shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobil / Tablet Klasör Görseli (Alt Yığılı) */}
      <div className="lg:hidden relative px-4 sm:px-8 pb-8">
        <div className="relative mx-auto max-w-[680px]">
          <img
            src="/assets/landing/hero-binder.webp"
            width={960}
            height={768}
            alt="Ceviz masa üzerinde açık duran telli başvuru klasörü, ıslak imza alanı, mavi resmi kaşe ve katlanabilir A3 proje paftası"
            className="w-full h-auto block select-none"
            style={{
              maskImage:
                'linear-gradient(to right, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 12%, rgba(0,0,0,1) 92%, rgba(0,0,0,0) 100%), linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 10%, rgba(0,0,0,1) 88%, rgba(0,0,0,0) 100%)',
              WebkitMaskImage:
                'linear-gradient(to right, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 12%, rgba(0,0,0,1) 92%, rgba(0,0,0,0) 100%), linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 10%, rgba(0,0,0,1) 88%, rgba(0,0,0,0) 100%)',
              maskComposite: 'intersect',
              WebkitMaskComposite: 'source-in',
            }}
          />
          <HeroBinderAnnotations isFullWidth={false} onToggle={toggleCallout} />
        </div>
      </div>
    </section>
  );
};

const BenefitsSection: React.FC<{ onOpenAuth: () => void }> = ({ onOpenAuth }) => (
  <section id="ozellikler" className="max-w-[1220px] mx-auto px-5 sm:px-8 pt-14 pb-10 sm:pt-18 sm:pb-12">
    {/* Üst İnce Çizgili Başlık */}
    <div className="text-center max-w-3xl mx-auto mb-10 sm:mb-12">
      <div className="flex items-center justify-center gap-4 mb-3">
        <span aria-hidden="true" className="h-px w-12 sm:w-28 bg-[#D5CBB8]" />
        <span className="text-[11px] sm:text-xs font-bold tracking-[0.15em] uppercase text-[#5C6660]">
          SIRADAN BİR BELGE PAYLAŞIMINDAN ÇOK DAHA FAZLASI.
        </span>
        <span aria-hidden="true" className="h-px w-12 sm:w-28 bg-[#D5CBB8]" />
      </div>

      <h2 className="font-editorial-serif text-[30px] sm:text-[42px] font-normal text-[#1F2925] leading-[1.15]">
        Evrakları yalnızca göndermeyin,
        <br />
        nasıl inceleneceğini de gösterin.
      </h2>
    </div>

    {/* Asimetrik Bento Grid (Sol 1 Büyük Kart, Sağ 2 Yatay Kart) */}
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
      {/* Sol Büyük Kart: Gerçek bir klasör deneyimi */}
      <article className="lg:col-span-7 rounded-[24px] bg-[#FAF6EE] border border-[#E5DEC9] shadow-[0_12px_32px_rgba(32,42,39,0.06)] overflow-hidden grid grid-cols-1 sm:grid-cols-12">
        <div className="sm:col-span-6 relative min-h-[250px] sm:min-h-[300px] overflow-hidden bg-[#FAF6EE]">
          <img
            src="/assets/landing/bento-folder.webp"
            width={896}
            height={920}
            alt="Açık fiziksel klasör ve çevrilen sayfa üzerinde İmza burada işaretçisi"
            className="w-full h-full object-cover"
            style={{
              maskImage: 'linear-gradient(to right, rgba(0,0,0,1) 66%, rgba(0,0,0,0) 100%)',
              WebkitMaskImage: 'linear-gradient(to right, rgba(0,0,0,1) 66%, rgba(0,0,0,0) 100%)',
            }}
            loading="lazy"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none hidden sm:block absolute inset-y-0 right-0 w-16 bg-gradient-to-r from-transparent to-[#FAF6EE]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none sm:hidden absolute inset-x-0 bottom-0 h-10 bg-gradient-to-b from-transparent to-[#FAF6EE]"
          />
          {/* Vektörel İmza Burada Etiketi + İşaret Çizgisi */}
          <svg
            viewBox="0 0 300 240"
            className="pointer-events-none absolute inset-0 w-full h-full"
            aria-hidden="true"
          >
            <path
              d="M 210 106 Q 204 142 192 170"
              fill="none"
              stroke="#E5B567"
              strokeWidth="2"
            />
            <circle cx="192" cy="170" r="3.5" fill="#E5B567" />
          </svg>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-[38%] right-[14%] px-3.5 py-1 rounded-full bg-[#F5DFC0] border border-[#D8A45A] text-[11px] font-bold text-[#1F2925] shadow-md"
          >
            İmza burada
          </div>
        </div>

        <div className="sm:col-span-6 p-6 sm:p-8 flex flex-col justify-between relative">
          <div className="space-y-3 my-auto">
            <div className="flex items-start gap-2.5">
              <Edit2 className="w-5 h-5 text-[#234C43] mt-1.5 shrink-0" />
              <h3 className="font-editorial-serif text-2xl sm:text-[26px] font-bold text-[#1F2925] leading-tight">
                Gerçek bir klasör
                <br />
                deneyimi
              </h3>
            </div>
            <p className="text-sm sm:text-[15px] text-[#5C6660] leading-relaxed pl-7">
              Belgeler arasında sayfa çevirerek gezinin, detayları inceleyin.
            </p>
          </div>

          <div className="flex justify-end pt-4">
            <button
              type="button"
              onClick={onOpenAuth}
              aria-label="Gerçek klasör deneyimini incele"
              className="w-9 h-9 rounded-full bg-[#F2ECE1] hover:bg-[#234C43] text-[#202A27] hover:text-[#FAF6EE] border border-[#DED5C3] flex items-center justify-center transition-colors"
            >
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </article>

      {/* Sağ Sütun: İki Yatay Kart */}
      <div className="lg:col-span-5 flex flex-col gap-6 justify-between">
        {/* Sağ Üst Kart: Önemli noktalar hep görünür */}
        <article className="flex-1 rounded-[24px] bg-[#FAF6EE] border border-[#E5DEC9] shadow-[0_12px_32px_rgba(32,42,39,0.06)] overflow-hidden grid grid-cols-1 sm:grid-cols-12 items-stretch">
          <div className="sm:col-span-5 relative min-h-[135px] overflow-hidden bg-[#FAF6EE]">
            <img
              src="/assets/landing/bento-stamp.webp"
              width={1376}
              height={768}
              alt="Evrak üzerinde imza ve mavi kaşe alanı"
              className="w-full h-full object-cover"
              style={{
                maskImage: 'linear-gradient(to right, rgba(0,0,0,1) 70%, rgba(0,0,0,0) 100%)',
                WebkitMaskImage: 'linear-gradient(to right, rgba(0,0,0,1) 70%, rgba(0,0,0,0) 100%)',
              }}
              loading="lazy"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none hidden sm:block absolute inset-y-0 right-0 w-12 bg-gradient-to-r from-transparent to-[#FAF6EE]"
            />
          </div>
          <div className="sm:col-span-7 flex items-center justify-between gap-3 p-5">
            <div>
              <h3 className="font-editorial-serif text-xl font-bold text-[#1F2925] leading-snug">
                Önemli noktalar
                <br />
                hep görünür
              </h3>
              <p className="text-xs sm:text-[13.5px] text-[#5C6660] mt-1.5 leading-relaxed">
                İmza, kaşe ve onay alanlarını doğrudan işaretleyin.
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenAuth}
              aria-label="Önemli noktaları incele"
              className="w-8 h-8 rounded-full bg-[#F2ECE1] hover:bg-[#234C43] text-[#202A27] hover:text-[#FAF6EE] border border-[#DED5C3] flex items-center justify-center shrink-0 transition-colors"
            >
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </article>

        {/* Sağ Alt Kart: Büyük projeler de yerini bulsun */}
        <article className="flex-1 rounded-[24px] bg-[#FAF6EE] border border-[#E5DEC9] shadow-[0_12px_32px_rgba(32,42,39,0.06)] overflow-hidden grid grid-cols-1 sm:grid-cols-12 items-stretch">
          <div className="sm:col-span-5 relative min-h-[135px] overflow-hidden bg-[#FAF6EE]">
            <img
              src="/assets/landing/bento-a3.webp"
              width={1376}
              height={768}
              alt="Açılmış geniş A3 mimari proje çizimi"
              className="w-full h-full object-cover"
              style={{
                maskImage: 'linear-gradient(to right, rgba(0,0,0,1) 70%, rgba(0,0,0,0) 100%)',
                WebkitMaskImage: 'linear-gradient(to right, rgba(0,0,0,1) 70%, rgba(0,0,0,0) 100%)',
              }}
              loading="lazy"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none hidden sm:block absolute inset-y-0 right-0 w-12 bg-gradient-to-r from-transparent to-[#FAF6EE]"
            />
          </div>
          <div className="sm:col-span-7 flex items-center justify-between gap-3 p-5">
            <div>
              <h3 className="font-editorial-serif text-xl font-bold text-[#1F2925] leading-snug">
                Büyük projeler
                <br />
                de yerini bulsun
              </h3>
              <p className="text-xs sm:text-[13.5px] text-[#5C6660] mt-1.5 leading-relaxed">
                A3 paftaları rahatça açın ve inceleyin.
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenAuth}
              aria-label="A3 proje desteğini incele"
              className="w-8 h-8 rounded-full bg-[#F2ECE1] hover:bg-[#234C43] text-[#202A27] hover:text-[#FAF6EE] border border-[#DED5C3] flex items-center justify-center shrink-0 transition-colors"
            >
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </article>
      </div>
    </div>
  </section>
);

const HowItWorksSection: React.FC<{ onOpenAuth: () => void }> = ({ onOpenAuth }) => {
  const steps = [
    {
      num: '01',
      img: '/assets/landing/step-01-folder.webp',
      alt: 'Klasör içinde toplanmış başvuru belgeleri',
      title: 'Evraklarınızı bir araya getirin',
      desc: 'PDF, Word, Excel ve görsel belgelerinizi tek bir klasörde toplayın.',
    },
    {
      num: '02',
      img: '/assets/landing/step-02-pen.webp',
      alt: 'Sayfa üzerinde kalemle işaretlenen imza alanı',
      title: 'Önemli noktaları işaretleyin',
      desc: 'İmza, kaşe ve onay alanlarını belirginleştirin.',
    },
    {
      num: '03',
      img: '/assets/landing/step-03-qr.webp',
      alt: 'Akıllı telefonda QR kod ile dosya paylaşımı',
      title: 'Bağlantı veya QR kod ile paylaşın',
      desc: 'Dosyanızı kolayca paylaşın.',
    },
  ];

  return (
    <section id="nasil-calisir" className="max-w-[1220px] mx-auto px-5 sm:px-8 py-8 sm:py-10">
      <div
        className="rounded-[28px] p-7 sm:p-10 lg:p-12 text-[#F6F2EA] shadow-[0_24px_60px_rgba(20,35,30,0.22)] relative overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, #1D2C21 0%, #223127 55%, #1A281E 100%)',
        }}
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-8 items-center">
          {/* Sol Başlık Sütunu */}
          <div className="lg:col-span-3 space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-bold tracking-[0.15em] uppercase text-[#DFA85B]">
                ÜÇ ADIMDA HAZIR.
              </span>
              <span aria-hidden="true" className="h-px w-10 bg-[#DFA85B]/45" />
            </div>

            <h2 className="font-editorial-serif text-3xl sm:text-[36px] font-normal text-[#F6F2EA] leading-[1.12]">
              Herkes için
              <br />
              anlaşılır.
            </h2>

            <p className="text-xs sm:text-[13.5px] text-[#CFC9BC] leading-relaxed">
              Evraklarınızı düzenleyin, önemli yerleri gösterin ve paylaşın.
            </p>

            <div className="pt-2">
              <button
                type="button"
                onClick={onOpenAuth}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/5 hover:bg-white/15 border border-[#DFA85B]/55 text-[#F6F2EA] text-xs font-semibold transition-colors"
              >
                <span>Nasıl Çalışır?</span>
                <ArrowRight className="w-3.5 h-3.5 text-[#DFA85B]" />
              </button>
            </div>
          </div>

          {/* Sağ 3 Adım Akışı */}
          <div className="lg:col-span-9 relative">
            {/* Üst Bağlantı Çizgisi (Masaüstü) */}
            <div
              aria-hidden="true"
              className="hidden md:block absolute top-5 left-[15%] right-[15%] h-px bg-[#DFA85B]/40"
            />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-7 relative z-10">
              {steps.map((step, idx) => (
                <div key={step.num} className="text-center flex flex-col items-center relative">
                  {/* Numara Rozeti */}
                  <div className="w-10 h-10 rounded-full bg-[#F3DFBA] text-[#1A221E] font-bold text-xs flex items-center justify-center shadow-md mb-4 border-2 border-[#223127]">
                    {step.num}
                  </div>

                  {/* Adımlar Arası Ok İşareti (Masaüstü) */}
                  {idx < 2 && (
                    <ArrowRight
                      aria-hidden="true"
                      className="hidden md:block absolute top-[118px] -right-4 w-4 h-4 text-[#CFC9BC]/65"
                    />
                  )}

                  {/* Görsel (Kenar çizgisiz, doğal stüdyo geçişi) */}
                  <div className="h-36 sm:h-40 flex items-center justify-center mb-4">
                    <img
                      src={step.img}
                      width={1024}
                      height={1024}
                      alt={step.alt}
                      className="w-36 h-36 sm:w-40 sm:h-40 object-contain select-none"
                      style={{
                        maskImage: 'radial-gradient(closest-side, rgba(0,0,0,1) 65%, rgba(0,0,0,0) 100%)',
                        WebkitMaskImage:
                          'radial-gradient(closest-side, rgba(0,0,0,1) 65%, rgba(0,0,0,0) 100%)',
                      }}
                      loading="lazy"
                    />
                  </div>

                  <h3 className="font-editorial-serif font-bold text-base sm:text-[17px] text-[#F6F2EA]">
                    {step.title}
                  </h3>
                  <p className="text-xs text-[#CFC9BC] mt-1.5 leading-relaxed max-w-[230px]">
                    {step.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

const SharingSecuritySection: React.FC<{ onToggleMoreInfo: () => void; moreInfoOpen: boolean }> = ({
  onToggleMoreInfo,
  moreInfoOpen,
}) => {
  const cards = [
    {
      title: 'Kişisel\nçalışma alanı',
      desc: 'Belgeleriniz size özeldir.',
      icon: (
        <svg viewBox="0 0 36 28" className="w-9 h-7 fill-[#234C43]" aria-hidden="true">
          <circle cx="18" cy="8.5" r="4.2" />
          <circle cx="9.5" cy="10.5" r="3.2" opacity="0.8" />
          <circle cx="26.5" cy="10.5" r="3.2" opacity="0.8" />
          <path d="M11 22.5c0-3.6 3.1-6.2 7-6.2s7 2.6 7 6.2v1.5H11v-1.5z" />
          <path d="M3.5 23c0-2.8 2.2-4.8 5.2-5.1-.8 1.2-1.2 2.7-1.2 4.4v1.7H3.5V23z" opacity="0.75" />
          <path d="M32.5 23c0-2.8-2.2-4.8-5.2-5.1.8 1.2 1.2 2.7 1.2 4.4v1.7h4V23z" opacity="0.75" />
        </svg>
      ),
    },
    {
      title: 'İsteğe bağlı\nPIN',
      desc: 'Paylaşımınızı koruyun.',
      icon: (
        <svg viewBox="0 0 32 32" className="w-8 h-8 fill-[#234C43]" aria-hidden="true">
          <path d="M16 3L5 7.5v8.2C5 22.8 9.7 28.9 16 31c6.3-2.1 11-8.2 11-15.3V7.5L16 3zm-1.4 18.2l-4.2-4.2 1.8-1.8 2.4 2.4 5.6-5.6 1.8 1.8-7.4 7.4z" />
        </svg>
      ),
    },
    {
      title: 'Kontrollü paylaşım',
      desc: 'Bağlantı ile paylaşın.',
      icon: (
        <svg viewBox="0 0 32 32" className="w-8 h-8 stroke-[#234C43] fill-none" strokeWidth="2.8" strokeLinecap="round" aria-hidden="true">
          <path d="M13.5 18.5l5-5" />
          <path d="M11 15l-2.5 2.5a4.5 4.5 0 006.4 6.4L17.5 21" />
          <path d="M21 17l2.5-2.5a4.5 4.5 0 00-6.4-6.4L14.5 11" />
        </svg>
      ),
    },
    {
      title: 'Yayın durumunu\nyönetin',
      desc: 'Taslakta tutun veya yayına alın.',
      icon: (
        <svg viewBox="0 0 32 32" className="w-8 h-8 fill-[#234C43]" aria-hidden="true">
          <path d="M7 4a2 2 0 00-2 2v20a2 2 0 002 2h11v-2.5H8.5v-19H19v6h5v2.5h2.5V11L20 4H7z" />
          <rect x="9.5" y="10" width="7" height="1.8" rx="0.9" />
          <rect x="9.5" y="14" width="9" height="1.8" rx="0.9" />
          <rect x="9.5" y="18" width="6" height="1.8" rx="0.9" />
          <path d="M22.5 19a2.5 2.5 0 00-2.5 2.5V23h-1v6h7v-6h-1v-1.5a2.5 2.5 0 00-2.5-2.5zm-1 2.5a1 1 0 012 0V23h-2v-1.5z" />
        </svg>
      ),
    },
  ];

  return (
    <section id="kimler-icin" className="max-w-[1220px] mx-auto px-5 sm:px-8 py-12 sm:py-16">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        {/* Sol Metin Sütunu */}
        <div className="lg:col-span-3 space-y-3">
          <span className="text-[11px] font-bold tracking-[0.15em] uppercase text-[#5C6660]">
            PAYLAŞIM VE GÜVEN
          </span>
          <h2 className="font-editorial-serif text-3xl sm:text-[36px] font-normal text-[#1F2925] leading-[1.12]">
            Paylaşım sizin
            <br />
            kontrolünüzde.
          </h2>
          <p className="text-xs sm:text-[13.5px] text-[#5C6660] leading-relaxed">
            Her kullanıcı kendi evrak alanında çalışır. İstediğiniz kişilerle güvenle paylaşın.
          </p>
          <div className="pt-1">
            <button
              type="button"
              onClick={onToggleMoreInfo}
              aria-expanded={moreInfoOpen}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-[#1F2925] underline underline-offset-4 hover:text-[#234C43] cursor-pointer"
            >
              <span>Daha Fazla Bilgi</span>
              <ArrowRight className={`w-3.5 h-3.5 transition-transform ${moreInfoOpen ? 'rotate-90' : ''}`} />
            </button>
          </div>
        </div>

        {/* Sağ 4 Eşit Kart */}
        <div className="lg:col-span-9 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map((card) => (
            <div
              key={card.title}
              className="rounded-2xl bg-[#FAF6EE] border border-[#E5DEC9] px-5 py-7 text-center shadow-[0_10px_26px_rgba(32,42,39,0.05)] flex flex-col items-center justify-between min-h-[190px]"
            >
              <div className="h-10 flex items-center justify-center mb-3">{card.icon}</div>
              <h3 className="font-editorial-serif font-bold text-[17px] text-[#1F2925] leading-snug whitespace-pre-line">
                {card.title}
              </h3>
              <p className="text-xs text-[#5C6660] mt-2 leading-relaxed">{card.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

const AudienceAndFaqSection: React.FC = () => {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const faqs = [
    {
      q: 'Vatandaşlar dosyalara nasıl erişir?',
      a: 'Size iletilen paylaşım bağlantısını açarak veya QR kodu tarayarak ilgili dosyaya ulaşabilirler.',
    },
    {
      q: 'Paylaştığım dosyada yönetim araçları görünür mü?',
      a: 'Hayır. Vatandaşlara yönelik görünüm ile yönetim alanı birbirinden ayrıdır.',
    },
    {
      q: 'Büyük proje çizimleri görüntülenebilir mi?',
      a: 'Evet. Katlanabilir A3 paftalar dosya bütünlüğü korunarak açılıp incelenebilir.',
    },
    {
      q: 'Hangi dosyaları yükleyebilirim?',
      a: 'PDF, JPG, PNG, WebP, Word ve Excel belgeleri desteklenir.',
    },
    {
      q: 'Paylaşım bağlantısını koruyabilir miyim?',
      a: 'Evet. Paylaşım için isteğe bağlı PIN koruması kullanabilirsiniz.',
    },
  ];

  return (
    <section id="kimler-icin" className="max-w-[1220px] mx-auto px-5 sm:px-8 pb-12">
      <div className="rounded-2xl bg-[#FAF6EE]/85 border border-[#E5DEC9] p-6 sm:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Kimler İçin */}
        <div className="lg:col-span-5 space-y-4">
          <span className="text-[11px] font-bold tracking-[0.14em] uppercase text-[#5C6660]">
            KİMLER İÇİN &amp; BELGE DESTEĞİ
          </span>
          <h3 className="font-editorial-serif text-2xl font-bold text-[#1F2925]">
            Evrakla çalışan herkes için.
          </h3>
          <ul className="space-y-2.5 text-xs sm:text-[13.5px] text-[#5C6660]">
            <li>
              <strong className="text-[#1F2925]">Belediyeler ve kamu kurumları:</strong> Başvuru dosyalarını daha anlaşılır ve düzenli hâle getirin.
            </li>
            <li>
              <strong className="text-[#1F2925]">Mimarlık ve mühendislik ofisleri:</strong> Teknik çizimleri, projeleri ve ek belgeleri tek bir dosyada paylaşın.
            </li>
            <li>
              <strong className="text-[#1F2925]">Başvuru süreçlerini yöneten kuruluşlar:</strong> Başvuru sahiplerinin neyi, nerede tamamlaması gerektiğini gösterin.
            </li>
          </ul>
          <div className="pt-2 border-t border-[#E5DEC9] text-xs text-[#5C6660]">
            <span className="font-semibold text-[#1F2925]">Desteklenen belge türleri: </span>
            PDF · Word · Excel · JPG · PNG · WebP
          </div>
        </div>

        {/* Sık Sorulan Sorular */}
        <div id="sss" className="lg:col-span-7">
          <span className="text-[11px] font-bold tracking-[0.14em] uppercase text-[#5C6660]">
            SIK SORULAN SORULAR
          </span>
          <h3 className="font-editorial-serif text-2xl font-bold text-[#1F2925] mt-1 mb-3">
            Merak ettikleriniz.
          </h3>
          <div className="divide-y divide-[#E5DEC9] border-t border-b border-[#E5DEC9]">
            {faqs.map((item, idx) => {
              const isOpen = openFaq === idx;
              return (
                <div key={item.q}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpenFaq(isOpen ? null : idx)}
                    className="w-full py-3 text-left flex items-center justify-between gap-3 text-xs sm:text-sm font-semibold text-[#1F2925] hover:text-[#234C43]"
                  >
                    <span>{item.q}</span>
                    <ChevronDown
                      className={`w-4 h-4 text-[#5C6660] shrink-0 transition-transform ${
                        isOpen ? 'rotate-180 text-[#234C43]' : ''
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <p className="pb-3 text-xs sm:text-[13px] text-[#5C6660] leading-relaxed">
                      {item.a}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};

const FinalCTAAndFooter: React.FC<{ onOpenAuth: () => void }> = ({ onOpenAuth }) => (
  <div
    className="relative overflow-hidden text-[#F6F2EA]"
    style={{
      background: 'linear-gradient(180deg, #141210 0%, #121815 100%)',
    }}
  >
    {/* Sol Altta Duran Kraft Klasörler Görseli (08_alt_banner_klasorler.png) */}
    <img
      src="/assets/landing/cta-folders-left.webp"
      width={1376}
      height={768}
      alt=""
      aria-hidden="true"
      className="hidden sm:block pointer-events-none select-none absolute inset-y-0 left-0 h-full w-auto aspect-[1376/768] object-cover object-left opacity-95"
      style={{
        maskImage:
          'linear-gradient(to right, rgba(0,0,0,1) 42%, rgba(0,0,0,0) 94%), linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 16%, rgba(0,0,0,1) 100%)',
        WebkitMaskImage:
          'linear-gradient(to right, rgba(0,0,0,1) 42%, rgba(0,0,0,0) 94%), linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 16%, rgba(0,0,0,1) 100%)',
        maskComposite: 'intersect',
        WebkitMaskComposite: 'source-in',
      }}
    />

    {/* Son Çağrı (Final CTA) */}
    <section className="relative z-10 max-w-[1220px] mx-auto px-5 sm:px-8 py-14 sm:py-16 text-center">
      <div className="max-w-xl mx-auto space-y-4">
        <h2 className="font-editorial-serif text-3xl sm:text-[40px] font-normal text-[#F6F2EA] leading-tight">
          Evrak karmaşasını geride bırakın.
        </h2>
        <p className="text-xs sm:text-sm text-[#CFC9BC] leading-relaxed">
          Dosyalarınızı daha düzenli sunun. Başvuru sahiplerinin doğru evrakı doğru şekilde tamamlamasını kolaylaştırın.
        </p>
        <div className="pt-2">
          <button
            type="button"
            onClick={onOpenAuth}
            className="inline-flex items-center gap-2.5 px-8 py-3.5 rounded-full text-[#1A221E] font-bold text-sm shadow-[0_10px_28px_rgba(223,168,91,0.3)] transition-all hover:brightness-105 hover:-translate-y-0.5"
            style={{
              background: 'linear-gradient(135deg, #E8BC75 0%, #CE964B 100%)',
            }}
          >
            <span>Panele Giriş</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Yukarı Çık Düğmesi */}
      <a
        href="#"
        aria-label="Sayfa başına dön"
        className="hidden sm:flex position absolute right-6 bottom-6 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 items-center justify-center text-[#F6F2EA] transition-colors"
      >
        <ArrowRight className="w-4 h-4 -rotate-90" />
      </a>
    </section>

    {/* Alt Bilgi (Footer) */}
    <footer className="relative z-10 border-t border-white/10 bg-[#121A16]/90">
      <div className="max-w-[1220px] mx-auto px-5 sm:px-8 py-5 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-[#CFC9BC]">
        <div className="flex items-center gap-2.5 text-[#F6F2EA]">
          <GoldFolderMark className="w-6 h-6" />
          <span className="font-editorial-serif text-sm sm:text-base">{LANDING_BRAND_NAME}</span>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-6">
          <a href="#nasil-calisir" className="hover:text-[#E8BC75] transition-colors">
            Nasıl Çalışır?
          </a>
          <a href="#ozellikler" className="hover:text-[#E8BC75] transition-colors">
            Özellikler
          </a>
          <a href="#kimler-icin" className="hover:text-[#E8BC75] transition-colors">
            Kimler İçin?
          </a>
          <a href="#sss" className="hover:text-[#E8BC75] transition-colors">
            SSS
          </a>
        </div>

        <div className="md:pl-6 md:border-l md:border-white/15 text-[11.5px] text-[#B8B2A6] text-center md:text-right">
          Evraklarınızı daha anlaşılır bir deneyime dönüştürün.
        </div>
      </div>
    </footer>
  </div>
);

export const SaaSLandingPage: React.FC = () => {
  const { user, checkAuthStatus, logout } = useAuthStore();
  const navigate = useNavigate();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [moreInfoOpen, setMoreInfoOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    checkAuthStatus();
  }, [checkAuthStatus]);

  useEffect(() => {
    if (location.hash === '#sss' || location.hash === '#kimler-icin') {
      setMoreInfoOpen(true);
    }
  }, [location.hash]);

  const openAuth = () => {
    if (user) {
      navigate('/admin');
      return;
    }
    setAuthModalOpen(true);
  };

  return (
    <div className="editorial-landing font-editorial-sans min-h-screen bg-[#F3EFE6] text-[#1F2925] selection:bg-[#DFA85B]/30 selection:text-[#1F2925]">
      {/* Üst Navigasyon ve Tam Genişlik Ceviz Masa Hero Sahnesi */}
      <div className="relative bg-[#141A16]">
        <LandingNavbar user={user} onOpenAuth={openAuth} onLogout={logout} />
        <HeroSection onOpenAuth={openAuth} />
      </div>

      {/* Orta Krem (#F3EFE6) Bölümler ve Yumuşak Botanik Yaprak Dokusu (09_dekoratif_botanik_arka_plan.jpg) */}
      <main className="relative bg-[#F3EFE6] overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: 'url(/assets/landing/paper-leaves-bg.webp)',
            backgroundSize: '100% auto',
            backgroundPosition: 'top center',
            backgroundRepeat: 'repeat-y',
            maskImage:
              'linear-gradient(90deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.25) 9%, rgba(0,0,0,0) 20%, rgba(0,0,0,0) 80%, rgba(0,0,0,0.25) 91%, rgba(0,0,0,0.5) 100%), linear-gradient(180deg, rgba(0,0,0,0) 0px, rgba(0,0,0,1) 120px, rgba(0,0,0,1) calc(100% - 120px), rgba(0,0,0,0) 100%)',
            WebkitMaskImage:
              'linear-gradient(90deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.25) 9%, rgba(0,0,0,0) 20%, rgba(0,0,0,0) 80%, rgba(0,0,0,0.25) 91%, rgba(0,0,0,0.5) 100%), linear-gradient(180deg, rgba(0,0,0,0) 0px, rgba(0,0,0,1) 120px, rgba(0,0,0,1) calc(100% - 120px), rgba(0,0,0,0) 100%)',
            maskComposite: 'intersect',
            WebkitMaskComposite: 'source-in',
          }}
        />
        <div className="relative z-10">
          <BenefitsSection onOpenAuth={openAuth} />
          <HowItWorksSection onOpenAuth={openAuth} />
          <SharingSecuritySection
            onToggleMoreInfo={() => setMoreInfoOpen((v: boolean) => !v)}
            moreInfoOpen={moreInfoOpen}
          />
          {moreInfoOpen && <AudienceAndFaqSection />}
        </div>
      </main>

      {/* Alt Koyu Çağrı Alanı ve Footer */}
      <FinalCTAAndFooter onOpenAuth={openAuth} />

      <AuthModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
      />
    </div>
  );
};

// ============================================================================
// 9. VATANDAŞ ARAYÜZÜ BİLEŞENLERİ (CITIZEN SHELF, FLIPBOOK & SPOTLIGHT)
// ============================================================================

export const SpotlightOverlay: React.FC<{ cutoutRect: ScreenCutoutRect | null }> = ({
  cutoutRect,
}) => {
  const folder = useViewerStore((s) => s.folder);
  const currentPageIndex = useViewerStore((s) => s.currentPageIndex);
  const isSpotlightActive = useViewerStore((s) => s.isSpotlightActive);
  const activeHotspotIndex = useViewerStore((s) => s.activeHotspotIndex);
  const acknowledgeCurrentSpotlight = useViewerStore((s) => s.acknowledgeCurrentSpotlight);

  const [viewport, setViewport] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  });

  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (!isSpotlightActive || !folder || currentPageIndex < 0 || !cutoutRect) return null;
  const page = folder.pages[currentPageIndex];
  if (!page) return null;
  const currentHotspot = page.hotspots[activeHotspotIndex];
  if (!currentHotspot) return null;

  const popoverWidth = Math.min(370, Math.max(260, viewport.width - 24));
  const popoverPos = computeSmartPopoverPlacement(
    cutoutRect,
    viewport.width,
    viewport.height,
    popoverWidth,
    225
  );

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-40 pointer-events-auto select-none">
        <svg className="w-full h-full block" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <mask id="spotlight-cutout-mask">
              <rect x="0" y="0" width="100%" height="100%" fill="white" />
              {cutoutRect.shape === 'ellipse' || cutoutRect.shape === 'pin' ? (
                <ellipse
                  cx={cutoutRect.centerX}
                  cy={cutoutRect.centerY}
                  rx={cutoutRect.width / 2}
                  ry={cutoutRect.height / 2}
                  fill="black"
                />
              ) : (
                <rect
                  x={cutoutRect.x}
                  y={cutoutRect.y}
                  width={cutoutRect.width}
                  height={cutoutRect.height}
                  rx="10"
                  fill="black"
                />
              )}
            </mask>
          </defs>

          <rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            fill="rgba(2, 6, 23, 0.76)"
            mask="url(#spotlight-cutout-mask)"
          />

          {cutoutRect.shape === 'ellipse' || cutoutRect.shape === 'pin' ? (
            <ellipse
              cx={cutoutRect.centerX}
              cy={cutoutRect.centerY}
              rx={cutoutRect.width / 2 + 3}
              ry={cutoutRect.height / 2 + 3}
              fill="none"
              stroke="#f59e0b"
              strokeWidth="3.5"
            />
          ) : (
            <rect
              x={cutoutRect.x - 3}
              y={cutoutRect.y - 3}
              width={cutoutRect.width + 6}
              height={cutoutRect.height + 6}
              rx="12"
              fill="none"
              stroke="#f59e0b"
              strokeWidth="3.5"
            />
          )}
        </svg>

        <motion.div
          key={currentHotspot.id}
          initial={{ opacity: 0, scale: 0.94, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 300, damping: 26 }}
          style={{ left: popoverPos.left, top: popoverPos.top, width: popoverWidth }}
          className="fixed z-50 rounded-2xl bg-slate-900/95 border-2 border-amber-500 shadow-[0_20px_60px_rgba(0,0,0,0.75)] p-4 sm:p-5 text-slate-100"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[11px] font-extrabold">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              <span>
                Kritik Uyarı {activeHotspotIndex + 1} / {page.hotspots.length}
              </span>
            </div>
            <span className="text-[11px] font-semibold text-slate-400">
              {currentPageIndex + 1}. Sayfa
            </span>
          </div>

          {currentHotspot.title && (
            <h4 className="text-sm font-bold text-white mb-1">{currentHotspot.title}</h4>
          )}

          <p className="text-xs text-slate-200 leading-relaxed bg-slate-950/70 border border-slate-800 rounded-xl p-3 mb-4">
            {currentHotspot.message}
          </p>

          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-slate-400">
              Onaylamadan sonraki sayfaya geçilemez
            </span>
            <button
              type="button"
              onClick={acknowledgeCurrentSpotlight}
              className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs inline-flex items-center gap-1.5 shadow-lg shadow-amber-500/25 transition-colors shrink-0"
            >
              <CheckCircle2 className="w-4 h-4" />
              Anladım / Tamam
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

function computeStageMetrics(): { w: number; h: number; fitZoom: number } {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 820;
  const isMobile = vw < 768;
  const h = Math.max(460, Math.min(860, vh - (isMobile ? 24 : 40)));
  const w = Math.round(h * (210 / 297));
  const padX = isMobile ? 16 : 120;
  const padY = isMobile ? 116 : 40;
  const fitZoom = Math.min(
    1.0,
    Math.max(
      MIN_VIEWER_ZOOM,
      Number(Math.min((vw - padX) / (w * 2), (vh - padY) / h).toFixed(2))
    )
  );
  return { w, h, fitZoom };
}

export const FlipHTML5BookStage: React.FC<{
  onUpdateSpotlightRect: (rect: ScreenCutoutRect | null) => void;
}> = ({ onUpdateSpotlightRect }) => {
  const folder = useViewerStore((s) => s.folder);
  const currentPageIndex = useViewerStore((s) => s.currentPageIndex);
  const a3UnfoldTarget = useViewerStore((s) => s.a3UnfoldTarget);
  const zoomLevel = useViewerStore((s) => s.zoomLevel);
  const panOffset = useViewerStore((s) => s.panOffset);
  const isSpotlightActive = useViewerStore((s) => s.isSpotlightActive);
  const activeHotspotIndex = useViewerStore((s) => s.activeHotspotIndex);

  const syncFromFlipbookSpread = useViewerStore((s) => s.syncFromFlipbookSpread);
  const toggleA3Unfold = useViewerStore((s) => s.toggleA3Unfold);
  const setDefaultFitZoom = useViewerStore((s) => s.setDefaultFitZoom);
  const setZoomLevel = useViewerStore((s) => s.setZoomLevel);
  const setZoomAndPan = useViewerStore((s) => s.setZoomAndPan);
  const addPanOffset = useViewerStore((s) => s.addPanOffset);
  const openCoverAndStart = useViewerStore((s) => s.openCoverAndStart);

  const stageViewportRef = useRef<HTMLDivElement>(null);
  const bookWrapperRef = useRef<HTMLDivElement>(null);
  const rightPageSurfaceRef = useRef<HTMLDivElement>(null);
  const pageFlipRef = useRef<PageFlip | null>(null);
  const isSyncingFromFlipRef = useRef(false);
  const hasAutoOpenedCoverRef = useRef<string | null>(null);
  const syncWindowFnRef = useRef<((centerDocIdx: number) => void) | null>(null);
  const cancelPageFlipTouchRef = useRef<() => void>(() => {});
  const baseCenterShiftXRef = useRef(0);
  const lastAutoFitZoomRef = useRef<number | null>(null);
  const loadedDocCanvasesRef = useRef<
    Map<number, { front: HTMLCanvasElement; back: HTMLCanvasElement }>
  >(new Map());
  const inflightDocLoadsRef = useRef<Set<number>>(new Set());

  const [isFlipAnimating, setIsFlipAnimating] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [isGestureActive, setIsGestureActive] = useState(false);

  const panDragRef = useRef({ active: false, lastX: 0, lastY: 0 });
  const touchGestureRef = useRef<{
    mode: 'idle' | 'single' | 'pinch' | 'pan3' | 'cooldown';
    startDist: number;
    startZoom: number;
    startPanX: number;
    startPanY: number;
    startMidX: number;
    startMidY: number;
    lastPanX: number;
    lastPanY: number;
  }>({
    mode: 'idle',
    startDist: 0,
    startZoom: 1,
    startPanX: 0,
    startPanY: 0,
    startMidX: 0,
    startMidY: 0,
    lastPanX: 0,
    lastPanY: 0,
  });
  const a3SwipeRef = useRef<{ startX: number | null; triggered: boolean }>({
    startX: null,
    triggered: false,
  });

  const [pageDims, setPageDims] = useState(() => {
    const metrics = computeStageMetrics();
    return { w: metrics.w, h: metrics.h };
  });

  useEffect(() => {
    const metrics = computeStageMetrics();
    lastAutoFitZoomRef.current = metrics.fitZoom;
    setDefaultFitZoom(metrics.fitZoom, true);
  }, [folder?.id, setDefaultFitZoom]);

  useEffect(() => {
    const onResize = () => {
      const m = computeStageMetrics();
      const prevAuto = lastAutoFitZoomRef.current;
      const st = useViewerStore.getState();
      const isAtAutoFit =
        prevAuto !== null &&
        Math.abs(st.zoomLevel - prevAuto) <= 0.02 &&
        st.panOffset.x === 0 &&
        st.panOffset.y === 0;
      lastAutoFitZoomRef.current = m.fitZoom;
      setDefaultFitZoom(m.fitZoom, isAtAutoFit);
      setPageDims((prev) =>
        Math.abs(m.w - prev.w) > 16 || Math.abs(m.h - prev.h) > 16 ? { w: m.w, h: m.h } : prev
      );
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [setDefaultFitZoom]);

  const pages = useMemo(
    () => (folder ? [...folder.pages].sort((a, b) => a.orderIndex - b.orderIndex) : []),
    [folder]
  );
  const totalSheets = 4 + pages.length * 2;
  const activePage: PageItem | undefined =
    currentPageIndex >= 0 ? pages[currentPageIndex] : undefined;
  const isA3Unfolded = activePage ? (a3UnfoldTarget[activePage.id] ?? 0) > 0.5 : false;
  const flipBleedY = Math.ceil(Math.hypot(pageDims.w, pageDims.h) - pageDims.h) + 36;
  const flipBleedX = 36;
  const flipCanvasW = pageDims.w * 2 + flipBleedX * 2;
  const flipCanvasH = pageDims.h + flipBleedY * 2;

  useEffect(() => {
    const parentEl = bookWrapperRef.current;
    if (!parentEl || !folder) return;

    let cancelled = false;

    if (pageFlipRef.current) {
      try {
        pageFlipRef.current.destroy();
      } catch {
        // ignore
      }
      pageFlipRef.current = null;
    }

    for (const pair of loadedDocCanvasesRef.current.values()) {
      releaseCanvasMemory(pair.front);
      releaseCanvasMemory(pair.back);
    }
    loadedDocCanvasesRef.current.clear();
    inflightDocLoadsRef.current.clear();

    parentEl.innerHTML = '';
    const mountEl = document.createElement('div');
    mountEl.style.width = `${flipCanvasW}px`;
    mountEl.style.height = `${flipCanvasH}px`;
    mountEl.style.position = 'relative';
    parentEl.appendChild(mountEl);

    const startDocIdx = useViewerStore.getState().currentPageIndex;
    const initialSheetIndex =
      startDocIdx < 0 ? 0 : Math.min(totalSheets - 1, startDocIdx * 2 + 1);

    const flip = new PageFlip(mountEl, {
      width: pageDims.w,
      height: pageDims.h,
      size: 'fixed',
      autoSize: false,
      minWidth: pageDims.w,
      maxWidth: pageDims.w,
      minHeight: pageDims.h,
      maxHeight: pageDims.h,
      drawShadow: true,
      maxShadowOpacity: 0.72,
      showCover: true,
      usePortrait: false,
      flippingTime: 820,
      startPage: initialSheetIndex,
      showPageCorners: false,
      useMouseEvents: true,
      mobileScrollSupport: false,
      swipeDistance: 30,
      clickEventForward: true,
      disableFlipByClick: false,
    });

    // Tüm yaprak slotlarını anında hafif şeffaf yer tutucuyla başlat (sıfır başlangıç beklemesi)
    const placeholderSheets = new Array<string>(totalSheets).fill(FLIPBOOK_BLANK_DATA_URL);
    flip.loadFromImages(placeholderSheets);

    const renderObj = (flip as any).getRender?.();
    if (renderObj && renderObj.ctx && renderObj.canvas) {
      renderObj.clear = function () {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      };
    }

    const pageObjs: any[] | undefined = (flip as any).getPageCollection?.()?.getPages?.();
    const assignCanvasToSheet = (sheetIdx: number, canvas: HTMLCanvasElement) => {
      const pObj = pageObjs?.[sheetIdx];
      if (!pObj) return;
      pObj.image = canvas;
      pObj.isLoad = true;
    };

    const flapW = Math.round(pageDims.w * 0.52);
    const pageCollection = (flip as any).getPageCollection?.();
    const getSpreadIdx = (): number => pageCollection?.getCurrentSpreadIndex?.() ?? 0;
    const isHalfCoverTransition = (direction: number | null | undefined): boolean => {
      const spreadIdx = getSpreadIdx();
      return (spreadIdx === 0 && direction === 0) || (spreadIdx === 1 && direction === 1);
    };

    // Sabit kapak ve arka kapak kanvaslarını doğrudan ata
    const initialFrontCover = renderCoverFrontCanvas(folder, null);
    const insideCover = renderCoverInsideLeftCanvas(folder);
    const backCoverCanvas = renderBackCoverCanvas();
    assignCanvasToSheet(0, initialFrontCover);
    assignCanvasToSheet(1, insideCover);
    assignCanvasToSheet(totalSheets - 2, backCoverCanvas);
    assignCanvasToSheet(totalSheets - 1, backCoverCanvas);

    // Kayan pencere (Sliding-Window) sanallaştırma + bellek tahliyesi
    const syncWindow = (centerDocIdx: number) => {
      if (cancelled || pages.length === 0) return;
      const safeCenter = Math.max(0, Math.min(pages.length - 1, centerDocIdx));
      const minKeep = Math.max(0, safeCenter - 3);
      const maxKeep = Math.min(pages.length - 1, safeCenter + 5);
      const evictRadius = 8;

      // Uzaktaki sayfa kanvaslarını bellekten tahliye et
      for (const [idx, pair] of loadedDocCanvasesRef.current.entries()) {
        if (Math.abs(idx - safeCenter) > evictRadius) {
          releaseCanvasMemory(pair.front);
          releaseCanvasMemory(pair.back);
          loadedDocCanvasesRef.current.delete(idx);

          const frontSheetObj = pageObjs?.[2 + idx * 2];
          const backSheetObj = pageObjs?.[3 + idx * 2];
          if (frontSheetObj) {
            const blank = new Image();
            blank.src = FLIPBOOK_BLANK_DATA_URL;
            frontSheetObj.isLoad = false;
            frontSheetObj.image = blank;
          }
          if (backSheetObj) {
            const blank = new Image();
            blank.src = FLIPBOOK_BLANK_DATA_URL;
            backSheetObj.isLoad = false;
            backSheetObj.image = blank;
          }
        }
      }

      // Aktif pencereyi merkezden dışa doğru önceliklendirerek yükle
      const indicesToLoad: number[] = [];
      for (let d = 0; d <= Math.max(safeCenter - minKeep, maxKeep - safeCenter); d++) {
        if (safeCenter + d <= maxKeep) indicesToLoad.push(safeCenter + d);
        if (d > 0 && safeCenter - d >= minKeep) indicesToLoad.push(safeCenter - d);
      }

      for (const idx of indicesToLoad) {
        if (loadedDocCanvasesRef.current.has(idx) || inflightDocLoadsRef.current.has(idx)) {
          continue;
        }
        const pageItem = pages[idx];
        if (!pageItem) continue;

        inflightDocLoadsRef.current.add(idx);
        const backCanvas = renderPaperBackLeftCanvas(
          idx,
          pages.length,
          pageItem.sourceFileName
        );
        assignCanvasToSheet(3 + idx * 2, backCanvas);

        loadImg(pageItem.imageUrl)
          .then((img) => {
            inflightDocLoadsRef.current.delete(idx);
            if (cancelled) {
              releaseCanvasMemory(backCanvas);
              return;
            }
            const curStateIdx = Math.max(0, useViewerStore.getState().currentPageIndex);
            if (Math.abs(idx - curStateIdx) > evictRadius) {
              releaseCanvasMemory(backCanvas);
              return;
            }
            const frontCanvas = renderDocumentFrontRightCanvas(
              img,
              idx,
              pages.length,
              pageItem.paperSize
            );
            loadedDocCanvasesRef.current.set(idx, { front: frontCanvas, back: backCanvas });
            assignCanvasToSheet(2 + idx * 2, frontCanvas);
          })
          .catch(() => {
            inflightDocLoadsRef.current.delete(idx);
            if (cancelled) {
              releaseCanvasMemory(backCanvas);
              return;
            }
            loadedDocCanvasesRef.current.set(idx, { front: backCanvas, back: backCanvas });
            assignCanvasToSheet(2 + idx * 2, backCanvas);
          });
      }

      // Sağ sayfada okunan tam çözünürlüklü görsellerin tarayıcı önbelleğini yalnızca ±2 için ısıt
      for (let idx = Math.max(0, safeCenter - 1); idx <= Math.min(pages.length - 1, safeCenter + 2); idx++) {
        const pre = new Image();
        pre.src = pages[idx].imageUrl;
      }
    };

    syncWindowFnRef.current = syncWindow;
    syncWindow(Math.max(0, startDocIdx));

    const uiObj = (flip as any).getUI?.();
    const flipCtrl = (flip as any).getFlipController?.();
    const distEl: HTMLElement | undefined = uiObj?.getDistElement?.() ?? uiObj?.distElement;

    if (uiObj && distEl) {
      // Zoom seviyesine (CSS transform: scale) göre fare/dokunma koordinatlarını normalize et
      uiObj.getMousePos = (clientX: number, clientY: number) => {
        const rect = distEl.getBoundingClientRect();
        const layoutW = distEl.offsetWidth || flipCanvasW;
        const layoutH = distEl.offsetHeight || flipCanvasH;
        const scaleX = rect.width > 0 ? layoutW / rect.width : 1;
        const scaleY = rect.height > 0 ? layoutH / rect.height : 1;
        return {
          x: (clientX - rect.left) * scaleX,
          y: (clientY - rect.top) * scaleY,
        };
      };

      if (typeof uiObj.onTouchEnd === 'function') {
        window.removeEventListener('touchend', uiObj.onTouchEnd);
        uiObj.onTouchEnd = (ev: TouchEvent) => {
          if (ev.changedTouches.length > 0) {
            const t = ev.changedTouches[0];
            const pos = uiObj.getMousePos(t.clientX, t.clientY);
            let isSwipe = false;
            if (uiObj.touchPoint !== null) {
              const dx = pos.x - uiObj.touchPoint.point.x;
              const dy = Math.abs(pos.y - uiObj.touchPoint.point.y);
              if (
                Math.abs(dx) > uiObj.swipeDistance &&
                dy < 2 * uiObj.swipeDistance &&
                Date.now() - uiObj.touchPoint.time < uiObj.swipeTimeout
              ) {
                const r = renderObj?.getRect?.();
                const midY = r ? r.top + r.height / 2 : flipCanvasH / 2;
                const corner = uiObj.touchPoint.point.y < midY ? 'top' : 'bottom';
                if (dx > 0) {
                  (flip as any).flipPrev(corner);
                } else {
                  (flip as any).flipNext(corner);
                }
                isSwipe = true;
              }
              uiObj.touchPoint = null;
            }
            (flip as any).userStop(pos, isSwipe);
          }
        };
        window.addEventListener('touchend', uiObj.onTouchEnd);
      }
    }

    if (renderObj && renderObj.ctx && renderObj.canvas) {
      renderObj.drawInnerShadow = function () {
        const t = this.getRect();
        this.ctx.save();
        this.ctx.beginPath();
        const e = this.convertToGlobal({ x: this.shadow.pos.x, y: this.shadow.pos.y });
        const i = this.convertRectToGlobal(this.pageRect);
        this.ctx.moveTo(i.topLeft.x, i.topLeft.y);
        this.ctx.lineTo(i.topRight.x, i.topRight.y);
        this.ctx.lineTo(i.bottomRight.x, i.bottomRight.y);
        this.ctx.lineTo(i.bottomLeft.x, i.bottomLeft.y);
        this.ctx.translate(e.x, e.y);
        this.ctx.rotate(Math.PI + this.shadow.angle + Math.PI / 2);
        const s = (3 * this.shadow.width) / 4;
        const n = this.ctx.createLinearGradient(0, 0, s, 0);
        if (this.shadow.direction === 0) {
          this.ctx.translate(-s, -t.height);
          n.addColorStop(1, `rgba(0, 0, 0, ${this.shadow.opacity})`);
          n.addColorStop(0.9, 'rgba(0, 0, 0, 0.05)');
          n.addColorStop(0.7, `rgba(0, 0, 0, ${this.shadow.opacity})`);
          n.addColorStop(0, 'rgba(0, 0, 0, 0)');
        } else {
          this.ctx.translate(0, -t.height);
          n.addColorStop(0, `rgba(0, 0, 0, ${this.shadow.opacity})`);
          n.addColorStop(0.1, 'rgba(0, 0, 0, 0.05)');
          n.addColorStop(0.3, `rgba(0, 0, 0, ${this.shadow.opacity})`);
          n.addColorStop(1, 'rgba(0, 0, 0, 0)');
        }
        this.ctx.clip();
        this.ctx.fillStyle = n;
        this.ctx.fillRect(0, 0, s, 3 * t.height);
        this.ctx.restore();
      };

      const origDrawFrame = renderObj.drawFrame.bind(renderObj);
      renderObj.drawFrame = function () {
        const rect = this.getRect();
        const ctx: CanvasRenderingContext2D = this.ctx;
        const calc = flipCtrl?.getCalculation?.();
        const spreadIdx = getSpreadIdx();
        const isHalfFlip =
          this.flippingPage != null && calc != null && calc.pageWidth === flapW;

        const traceGlobalPoly = (
          pts: any[],
          direction: number,
          offsetX = 0,
          offsetY = 0
        ): boolean => {
          let started = false;
          for (const pt of pts) {
            if (!pt) continue;
            const gp = this.convertToGlobal(pt, direction);
            if (!gp) continue;
            if (!started) {
              ctx.moveTo(gp.x - offsetX, gp.y - offsetY);
              started = true;
            } else {
              ctx.lineTo(gp.x - offsetX, gp.y - offsetY);
            }
          }
          if (started) ctx.closePath();
          return started;
        };

        if (!isHalfFlip && spreadIdx !== 0) {
          // Geri tam sayfa çevirmede (özellikle spread 2 -> 1), sol sayfayı altındaki yarı şeffaf yarım kapağın boşluğundan taşmaması için kaldırılan bölgeye göre kırp
          if (this.flippingPage != null && calc != null && calc.getDirection?.() === 1) {
            this.clear();

            const bottomArea = calc.getBottomClipArea?.() || [];
            const fullLeftQuad = [
              { x: 0, y: 0 },
              { x: rect.pageWidth, y: 0 },
              { x: rect.pageWidth, y: rect.height },
              { x: 0, y: rect.height },
            ];

            if (this.leftPage != null) {
              ctx.save();
              ctx.beginPath();
              traceGlobalPoly(fullLeftQuad, 1);
              traceGlobalPoly(bottomArea, 1);
              ctx.clip('evenodd');
              this.leftPage.simpleDraw(0);
              ctx.restore();
            }

            if (this.rightPage != null) this.rightPage.simpleDraw(1);
            if (this.bottomPage != null) this.bottomPage.draw();
            this.drawBookShadow();
            this.flippingPage.draw();

            if (this.shadow != null) {
              if (this.bottomPage === pageObjs?.[1]) {
                ctx.save();
                ctx.beginPath();
                ctx.rect(
                  rect.left + rect.pageWidth - flapW,
                  rect.top,
                  flapW + rect.pageWidth,
                  rect.height
                );
                ctx.clip();
                this.drawOuterShadow();
                ctx.restore();
              } else {
                this.drawOuterShadow();
              }
              this.drawInnerShadow();
            }
            return;
          }

          origDrawFrame();
          return;
        }

        this.clear();

        const coverFrontPage = pageObjs?.[0];
        const insideCoverPage = pageObjs?.[1];
        const baseRightPage = pageObjs?.[2];

        const drawBaseRight = () => {
          if (baseRightPage?.isLoad && baseRightPage?.image) {
            ctx.drawImage(
              baseRightPage.image,
              rect.left + rect.pageWidth,
              rect.top,
              rect.pageWidth,
              rect.height
            );
          } else {
            const rx = rect.left + rect.pageWidth;
            const ry = rect.top;
            ctx.save();
            ctx.fillStyle = '#a88459';
            ctx.fillRect(rx, ry, rect.pageWidth, rect.height);
            const mR = Math.round(rect.pageWidth * (20 / 760));
            const mY = Math.round(rect.height * (18 / 1075));
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(rx, ry + mY, rect.pageWidth - mR, rect.height - mY * 2);
            ctx.restore();
          }
        };

        // Durum 1: spread 0 beklemede (kapalı yarım kapak + arkasındaki sabit 1. evrak)
        if (!isHalfFlip && spreadIdx === 0) {
          drawBaseRight();

          const coverRightX = rect.left + rect.pageWidth + flapW;
          ctx.save();
          const dropGrad = ctx.createLinearGradient(coverRightX - 4, 0, coverRightX + 26, 0);
          dropGrad.addColorStop(0, 'rgba(0,0,0,0.34)');
          dropGrad.addColorStop(0.45, 'rgba(0,0,0,0.14)');
          dropGrad.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = dropGrad;
          ctx.fillRect(coverRightX - 4, rect.top, 30, rect.height);
          ctx.restore();

          if (coverFrontPage?.isLoad && coverFrontPage?.image) {
            ctx.drawImage(
              coverFrontPage.image,
              rect.left + rect.pageWidth,
              rect.top,
              rect.pageWidth,
              rect.height
            );
          }

          this.drawBookShadow();
          return;
        }

        // Durum 2: yarım kapak çevrilirken (spread 0 -> 1 veya spread 1 -> 0)
        const dir = calc.getDirection();
        drawBaseRight();

        const bottomClip = calc.getBottomClipArea?.() || [];

        // Açılma sırasında yarım kapağın henüz kalkmamış dikey sağ kenarı boyunca düşen doğal gölge
        if (dir === 0) {
          const edgeYs = bottomClip
            .filter((pt: any) => pt && Math.abs(pt.x - flapW) < 2)
            .map((pt: any) => pt.y);
          const corner = calc.getCorner?.();
          let unliftStartY = 0;
          let unliftEndY = rect.height;
          if (edgeYs.length > 0) {
            if (corner === 'bottom') {
              unliftEndY = Math.max(0, Math.min(...edgeYs));
            } else {
              unliftStartY = Math.min(rect.height, Math.max(...edgeYs));
            }
          }
          if (unliftEndY - unliftStartY > 1) {
            const coverRightX = rect.left + rect.pageWidth + flapW;
            ctx.save();
            const dropGrad = ctx.createLinearGradient(coverRightX - 4, 0, coverRightX + 26, 0);
            dropGrad.addColorStop(0, 'rgba(0,0,0,0.34)');
            dropGrad.addColorStop(0.45, 'rgba(0,0,0,0.14)');
            dropGrad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = dropGrad;
            ctx.fillRect(
              coverRightX - 4,
              rect.top + unliftStartY,
              30,
              unliftEndY - unliftStartY
            );
            ctx.restore();
          }
        }

        // Sabit kalan yarım kapak kısmı (even-odd kırpması ile yalnızca 0..flapW sınırında)
        const halfQuad = [
          { x: 0, y: 0 },
          { x: flapW, y: 0 },
          { x: flapW, y: rect.height },
          { x: 0, y: rect.height },
        ];
        ctx.save();
        ctx.beginPath();
        traceGlobalPoly(halfQuad, dir);
        traceGlobalPoly(bottomClip, dir);
        ctx.clip('evenodd');

        if (dir === 0 && coverFrontPage?.isLoad && coverFrontPage?.image) {
          ctx.drawImage(
            coverFrontPage.image,
            rect.left + rect.pageWidth,
            rect.top,
            rect.pageWidth,
            rect.height
          );
        } else if (dir === 1 && insideCoverPage?.isLoad && insideCoverPage?.image) {
          ctx.drawImage(
            insideCoverPage.image,
            rect.left,
            rect.top,
            rect.pageWidth,
            rect.height
          );
        }
        ctx.restore();

        // Kıvrılan kanat altında kalan dış gölge (strictly bottomClip yani 0..flapW ile sınırlı, açık sağ sayfaya taşmaz)
        if (this.shadow != null && bottomClip.length >= 3) {
          const shadowPos = this.convertToGlobal(
            { x: this.shadow.pos.x, y: this.shadow.pos.y },
            dir
          );
          if (shadowPos) {
            ctx.save();
            ctx.beginPath();
            if (traceGlobalPoly(bottomClip, dir)) {
              ctx.clip();
              ctx.translate(shadowPos.x, shadowPos.y);
              ctx.rotate(Math.PI + this.shadow.angle + Math.PI / 2);
              const osw = Math.min(
                flapW * 0.75,
                Math.max(18, (flapW * 3 * (calc.getFlippingProgress?.() ?? 40)) / 400)
              );
              const outerGrad = ctx.createLinearGradient(0, 0, osw, 0);
              const op = (this.shadow.opacity ?? 0.35) * 0.85;
              if (dir === 0) {
                ctx.translate(0, -rect.height);
                outerGrad.addColorStop(0, `rgba(0, 0, 0, ${op})`);
                outerGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
              } else {
                ctx.translate(-osw, -rect.height);
                outerGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
                outerGrad.addColorStop(1, `rgba(0, 0, 0, ${op})`);
              }
              ctx.fillStyle = outerGrad;
              ctx.fillRect(0, 0, osw, rect.height * 3);
            }
            ctx.restore();
          }
        }

        this.drawBookShadow();

        // Kıvrılarak dönen yarım kapak yüzeyi + iç kıvrım gölgesi
        const flipClip = calc.getFlippingClipArea?.() || [];
        const activeCornerGlobal = this.convertToGlobal(calc.getActiveCorner(), dir);
        const angle = calc.getAngle();

        if (activeCornerGlobal && flipClip.length >= 3) {
          ctx.save();
          ctx.translate(activeCornerGlobal.x, activeCornerGlobal.y);
          ctx.beginPath();
          if (
            traceGlobalPoly(
              flipClip,
              dir,
              activeCornerGlobal.x,
              activeCornerGlobal.y
            )
          ) {
            ctx.clip();

            ctx.save();
            ctx.rotate(angle);
            if (dir === 0 && insideCoverPage?.isLoad && insideCoverPage?.image) {
              ctx.drawImage(
                insideCoverPage.image,
                -(rect.pageWidth - flapW),
                0,
                rect.pageWidth,
                rect.height
              );
            } else if (dir === 1 && coverFrontPage?.isLoad && coverFrontPage?.image) {
              ctx.drawImage(coverFrontPage.image, 0, 0, rect.pageWidth, rect.height);
            }
            ctx.restore();

            if (this.shadow != null) {
              const shadowPos = this.convertToGlobal(
                { x: this.shadow.pos.x, y: this.shadow.pos.y },
                dir
              );
              if (shadowPos) {
                ctx.save();
                ctx.translate(
                  shadowPos.x - activeCornerGlobal.x,
                  shadowPos.y - activeCornerGlobal.y
                );
                ctx.rotate(Math.PI + this.shadow.angle + Math.PI / 2);
                const isw = Math.min(
                  flapW * 0.75,
                  Math.max(18, (flapW * 3 * (calc.getFlippingProgress?.() ?? 50)) / 400)
                );
                const innerGrad = ctx.createLinearGradient(0, 0, isw, 0);
                const op = this.shadow.opacity ?? 0.35;
                if (dir === 0) {
                  ctx.translate(-isw, -rect.height);
                  innerGrad.addColorStop(1, `rgba(0, 0, 0, ${op})`);
                  innerGrad.addColorStop(0.85, 'rgba(0, 0, 0, 0.05)');
                  innerGrad.addColorStop(0.65, `rgba(0, 0, 0, ${op * 0.85})`);
                  innerGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
                } else {
                  ctx.translate(0, -rect.height);
                  innerGrad.addColorStop(0, `rgba(0, 0, 0, ${op})`);
                  innerGrad.addColorStop(0.15, 'rgba(0, 0, 0, 0.05)');
                  innerGrad.addColorStop(0.35, `rgba(0, 0, 0, ${op * 0.85})`);
                  innerGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
                }
                ctx.fillStyle = innerGrad;
                ctx.fillRect(0, 0, isw, rect.height * 3);
                ctx.restore();
              }
            }
          }

          ctx.restore();
        }
      };
    }

    const isOutsideHalfCoverArea = (clientX: number, clientY: number): boolean => {
      if (!uiObj || typeof uiObj.getMousePos !== 'function' || !renderObj) return false;
      const rect = renderObj.getRect();
      const pos = uiObj.getMousePos(clientX, clientY);
      if (
        pos.x < rect.left ||
        pos.x > rect.left + rect.width ||
        pos.y < rect.top ||
        pos.y > rect.top + rect.height
      ) {
        return true;
      }
      const spreadIdx = getSpreadIdx();
      if (spreadIdx === 0) {
        return pos.x > rect.left + rect.pageWidth + flapW;
      }
      if (spreadIdx === 1) {
        return pos.x < rect.left + rect.pageWidth - flapW;
      }
      return false;
    };

    const onCaptureMouseDown = (ev: MouseEvent) => {
      if (
        ev.button !== 0 ||
        ev.altKey ||
        ev.shiftKey ||
        useViewerStore.getState().isSpotlightActive ||
        isOutsideHalfCoverArea(ev.clientX, ev.clientY)
      ) {
        ev.stopImmediatePropagation();
      }
    };
    const onCaptureTouchStart = (ev: TouchEvent) => {
      const touch = ev.touches?.[0];
      if (
        ev.touches.length > 1 ||
        useViewerStore.getState().isSpotlightActive ||
        (touch && isOutsideHalfCoverArea(touch.clientX, touch.clientY))
      ) {
        ev.stopImmediatePropagation();
      }
    };
    if (distEl) {
      distEl.addEventListener('mousedown', onCaptureMouseDown, true);
      distEl.addEventListener('touchstart', onCaptureTouchStart, true);
    }

    let dragStartPos: { x: number; y: number } | null = null;
    let dragLastPos: { x: number; y: number } | null = null;
    const origStartUserTouch = (flip as any).startUserTouch?.bind(flip);
    const origUserMove = (flip as any).userMove?.bind(flip);
    const origUserStop = (flip as any).userStop?.bind(flip);

    if (origStartUserTouch && origUserMove && origUserStop && flipCtrl) {
      const origStart = flipCtrl.start.bind(flipCtrl);
      flipCtrl.start = (globalPos: { x: number; y: number }) => {
        const ok = origStart(globalPos);
        if (!ok) return false;
        const calc = flipCtrl.calc;
        const dir = calc?.getDirection?.();
        if (calc && isHalfCoverTransition(dir)) {
          const rect = renderObj.getRect();
          const HalfCalc = calc.constructor;
          flipCtrl.calc = new HalfCalc(dir, calc.getCorner(), String(flapW), String(rect.height));
        }
        return true;
      };

      flipCtrl.flip = (globalPos: { x: number; y: number }) => {
        const settings = (flip as any).getSettings?.();
        if (settings?.disableFlipByClick && !flipCtrl.isPointOnCorners?.(globalPos)) return;
        if (flipCtrl.calc !== null) renderObj?.finishAnimation?.();
        if (!flipCtrl.start(globalPos)) return;

        const calc = flipCtrl.calc;
        const rect = renderObj?.getRect?.();
        if (!calc || !rect) return;

        flipCtrl.setState?.('flipping');
        const activeW = calc.pageWidth === flapW ? flapW : rect.pageWidth;
        const topMargins =
          activeW === flapW ? Math.min(rect.height / 10, flapW * 0.25) : rect.height / 10;
        const yStart = calc.getCorner() === 'bottom' ? rect.height - topMargins : topMargins;
        const yDest = calc.getCorner() === 'bottom' ? rect.height : 0;
        const xStart = activeW - (activeW === flapW ? Math.min(20, topMargins) : topMargins);
        calc.calc({ x: xStart, y: yStart });
        flipCtrl.animateFlippingTo({ x: xStart, y: yStart }, { x: -activeW, y: yDest }, true);
      };

      const origFlipNext = flipCtrl.flipNext.bind(flipCtrl);
      flipCtrl.flipNext = (corner: 'top' | 'bottom' = 'top') => {
        if (!renderObj) {
          origFlipNext(corner);
          return;
        }
        const rect = renderObj.getRect();
        const targetX =
          getSpreadIdx() === 0
            ? rect.left + rect.pageWidth + flapW - 10
            : rect.left + 2 * rect.pageWidth - 10;
        flipCtrl.flip({
          x: targetX,
          y: rect.top + (corner === 'top' ? 1 : rect.height - 2),
        });
      };

      const origFlipPrev = flipCtrl.flipPrev.bind(flipCtrl);
      flipCtrl.flipPrev = (corner: 'top' | 'bottom' = 'top') => {
        if (!renderObj) {
          origFlipPrev(corner);
          return;
        }
        const rect = renderObj.getRect();
        const targetX =
          getSpreadIdx() === 1
            ? rect.left + rect.pageWidth - flapW + 10
            : rect.left + 10;
        flipCtrl.flip({
          x: targetX,
          y: rect.top + (corner === 'top' ? 1 : rect.height - 2),
        });
      };

      (flip as any).startUserTouch = (pos: { x: number; y: number }) => {
        if (flipCtrl.getState?.() !== 'read') {
          try {
            renderObj?.finishAnimation?.();
          } catch {
            // ignore
          }
        }
        if (flipCtrl.getState?.() === 'read') {
          flipCtrl.reset?.();
        }
        dragStartPos = { ...pos };
        dragLastPos = { ...pos };
        origStartUserTouch(pos);
      };

      (flip as any).userMove = (pos: { x: number; y: number }, isTouch: boolean) => {
        if ((flip as any).isUserTouch) {
          dragLastPos = { ...pos };
        }
        origUserMove(pos, isTouch);
      };

      (flip as any).userStop = (pos: { x: number; y: number }, isSwipeHandled = false) => {
        dragLastPos = { ...pos };
        const wasMove = Boolean((flip as any).isUserMove);
        const effectivePos = !wasMove && dragStartPos ? dragStartPos : pos;
        origUserStop(effectivePos, isSwipeHandled);
        dragStartPos = null;
        dragLastPos = null;
      };

      const origStopMove = flipCtrl.stopMove.bind(flipCtrl);
      flipCtrl.stopMove = () => {
        const calc = flipCtrl.getCalculation?.();
        if (!calc) {
          origStopMove();
          return;
        }
        const bounds = flipCtrl.getBoundsRect();
        const activeW = calc.pageWidth === flapW ? flapW : bounds.pageWidth;
        const pos = calc.getPosition();
        const endY = calc.getCorner() === 'bottom' ? bounds.height : 0;
        const dir = calc.getDirection();

        let shouldComplete = pos.x <= 0;
        if (dragStartPos && dragLastPos) {
          const dx = dragLastPos.x - dragStartPos.x;
          if (dir === 0) {
            if (dx <= -32) shouldComplete = true;
            else if (dx > -10) shouldComplete = false;
          } else {
            if (dx >= 32) shouldComplete = true;
            else if (dx < 10) shouldComplete = false;
          }
        }

        if (shouldComplete) {
          flipCtrl.animateFlippingTo(pos, { x: -activeW, y: endY }, true);
        } else {
          flipCtrl.animateFlippingTo(pos, { x: activeW, y: endY }, false);
        }
      };
      cancelPageFlipTouchRef.current = () => {
        if (uiObj) uiObj.touchPoint = null;
        (flip as any).isUserTouch = false;
        (flip as any).isUserMove = false;
        dragStartPos = null;
        dragLastPos = null;
        if (flipCtrl?.calc) {
          try {
            const pos = flipCtrl.calc.getPosition();
            const bounds = flipCtrl.getBoundsRect();
            const activeW = flipCtrl.calc.pageWidth === flapW ? flapW : bounds.pageWidth;
            const endY = flipCtrl.calc.getCorner() === 'bottom' ? bounds.height : 0;
            flipCtrl.animateFlippingTo(pos, { x: activeW, y: endY }, false);
          } catch {
            // ignore
          }
        }
      };
    }

    flip.on('changeState', (e: any) => {
      const state = String(e?.data ?? 'read');
      setIsFlipAnimating(state === 'user_fold' || state === 'flipping');
    });

    flip.on('flip', (e: any) => {
      const sheetIdx = Number(e?.data ?? 0);
      const docIdx = sheetIdx === 0 ? -1 : Math.min(pages.length, Math.floor((sheetIdx - 1) / 2));
      isSyncingFromFlipRef.current = true;
      syncFromFlipbookSpread(docIdx);
      setTimeout(() => {
        isSyncingFromFlipRef.current = false;
      }, 100);
    });

    pageFlipRef.current = flip;
    return () => {
      cancelled = true;
      syncWindowFnRef.current = null;
      cancelPageFlipTouchRef.current = () => {};
      if (distEl) {
        distEl.removeEventListener('mousedown', onCaptureMouseDown, true);
        distEl.removeEventListener('touchstart', onCaptureTouchStart, true);
      }
      try {
        flip.destroy();
      } catch {
        // ignore
      }
      pageFlipRef.current = null;
      for (const pair of loadedDocCanvasesRef.current.values()) {
        releaseCanvasMemory(pair.front);
        releaseCanvasMemory(pair.back);
      }
      loadedDocCanvasesRef.current.clear();
      inflightDocLoadsRef.current.clear();
      releaseCanvasMemory(initialFrontCover);
      releaseCanvasMemory(insideCover);
      releaseCanvasMemory(backCoverCanvas);
    };
  }, [folder?.id, folder?.updatedAt, pages, totalSheets, pageDims.w, pageDims.h]);

  useEffect(() => {
    if (!folder) return;
    if (hasAutoOpenedCoverRef.current === folder.id) return;

    const timer = setTimeout(() => {
      hasAutoOpenedCoverRef.current = folder.id;
      if (useViewerStore.getState().currentPageIndex === -1) {
        openCoverAndStart();
      }
    }, 900);
    return () => clearTimeout(timer);
  }, [folder, openCoverAndStart]);

  useEffect(() => {
    syncWindowFnRef.current?.(Math.max(0, currentPageIndex));
  }, [currentPageIndex]);

  useEffect(() => {
    const flip = pageFlipRef.current;
    if (!flip || totalSheets <= 0 || isSyncingFromFlipRef.current) return;

    const targetSheetIdx =
      currentPageIndex < 0 ? 0 : Math.min(totalSheets - 1, currentPageIndex * 2 + 1);
    const currentSheetIdx = flip.getCurrentPageIndex();

    if (currentSheetIdx !== targetSheetIdx) {
      try {
        flip.flip(targetSheetIdx, 'bottom');
      } catch {
        try {
          flip.turnToPage(targetSheetIdx);
        } catch {
          // ignore
        }
      }
    }
  }, [currentPageIndex, totalSheets]);

  useEffect(() => {
    const handleWindowMouseMove = (e: MouseEvent) => {
      if (!panDragRef.current.active) return;
      const dx = e.clientX - panDragRef.current.lastX;
      const dy = e.clientY - panDragRef.current.lastY;
      panDragRef.current.lastX = e.clientX;
      panDragRef.current.lastY = e.clientY;
      addPanOffset(dx, dy);
    };
    const handleWindowMouseUp = () => {
      if (panDragRef.current.active) {
        panDragRef.current.active = false;
        setIsPanning(false);
      }
    };
    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [addPanOffset]);

  const handleStageMouseDownCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button === 1 || e.button === 2 || (e.button === 0 && (e.altKey || e.shiftKey))) {
      e.preventDefault();
      e.stopPropagation();
      if (e.button === 1 || (e.button === 0 && (e.altKey || e.shiftKey))) {
        panDragRef.current = { active: true, lastX: e.clientX, lastY: e.clientY };
        setIsPanning(true);
      }
    }
  };

  const handleStagePointerDownCapture = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button === 1 || e.button === 2 || (e.button === 0 && (e.altKey || e.shiftKey))) {
      e.preventDefault();
      e.stopPropagation();
      if (e.button === 1 || (e.button === 0 && (e.altKey || e.shiftKey))) {
        panDragRef.current = { active: true, lastX: e.clientX, lastY: e.clientY };
        setIsPanning(true);
      }
    }
  };

  const handleStageWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const step = e.deltaY < 0 ? 0.14 : -0.14;
    const nextZoom = clampViewerZoom(zoomLevel + step);
    if (nextZoom === zoomLevel) return;

    const rect = stageViewportRef.current?.getBoundingClientRect();
    if (rect) {
      const anchored = computeAnchoredPanForZoom(
        e.clientX,
        e.clientY,
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
        baseCenterShiftXRef.current,
        zoomLevel,
        nextZoom,
        panOffset.x,
        panOffset.y
      );
      setZoomAndPan(nextZoom, anchored.x, anchored.y);
    } else {
      setZoomLevel(nextZoom);
    }
  };

  useEffect(() => {
    const el = stageViewportRef.current;
    if (!el || !folder) return;

    const touchDist = (t0: Touch, t1: Touch) =>
      Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
    const touchMid2 = (t0: Touch, t1: Touch) => ({
      x: (t0.clientX + t1.clientX) / 2,
      y: (t0.clientY + t1.clientY) / 2,
    });
    const touchCentroid3 = (t0: Touch, t1: Touch, t2: Touch) => ({
      x: (t0.clientX + t1.clientX + t2.clientX) / 3,
      y: (t0.clientY + t1.clientY + t2.clientY) / 3,
    });

    const beginPinch = (touches: TouchList) => {
      const g = touchGestureRef.current;
      const mid = touchMid2(touches[0], touches[1]);
      const st = useViewerStore.getState();
      g.mode = 'pinch';
      g.startDist = Math.max(12, touchDist(touches[0], touches[1]));
      g.startZoom = st.zoomLevel;
      g.startPanX = st.panOffset.x;
      g.startPanY = st.panOffset.y;
      g.startMidX = mid.x;
      g.startMidY = mid.y;
      setIsGestureActive(true);
    };

    const beginPan3 = (touches: TouchList) => {
      const g = touchGestureRef.current;
      const c = touchCentroid3(touches[0], touches[1], touches[2]);
      g.mode = 'pan3';
      g.lastPanX = c.x;
      g.lastPanY = c.y;
      setIsGestureActive(true);
    };

    const onTouchStart = (e: TouchEvent) => {
      const g = touchGestureRef.current;
      const target = e.target;
      if (
        e.touches.length === 1 &&
        target instanceof Element &&
        target.closest('[data-viewer-ui="true"]')
      ) {
        return;
      }

      if (e.touches.length >= 3) {
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
        cancelPageFlipTouchRef.current();
        if (g.mode !== 'cooldown') {
          beginPan3(e.touches);
        }
        return;
      }

      if (e.touches.length === 2) {
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
        cancelPageFlipTouchRef.current();
        if (g.mode !== 'cooldown') {
          beginPinch(e.touches);
        }
        return;
      }

      if (e.touches.length === 1) {
        if (g.mode === 'cooldown') {
          if (e.cancelable) e.preventDefault();
          e.stopPropagation();
          return;
        }
        g.mode = 'single';
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      const g = touchGestureRef.current;
      if (g.mode === 'idle' && e.touches.length === 1) {
        return;
      }

      if (e.cancelable) e.preventDefault();

      if (g.mode === 'cooldown') {
        e.stopPropagation();
        return;
      }

      if (e.touches.length >= 3) {
        e.stopPropagation();
        cancelPageFlipTouchRef.current();
        if (g.mode !== 'pan3') {
          beginPan3(e.touches);
          return;
        }
        const c = touchCentroid3(e.touches[0], e.touches[1], e.touches[2]);
        const dx = c.x - g.lastPanX;
        const dy = c.y - g.lastPanY;
        g.lastPanX = c.x;
        g.lastPanY = c.y;
        addPanOffset(dx, dy);
        return;
      }

      if (e.touches.length === 2) {
        e.stopPropagation();
        cancelPageFlipTouchRef.current();
        if (g.mode !== 'pinch') {
          beginPinch(e.touches);
          return;
        }
        const dist = Math.max(12, touchDist(e.touches[0], e.touches[1]));
        const nextZoom = clampViewerZoom(g.startZoom * (dist / g.startDist));
        const rect = el.getBoundingClientRect();
        const anchored = computeAnchoredPanForZoom(
          g.startMidX,
          g.startMidY,
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
          baseCenterShiftXRef.current,
          g.startZoom,
          nextZoom,
          g.startPanX,
          g.startPanY
        );
        setZoomAndPan(nextZoom, anchored.x, anchored.y);
      }
    };

    const onTouchEndOrCancel = (e: TouchEvent) => {
      const g = touchGestureRef.current;
      if (g.mode === 'pinch' || g.mode === 'pan3' || g.mode === 'cooldown') {
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
        if (e.touches.length === 0) {
          g.mode = 'idle';
          setIsGestureActive(false);
        } else {
          g.mode = 'cooldown';
        }
        return;
      }
      if (g.mode === 'single' && e.touches.length === 0) {
        g.mode = 'idle';
      }
    };

    const onWebkitGesture = (e: Event) => {
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
    };

    el.addEventListener('touchstart', onTouchStart, { capture: true, passive: false });
    el.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    el.addEventListener('touchend', onTouchEndOrCancel, { capture: true, passive: false });
    el.addEventListener('touchcancel', onTouchEndOrCancel, { capture: true, passive: false });
    el.addEventListener('gesturestart', onWebkitGesture, { capture: true, passive: false });
    el.addEventListener('gesturechange', onWebkitGesture, { capture: true, passive: false });
    el.addEventListener('gestureend', onWebkitGesture, { capture: true, passive: false });

    return () => {
      el.removeEventListener('touchstart', onTouchStart, true);
      el.removeEventListener('touchmove', onTouchMove, true);
      el.removeEventListener('touchend', onTouchEndOrCancel, true);
      el.removeEventListener('touchcancel', onTouchEndOrCancel, true);
      el.removeEventListener('gesturestart', onWebkitGesture, true);
      el.removeEventListener('gesturechange', onWebkitGesture, true);
      el.removeEventListener('gestureend', onWebkitGesture, true);
    };
  }, [folder?.id, addPanOffset, setZoomAndPan]);

  useEffect(() => {
    if (!isSpotlightActive || !folder || currentPageIndex < 0) {
      onUpdateSpotlightRect(null);
      return;
    }

    const updateRect = () => {
      const page = pages[currentPageIndex];
      if (!page) return;
      const surface = rightPageSurfaceRef.current;
      const hs = page.hotspots[activeHotspotIndex];
      if (!surface || !hs) return;

      const bounds = surface.getBoundingClientRect();
      if (hs.shape === 'pin') {
        const cx = bounds.left + (hs.x / 100) * bounds.width;
        const cy = bounds.top + (hs.y / 100) * bounds.height;
        onUpdateSpotlightRect({
          x: cx - 28,
          y: cy - 28,
          width: 56,
          height: 56,
          centerX: cx,
          centerY: cy,
          shape: 'pin',
        });
        return;
      }

      const x = bounds.left + (hs.x / 100) * bounds.width - 6;
      const y = bounds.top + (hs.y / 100) * bounds.height - 6;
      const width = Math.max(32, (hs.width / 100) * bounds.width + 12);
      const height = Math.max(26, (hs.height / 100) * bounds.height + 12);

      onUpdateSpotlightRect({
        x,
        y,
        width,
        height,
        centerX: x + width / 2,
        centerY: y + height / 2,
        shape: hs.shape,
      });
    };

    updateRect();
    const timer = setInterval(updateRect, 60);
    window.addEventListener('resize', updateRect);
    return () => {
      clearInterval(timer);
      window.removeEventListener('resize', updateRect);
    };
  }, [
    isSpotlightActive,
    activeHotspotIndex,
    currentPageIndex,
    isA3Unfolded,
    zoomLevel,
    panOffset.x,
    panOffset.y,
    pageDims,
    folder,
    pages,
    onUpdateSpotlightRect,
  ]);

  if (!folder) return null;

  const isClosedCoverIdle = currentPageIndex === -1 && !isFlipAnimating;
  let dynamicCenterShiftX = 0;
  if (isClosedCoverIdle) {
    dynamicCenterShiftX = -Math.round(pageDims.w * 0.48);
  } else if (currentPageIndex >= 0 && isA3Unfolded) {
    dynamicCenterShiftX = -Math.round(pageDims.w * 0.68);
  } else if (currentPageIndex === 0) {
    dynamicCenterShiftX = -Math.round(pageDims.w * 0.22);
  } else if (currentPageIndex > 0) {
    dynamicCenterShiftX = -Math.round(pageDims.w * 0.06);
  }
  baseCenterShiftXRef.current = dynamicCenterShiftX;
  const scaledCenterShiftX = Math.round(dynamicCenterShiftX * zoomLevel);

  const paperMarginR = Math.round(pageDims.w * (20 / 760));
  const paperMarginY = Math.round(pageDims.h * (18 / 1075));
  const paperW = pageDims.w - paperMarginR;
  const paperH = pageDims.h - paperMarginY * 2;
  const fixedUiScale = Number(Math.min(1.35, Math.max(0.55, 1 / Math.max(0.35, zoomLevel))).toFixed(3));
  const immediateMotion = isPanning || isGestureActive;

  return (
    <div
      ref={stageViewportRef}
      onMouseDownCapture={handleStageMouseDownCapture}
      onPointerDownCapture={handleStagePointerDownCapture}
      onMouseUpCapture={(e) => {
        if (e.button === 1 || e.button === 2) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onPointerUpCapture={(e) => {
        if (e.button === 1 || e.button === 2) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onWheel={handleStageWheel}
      className={`viewer-stage-lock w-full h-full flex items-center justify-center overflow-hidden relative select-none ${
        isPanning ? 'cursor-grabbing' : 'cursor-default'
      }`}
      style={{
        background: 'radial-gradient(circle at 50% 45%, #263042 0%, #171e2b 58%, #0d121b 100%)',
      }}
    >
      <motion.div
        initial={{ scale: 0.42, opacity: 0 }}
        animate={{
          scale: zoomLevel,
          opacity: 1,
          x: scaledCenterShiftX + panOffset.x,
          y: panOffset.y,
        }}
        transition={{
          scale: immediateMotion ? { duration: 0 } : { type: 'spring', stiffness: 220, damping: 25 },
          opacity: { duration: 0.28 },
          x: immediateMotion ? { duration: 0 } : { duration: 0.48, ease: [0.22, 1, 0.36, 1] },
          y: immediateMotion ? { duration: 0 } : { duration: 0.35, ease: [0.22, 1, 0.36, 1] },
        }}
        className="relative flex items-center justify-center"
      >
        <div
          style={{ width: pageDims.w * 2, height: pageDims.h }}
          className="relative"
        >
          <div
            ref={bookWrapperRef}
            style={{
              left: -flipBleedX,
              top: -flipBleedY,
              width: flipCanvasW,
              height: flipCanvasH,
            }}
            className="absolute drop-shadow-[0_28px_60px_rgba(0,0,0,0.75)]"
          />

          <div
            ref={rightPageSurfaceRef}
            style={{
              left: pageDims.w,
              top: 0,
              width: isA3Unfolded ? pageDims.w * 1.9 : pageDims.w,
              height: pageDims.h,
            }}
            className={`absolute z-20 ${
              currentPageIndex >= pages.length && !isFlipAnimating
                ? 'pointer-events-auto'
                : 'pointer-events-none'
            }`}
          >
            {activePage && !isFlipAnimating && !isA3Unfolded && (
              <div
                style={{
                  left: 0,
                  top: paperMarginY,
                  width: paperW,
                  height: paperH,
                  clipPath:
                    'polygon(0% 0%, calc(100% - 72px) 0%, 100% 72px, 100% calc(100% - 72px), calc(100% - 72px) 100%, 0% 100%)',
                }}
                className="absolute bg-white overflow-hidden pointer-events-none"
              >
                {activePage.paperSize === 'A3' ? (
                  <div className="w-full h-full grid grid-cols-2 relative">
                    <div className="relative h-full overflow-hidden">
                      <img
                        src={activePage.imageUrl}
                        alt=""
                        draggable={false}
                        className="h-full max-w-none select-none"
                        style={{ width: '400%', transform: 'translateX(0%)' }}
                      />
                    </div>
                    <div className="relative h-full overflow-hidden border-l-2 border-dashed border-amber-600/80">
                      <img
                        src={activePage.imageUrl}
                        alt=""
                        draggable={false}
                        className="h-full max-w-none select-none"
                        style={{ width: '400%', transform: 'translateX(-75%)' }}
                      />
                    </div>
                  </div>
                ) : (
                  <img
                    src={activePage.imageUrl}
                    alt={activePage.sourceFileName}
                    draggable={false}
                    className="w-full h-full object-contain select-none"
                  />
                )}
                <div
                  className="absolute inset-y-0 left-0 w-9 pointer-events-none"
                  style={{
                    background:
                      'linear-gradient(to right, rgba(0,0,0,0.24) 0%, rgba(0,0,0,0.05) 55%, rgba(0,0,0,0) 100%)',
                  }}
                />
              </div>
            )}

            {activePage && activePage.paperSize === 'A3' && !isA3Unfolded && !isFlipAnimating && (
              <div
                data-viewer-ui="true"
                style={{
                  transform: `translateY(-50%) scale(${fixedUiScale})`,
                  transformOrigin: 'right center',
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  a3SwipeRef.current = { startX: e.clientX, triggered: false };
                }}
                onPointerMove={(e) => {
                  if (a3SwipeRef.current.startX === null || a3SwipeRef.current.triggered) return;
                  if (e.clientX - a3SwipeRef.current.startX > 24) {
                    a3SwipeRef.current.triggered = true;
                    toggleA3Unfold(activePage.id);
                  }
                }}
                onPointerUp={() => {
                  if (!a3SwipeRef.current.triggered && a3SwipeRef.current.startX !== null) {
                    toggleA3Unfold(activePage.id);
                  }
                  a3SwipeRef.current = { startX: null, triggered: false };
                }}
                className="pointer-events-auto absolute right-2 top-1/2 z-30 cursor-grab active:cursor-grabbing group"
              >
                <div className="px-3.5 py-2.5 rounded-2xl bg-slate-900/90 hover:bg-slate-900 border-2 border-amber-400/90 shadow-[0_12px_32px_rgba(0,0,0,0.65)] backdrop-blur-md flex items-center gap-2.5 text-white">
                  <div className="relative w-12 h-8 rounded-xl bg-amber-500/20 border border-amber-400/40 flex items-center justify-center overflow-hidden">
                    <motion.div
                      animate={{ x: [-10, 12, -10], opacity: [0.4, 1, 0.4] }}
                      transition={{ duration: 1.35, repeat: Infinity, ease: 'easeInOut' }}
                      className="flex items-center text-amber-300"
                    >
                      <Hand className="w-4 h-4 rotate-90 text-amber-400 drop-shadow" />
                      <ChevronsRight className="w-4 h-4 -ml-1 text-amber-300" />
                    </motion.div>
                  </div>
                  <div className="text-left pr-1">
                    <div className="text-[11px] font-extrabold text-amber-300 tracking-wide uppercase flex items-center gap-1">
                      <span>Sağa Çekiniz</span>
                    </div>
                    <div className="text-[10px] text-slate-300 font-medium">Katlı A3 Projeyi Aç</div>
                  </div>
                </div>
              </div>
            )}

            {activePage && activePage.paperSize === 'A3' && isA3Unfolded && (
              <motion.div
                initial={{ width: pageDims.w, opacity: 0.95 }}
                animate={{ width: pageDims.w * 1.9, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 190, damping: 24 }}
                className="pointer-events-auto relative h-full bg-white shadow-[0_25px_65px_rgba(0,0,0,0.75)] grid grid-cols-4 border border-slate-300 overflow-hidden"
              >
                {(['A', 'B', 'C', 'D'] as const).map((letter, pIdx) => (
                  <div
                    key={letter}
                    className="relative h-full overflow-hidden border-r last:border-r-0 border-dashed border-slate-400/80 bg-white"
                  >
                    <img
                      src={activePage.imageUrl}
                      alt={`Panel ${letter}`}
                      draggable={false}
                      className="h-full max-w-none select-none"
                      style={{ width: '400%', transform: `translateX(-${pIdx * 25}%)` }}
                    />
                    <div
                      className={`absolute inset-y-0 left-0 w-6 pointer-events-none ${
                        pIdx % 2 === 1
                          ? 'bg-gradient-to-r from-slate-950/15 to-transparent'
                          : 'bg-gradient-to-r from-white/40 to-transparent'
                      }`}
                    />
                    <div
                      style={{ transform: `scale(${fixedUiScale})`, transformOrigin: 'top left' }}
                      className="absolute top-3 left-3 px-2 py-0.5 rounded bg-slate-900/80 text-amber-300 text-[10px] font-extrabold pointer-events-none"
                    >
                      PANEL {letter}
                    </div>
                  </div>
                ))}

                <div
                  data-viewer-ui="true"
                  style={{
                    transform: `translateY(-50%) scale(${fixedUiScale})`,
                    transformOrigin: 'right center',
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    a3SwipeRef.current = { startX: e.clientX, triggered: false };
                  }}
                  onPointerMove={(e) => {
                    if (a3SwipeRef.current.startX === null || a3SwipeRef.current.triggered) return;
                    if (e.clientX - a3SwipeRef.current.startX < -24) {
                      a3SwipeRef.current.triggered = true;
                      toggleA3Unfold(activePage.id);
                    }
                  }}
                  onPointerUp={() => {
                    if (!a3SwipeRef.current.triggered && a3SwipeRef.current.startX !== null) {
                      toggleA3Unfold(activePage.id);
                    }
                    a3SwipeRef.current = { startX: null, triggered: false };
                  }}
                  className="absolute right-3 top-1/2 z-30 cursor-grab active:cursor-grabbing"
                >
                  <div className="px-3.5 py-2.5 rounded-2xl bg-slate-900/90 hover:bg-slate-900 border-2 border-sky-400 shadow-[0_12px_32px_rgba(0,0,0,0.65)] backdrop-blur-md flex items-center gap-2.5 text-white">
                    <div className="relative w-11 h-8 rounded-xl bg-sky-500/20 border border-sky-400/40 flex items-center justify-center overflow-hidden">
                      <motion.div
                        animate={{ x: [10, -10, 10], opacity: [0.4, 1, 0.4] }}
                        transition={{ duration: 1.35, repeat: Infinity, ease: 'easeInOut' }}
                        className="flex items-center text-sky-300"
                      >
                        <ChevronsLeft className="w-4 h-4 text-sky-300" />
                        <Hand className="w-4 h-4 -ml-1 -rotate-90 text-sky-400" />
                      </motion.div>
                    </div>
                    <div className="text-left pr-1">
                      <div className="text-[11px] font-extrabold text-sky-300 uppercase">
                        Sola Katla
                      </div>
                      <div className="text-[10px] text-slate-300 font-medium">
                        A3 Projeyi Kapat
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export const CitizenShelfPage: React.FC<{ isSharedWorkspace?: boolean }> = ({
  isSharedWorkspace = false,
}) => {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const isEmbed = new URLSearchParams(location.search).get('embed') === '1';

  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [workspace, setWorkspace] = useState<PublicWorkspace | null>(null);
  const [requiresPin, setRequiresPin] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [notFoundError, setNotFoundError] = useState<string | null>(null);

  const loadWorkspace = useCallback(
    async (pin?: string) => {
      setIsLoading(true);
      setNotFoundError(null);
      try {
        if (isSharedWorkspace && workspaceId) {
          const data = await apiClient.getPublicWorkspace(workspaceId, pin);
          setWorkspace(data.workspace);
          if (data.requiresPin) {
            setRequiresPin(true);
            setPinError(pin ? 'Girdiğiniz erişim şifresi hatalı.' : null);
            setFolders([]);
          } else {
            setRequiresPin(false);
            setPinError(null);
            setFolders(data.folders);
          }
        } else {
          const data = await apiClient.listFolders(pin);
          setWorkspace(data.workspace ?? null);
          if (data.requiresPin) {
            setRequiresPin(true);
            setPinError(pin ? 'Girdiğiniz erişim şifresi hatalı.' : null);
            setFolders([]);
          } else {
            setRequiresPin(false);
            setPinError(null);
            setFolders(data.folders);
          }
        }
      } catch (err: any) {
        setNotFoundError(err.message || 'Masaüstü yüklenemedi.');
      } finally {
        setIsLoading(false);
      }
    },
    [isSharedWorkspace, workspaceId]
  );

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  if (requiresPin) {
    return (
      <PinGateCard
        title={workspace?.workspaceTitle || 'Korumalı Masaüstü'}
        subtitle={`${workspace?.displayName || ''} çalışma alanındaki dosyaları görmek için erişim şifresini giriniz.`}
        error={pinError}
        onSubmitPin={(pin) => loadWorkspace(pin)}
      />
    );
  }

  if (notFoundError) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 text-center gap-4">
        <AlertTriangle className="w-12 h-12 text-amber-400" />
        <h2 className="text-lg font-bold text-white">{notFoundError}</h2>
        <p className="text-xs text-slate-400 max-w-md">
          Bu paylaşım bağlantısı geçersiz veya yayından kaldırılmış olabilir. Lütfen bağlantı adresini kontrol ederek tekrar deneyin.
        </p>
        <button
          type="button"
          onClick={() => loadWorkspace()}
          className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition-colors"
        >
          Tekrar Dene
        </button>
      </div>
    );
  }

  const filteredFolders = folders.filter((f) => {
    const q = searchQuery.trim().toLocaleLowerCase('tr-TR');
    if (!q) return true;
    return (
      f.title.toLocaleLowerCase('tr-TR').includes(q) ||
      (f.description || '').toLocaleLowerCase('tr-TR').includes(q)
    );
  });

  const openFolderUrl = (folder: FolderItem) => {
    const suffix = isEmbed ? '?embed=1' : '';
    if (isSharedWorkspace && workspaceId) {
      navigate(`/v/${workspaceId}/dosya/${folder.id}${suffix}`);
    } else {
      navigate(`/dosya/${folder.id}${suffix}`);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-5 sm:py-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
          <div>
            {workspace?.displayName && (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[11px] font-bold mb-1.5">
                <Layers className="w-3 h-3" />
                <span>{workspace.displayName}</span>
              </div>
            )}
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              {!workspace?.displayName && <Layers className="w-5 h-5 text-amber-400" />}
              {workspace?.workspaceTitle || 'Resmi Başvuru Dosyası Rehberleri'}
            </h2>
            {workspace?.workspaceSubtitle && (
              <p className="text-xs text-slate-400 mt-1">{workspace.workspaceSubtitle}</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
            {folders.length > 0 && (
              <div className="relative w-full sm:w-48">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Dosya ara..."
                  className="pl-8 pr-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500 w-full sm:w-48"
                />
              </div>
            )}

            <span className="text-xs text-slate-400 hidden sm:inline">
              Toplam {filteredFolders.length} Hazır Başvuru Dosyası
            </span>
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="h-80 rounded-2xl bg-slate-900/60 border border-slate-800 animate-pulse"
              />
            ))}
          </div>
        ) : filteredFolders.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-800 bg-slate-900/40 p-14 text-center">
            <FileCheck2 className="w-12 h-12 text-amber-400 mx-auto mb-3" />
            <h3 className="text-lg font-bold text-white">
              {searchQuery ? 'Aramanızla Eşleşen Dosya Bulunamadı' : 'Henüz Yayınlanmış Başvuru Dosyası Yok'}
            </h3>
            <p className="text-sm text-slate-400 max-w-md mx-auto mt-1">
              Bu çalışma alanında henüz vatandaş paylaşımına açılmış bir başvuru dosyası bulunmuyor.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {filteredFolders.map((folder) => {
              const hasA3 = folder.pages.some((p) => p.paperSize === 'A3');
              const totalHotspots = folder.pages.reduce((acc, p) => acc + p.hotspots.length, 0);

              return (
                <div
                  key={folder.id}
                  onClick={() => openFolderUrl(folder)}
                  className="group relative rounded-2xl bg-gradient-to-b from-slate-800/80 to-slate-900/95 border border-slate-700/80 hover:border-amber-500/80 p-6 flex flex-col items-center cursor-pointer transition-all duration-300 hover:-translate-y-1.5 hover:shadow-2xl hover:shadow-amber-950/30"
                >
                  <div className="my-2 transition-transform duration-300 group-hover:scale-105">
                    <KraftFolderIcon
                      title={folder.title}
                      pageCount={folder.pages.length}
                      hasA3={hasA3}
                      className="w-44 h-56 drop-shadow-[0_16px_24px_rgba(0,0,0,0.6)]"
                    />
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-gradient-to-r from-amber-900/30 via-amber-700/60 to-amber-900/30 my-2" />
                  <h3 className="text-base font-bold text-white text-center group-hover:text-amber-300 transition-colors line-clamp-2 mt-1">
                    {folder.title}
                  </h3>
                  <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-950/80 text-slate-200 border border-slate-700">
                      <FileText className="w-3.5 h-3.5 text-amber-400" />
                      {folder.pages.length} Sayfa Evrak
                    </span>
                    {hasA3 && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                        A3 Katlı Proje
                      </span>
                    )}
                    {totalHotspots > 0 && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/40">
                        <AlertTriangle className="w-3 h-3" />
                        {totalHotspots} Kritik Uyarı
                      </span>
                    )}
                  </div>
                  <div className="mt-4 w-full py-2 rounded-xl bg-amber-500/15 group-hover:bg-amber-500 text-amber-300 group-hover:text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors">
                    <Sparkles className="w-3.5 h-3.5" />
                    3D Fiziksel Dosyayı Aç ve İncele
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};

export const CitizenViewerPage: React.FC<{ isPublicRoute?: boolean }> = ({
  isPublicRoute = false,
}) => {
  const { folderId, workspaceId, shareToken } = useParams<{
    folderId?: string;
    workspaceId?: string;
    shareToken?: string;
  }>();
  const location = useLocation();
  const isEmbed = new URLSearchParams(location.search).get('embed') === '1';

  const identifier = shareToken || folderId;
  const authUser = useAuthStore((s) => s.user);

  const {
    folder,
    workspace,
    requiresPin,
    lockedTitle,
    isLoading,
    error,
    currentPageIndex,
    zoomLevel,
    isSpotlightActive,
    loadFolder,
    resetViewer,
    zoomIn,
    zoomOut,
    resetCameraView,
    goToNextPage,
    goToPrevPage,
    jumpToPage,
    replayCurrentPageSpotlights,
  } = useViewerStore();

  const [spotlightRect, setSpotlightRect] = useState<ScreenCutoutRect | null>(null);
  const [showThumbDrawer, setShowThumbDrawer] = useState(false);
  const [showTouchHelp, setShowTouchHelp] = useState(false);
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const [muted, setMuted] = useState(getPageSoundMuted());

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverscroll = html.style.overscrollBehavior;
    const prevBodyOverscroll = body.style.overscrollBehavior;
    const prevBodyOverflow = body.style.overflow;

    html.style.overscrollBehavior = 'none';
    body.style.overscrollBehavior = 'none';
    body.style.overflow = 'hidden';

    return () => {
      html.style.overscrollBehavior = prevHtmlOverscroll;
      body.style.overscrollBehavior = prevBodyOverscroll;
      body.style.overflow = prevBodyOverflow;
    };
  }, []);

  useEffect(() => {
    if (identifier) {
      loadFolder(identifier, {
        isPublic: isPublicRoute || Boolean(shareToken || workspaceId),
        workspaceId,
      });
    }
    return () => resetViewer();
  }, [identifier, isPublicRoute, shareToken, workspaceId, loadFolder, resetViewer]);

  useEffect(() => {
    if (!isAutoPlaying || isSpotlightActive || !folder) return;
    const timer = setInterval(() => {
      const state = useViewerStore.getState();
      if (state.isSpotlightActive) return;
      if (state.currentPageIndex < (state.folder?.pages.length ?? 0) - 1) {
        state.goToNextPage();
      } else {
        setIsAutoPlaying(false);
      }
    }, 2600);
    return () => clearInterval(timer);
  }, [isAutoPlaying, isSpotlightActive, folder]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isSpotlightActive) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          useViewerStore.getState().acknowledgeCurrentSpotlight();
        }
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        goToNextPage();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        goToPrevPage();
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        zoomIn();
      } else if (e.key === '-') {
        e.preventDefault();
        zoomOut();
      } else if (e.key === '0') {
        e.preventDefault();
        resetCameraView();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSpotlightActive, goToNextPage, goToPrevPage, zoomIn, zoomOut, resetCameraView]);

  const handleUpdateSpotlightRect = useCallback((rect: ScreenCutoutRect | null) => {
    setSpotlightRect(rect);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const handleToggleMute = () => {
    const next = !muted;
    setMuted(next);
    setPageSoundMuted(next);
  };

  if (isLoading) {
    return (
      <div className="h-[100dvh] w-screen bg-[#111622] flex flex-col items-center justify-center text-slate-200 gap-3">
        <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm font-semibold">Dosya Hazırlanıyor...</p>
      </div>
    );
  }

  if (requiresPin && identifier) {
    return (
      <PinGateCard
        title={lockedTitle || 'Korumalı Dosya'}
        subtitle="Bu dosyayı açmak için belirlenen erişim şifresini (PIN) giriniz."
        error={error}
        onSubmitPin={(pin) =>
          loadFolder(identifier, {
            isPublic: isPublicRoute || Boolean(shareToken || workspaceId),
            pin,
            workspaceId,
          })
        }
      />
    );
  }

  // Vatandaş izolasyon kuralı:
  // - /d/:shareToken -> Sadece o dosya görüntülenir, başka ekranlara dönüş linki yok.
  // - /v/:workspaceId/dosya/:folderId -> Yalnızca ilgili paylaşılan masaüstüne (/v/:workspaceId) döner.
  // - /dosya/:folderId -> Yalnızca oturum açmış dosya sahibi için yönetim paneline (/admin) döner.
  const canReturnAdmin = !isPublicRoute && !shareToken && Boolean(authUser || getStoredToken());
  const backTarget = workspaceId ? `/v/${workspaceId}` : canReturnAdmin ? '/admin' : null;
  const backLabel = workspaceId ? 'Masaüstüne Dön' : 'Yönetim Paneline Dön';

  if (error || !folder) {
    return (
      <div className="h-[100dvh] w-screen bg-[#111622] flex flex-col items-center justify-center text-slate-200 gap-4 p-6 text-center">
        <AlertTriangle className="w-10 h-10 text-amber-400" />
        <p className="text-base font-bold text-red-400">{error || 'Dosya bulunamadı.'}</p>
        <p className="text-xs text-slate-400 max-w-md">
          Bu paylaşım bağlantısı geçersiz, taslak modunda veya yayından kaldırılmış olabilir.
        </p>
        {!isEmbed && backTarget ? (
          <Link
            to={backTarget}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm font-semibold"
          >
            ← {backLabel}
          </Link>
        ) : (
          identifier && (
            <button
              type="button"
              onClick={() =>
                loadFolder(identifier, {
                  isPublic: isPublicRoute || Boolean(shareToken || workspaceId),
                  workspaceId,
                })
              }
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold"
            >
              Tekrar Dene
            </button>
          )
        )}
      </div>
    );
  }

  const pages = [...folder.pages].sort((a, b) => a.orderIndex - b.orderIndex);
  const activePage = currentPageIndex >= 0 ? pages[currentPageIndex] : null;

  return (
    <div className="h-[100dvh] w-screen overflow-hidden overscroll-none touch-none bg-[#111622] text-slate-100 select-none relative">
      <div className="fixed top-3 left-3 right-3 sm:right-auto z-30 flex flex-wrap items-center justify-between sm:justify-start gap-2 pointer-events-none">
        <div className="flex flex-wrap items-center gap-2 pointer-events-auto">
          {!isEmbed && backTarget && (
            <Link
              to={backTarget}
              title={backLabel}
              className="inline-flex items-center gap-1.5 sm:gap-2 px-3 sm:px-3.5 py-2 rounded-xl bg-[#1e2533]/90 hover:bg-amber-500 text-slate-200 hover:text-slate-950 backdrop-blur-md border border-white/10 font-bold text-xs shadow-xl transition-all"
            >
              <ArrowLeft className="w-4 h-4 shrink-0" />
              <span>{backLabel}</span>
            </Link>
          )}

          {activePage && activePage.hotspots.length > 0 && !isSpotlightActive && (
            <button
              type="button"
              onClick={replayCurrentPageSpotlights}
              title="Bu Sayfanın Kritik Uyarılarını Tekrar Göster"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500 text-amber-300 hover:text-slate-950 backdrop-blur-md border border-amber-500/40 font-bold text-xs shadow-xl transition-all"
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>Uyarıyı Göster</span>
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowTouchHelp((v) => !v)}
          title="Dokunma Hareketleri Rehberi"
          className={`pointer-events-auto md:hidden inline-flex items-center gap-1 px-2.5 py-2 rounded-xl backdrop-blur-md border font-bold text-xs shadow-xl transition-all ${
            showTouchHelp
              ? 'bg-amber-500 text-slate-950 border-amber-400'
              : 'bg-[#1e2533]/90 text-slate-200 border-white/10'
          }`}
        >
          <Hand className="w-3.5 h-3.5 shrink-0" />
          <span>?</span>
        </button>

        {showTouchHelp && (
          <div className="pointer-events-auto md:hidden w-full rounded-xl bg-[#1e2533]/95 backdrop-blur-md border border-amber-500/40 px-3 py-2 text-[11px] text-slate-200 shadow-2xl flex items-center justify-between gap-2">
            <span>
              <strong className="text-amber-300">1 parmak:</strong> Sayfa çevir •{' '}
              <strong className="text-amber-300">2 parmak:</strong> Yakınlaş/Uzaklaş •{' '}
              <strong className="text-amber-300">3 parmak:</strong> Taşı
            </span>
            <button
              type="button"
              onClick={() => setShowTouchHelp(false)}
              className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white shrink-0"
              aria-label="Kapat"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      <aside className="fixed bottom-3 left-1/2 -translate-x-1/2 z-30 flex flex-row items-center gap-0.5 max-w-[calc(100vw-16px)] overflow-x-auto md:left-4 md:top-1/2 md:bottom-auto md:translate-x-0 md:-translate-y-1/2 md:flex-col md:gap-1 bg-[#1e2533]/90 backdrop-blur-md border border-white/10 rounded-2xl p-1.5 shadow-2xl">
        <button
          type="button"
          onClick={zoomIn}
          title="Yakınlaş (Zoom In)"
          className="p-2 rounded-xl hover:bg-white/15 text-slate-200 transition-colors shrink-0"
        >
          <Plus className="w-4 h-4" />
        </button>
        <div className="text-[10px] font-bold text-amber-400 px-1.5 md:px-1 select-none whitespace-nowrap shrink-0">
          %{Math.round(zoomLevel * 100)}
        </div>
        <button
          type="button"
          onClick={zoomOut}
          title="Uzaklaş (Zoom Out)"
          className="p-2 rounded-xl hover:bg-white/15 text-slate-200 transition-colors shrink-0"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={resetCameraView}
          title="Merkeze ve Ekrana Tam Sığdır"
          className="p-2 rounded-xl hover:bg-white/15 text-slate-200 transition-colors shrink-0"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => setShowThumbDrawer((v) => !v)}
          title="Tüm Sayfalar"
          className={`p-2 rounded-xl transition-colors shrink-0 ${
            showThumbDrawer ? 'bg-amber-500 text-slate-950' : 'hover:bg-white/15 text-slate-200'
          }`}
        >
          <Grid className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => setIsAutoPlaying((v) => !v)}
          title={isAutoPlaying ? 'Otomatik Çevirmeyi Durdur' : 'Otomatik Sayfa Çevir'}
          className={`p-2 rounded-xl transition-colors shrink-0 ${
            isAutoPlaying ? 'bg-emerald-500 text-slate-950' : 'hover:bg-white/15 text-slate-200'
          }`}
        >
          {isAutoPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>
        <button
          type="button"
          onClick={handleToggleMute}
          title={muted ? 'Sayfa Çevirme Sesini Aç' : 'Sayfa Çevirme Sesini Kapat'}
          className="p-2 rounded-xl hover:bg-white/15 text-slate-200 transition-colors shrink-0"
        >
          {muted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
        </button>
        <button
          type="button"
          onClick={toggleFullscreen}
          title="Tam Ekran"
          className="p-2 rounded-xl hover:bg-white/15 text-slate-200 transition-colors shrink-0"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </aside>

      <div className="fixed bottom-4 right-4 z-30 pointer-events-none hidden md:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#1e2533]/85 backdrop-blur-md border border-white/10 text-[11px] text-slate-300 shadow-lg">
        <Mouse className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        <span>
          <strong className="text-white">Scroll Çevir:</strong> Yakınlaş •{' '}
          <strong className="text-amber-300">Scroll Tıkla & Sürükle:</strong> Gezin (Move)
        </span>
      </div>

      <FlipHTML5BookStage onUpdateSpotlightRect={handleUpdateSpotlightRect} />

      {showThumbDrawer && (
        <div className="fixed bottom-16 md:bottom-4 left-1/2 -translate-x-1/2 z-30 bg-[#1e2430]/95 backdrop-blur-md border border-white/15 rounded-2xl p-3 shadow-2xl max-w-3xl w-[92%] sm:w-[88%] overflow-x-auto touch-pan-x flex items-center gap-3">
          <button
            type="button"
            onClick={() => jumpToPage(-1)}
            className={`shrink-0 w-20 h-28 rounded-lg border-2 flex flex-col items-center justify-center text-xs font-bold transition-all ${
              currentPageIndex === -1
                ? 'border-amber-400 bg-amber-500/20 text-amber-300'
                : 'border-white/10 bg-white/5 text-slate-300 hover:border-white/30'
            }`}
          >
            <span>Yarım</span>
            <span>Kapak</span>
          </button>

          {pages.map((p, idx) => (
            <button
              key={p.id}
              type="button"
              onClick={() => jumpToPage(idx)}
              className={`relative shrink-0 w-20 h-28 rounded-lg border-2 overflow-hidden bg-white transition-all ${
                currentPageIndex === idx
                  ? 'border-amber-400 scale-105 shadow-lg'
                  : 'border-white/15 opacity-75 hover:opacity-100'
              }`}
            >
              <img
                src={p.thumbnailUrl || p.imageUrl}
                alt={`${idx + 1}. Sayfa`}
                className="w-full h-full object-contain"
              />
              <span className="absolute bottom-1 inset-x-1 rounded bg-slate-950/80 text-white text-[10px] font-bold py-0.5">
                {idx + 1}. Sayfa
              </span>
            </button>
          ))}
        </div>
      )}

      <SpotlightOverlay cutoutRect={spotlightRect} />
    </div>
  );
};

// ============================================================================
// 10. YÖNETİM PANELİ BİLEŞENLERİ (ADMIN EXPLORER, TIMELINE & HOTSPOT EDITOR)
// ============================================================================

export type EditorTool = 'select' | 'rect' | 'ellipse' | 'pin';

export const HotspotCanvasLayer: React.FC<{
  imageUrl: string;
  hotspots: Hotspot[];
  selectedHotspotId: string | null;
  activeTool: EditorTool;
  onSelectHotspot: (id: string | null) => void;
  onChangeHotspots: (next: Hotspot[], newlyCreatedId?: string) => void;
}> = ({
  imageUrl,
  hotspots,
  selectedHotspotId,
  activeTool,
  onSelectHotspot,
  onChangeHotspots,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<{
    mode: 'create' | 'move';
    shape: HotspotShape;
    startXPercent: number;
    startYPercent: number;
    currentXPercent: number;
    currentYPercent: number;
    targetId?: string;
    initialHotspot?: Hotspot;
  } | null>(null);

  const getPercentCoords = (e: React.PointerEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: clamp(((e.clientX - rect.left) / rect.width) * 100, 0, 100),
      y: clamp(((e.clientY - rect.top) / rect.height) * 100, 0, 100),
    };
  };

  const handlePointerDownBackground = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const coords = getPercentCoords(e);

    if (activeTool === 'select') {
      onSelectHotspot(null);
      return;
    }

    if (activeTool === 'pin') {
      const newId = `hs_${nanoid(8)}`;
      const newPin: Hotspot = {
        id: newId,
        shape: 'pin',
        x: Number(coords.x.toFixed(2)),
        y: Number(coords.y.toFixed(2)),
        width: 0,
        height: 0,
        title: `Kritik Nokta ${hotspots.length + 1}`,
        message: 'Bu alandaki bilgilerin eksiksiz ve doğru olduğundan emin olunuz.',
      };
      onChangeHotspots([...hotspots, newPin], newId);
      return;
    }

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragState({
      mode: 'create',
      shape: activeTool === 'ellipse' ? 'ellipse' : 'rect',
      startXPercent: coords.x,
      startYPercent: coords.y,
      currentXPercent: coords.x,
      currentYPercent: coords.y,
    });
  };

  const handlePointerDownHotspot = (e: React.PointerEvent, hs: Hotspot) => {
    e.stopPropagation();
    onSelectHotspot(hs.id);
    const coords = getPercentCoords(e);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragState({
      mode: 'move',
      shape: hs.shape,
      startXPercent: coords.x,
      startYPercent: coords.y,
      currentXPercent: coords.x,
      currentYPercent: coords.y,
      targetId: hs.id,
      initialHotspot: { ...hs },
    });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragState) return;
    const coords = getPercentCoords(e);

    if (dragState.mode === 'create') {
      setDragState((prev) =>
        prev ? { ...prev, currentXPercent: coords.x, currentYPercent: coords.y } : null
      );
      return;
    }

    if (dragState.mode === 'move' && dragState.initialHotspot && dragState.targetId) {
      const dx = coords.x - dragState.startXPercent;
      const dy = coords.y - dragState.startYPercent;
      const init = dragState.initialHotspot;

      const updated = hotspots.map((h) => {
        if (h.id !== dragState.targetId) return h;
        const maxX = h.shape === 'pin' ? 100 : 100 - h.width;
        const maxY = h.shape === 'pin' ? 100 : 100 - h.height;
        return {
          ...h,
          x: Number(clamp(init.x + dx, 0, maxX).toFixed(2)),
          y: Number(clamp(init.y + dy, 0, maxY).toFixed(2)),
        };
      });
      onChangeHotspots(updated);
    }
  };

  const handlePointerUp = () => {
    if (!dragState) return;
    if (dragState.mode === 'create') {
      const x1 = Math.min(dragState.startXPercent, dragState.currentXPercent);
      const y1 = Math.min(dragState.startYPercent, dragState.currentYPercent);
      const w = Math.abs(dragState.currentXPercent - dragState.startXPercent);
      const h = Math.abs(dragState.currentYPercent - dragState.startYPercent);

      if (w >= 1.5 && h >= 1.5) {
        const newId = `hs_${nanoid(8)}`;
        const newHs: Hotspot = {
          id: newId,
          shape: dragState.shape,
          x: Number(x1.toFixed(2)),
          y: Number(y1.toFixed(2)),
          width: Number(w.toFixed(2)),
          height: Number(h.toFixed(2)),
          title: `Kritik Alan ${hotspots.length + 1}`,
          message: 'Dikkat: Bu alanın eksiksiz doldurulması ve imzalanması zorunludur.',
        };
        onChangeHotspots([...hotspots, newHs], newId);
      }
    }
    setDragState(null);
  };

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDownBackground}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      className={`relative inline-block shadow-2xl rounded bg-white select-none overflow-hidden touch-none ${
        activeTool === 'select' ? 'cursor-default' : 'cursor-crosshair'
      }`}
    >
      <img
        src={imageUrl}
        alt="Evrak Önizleme"
        draggable={false}
        className="max-h-[42dvh] lg:max-h-[calc(100vh-150px)] w-auto object-contain block pointer-events-none select-none"
      />

      {hotspots.map((hs, idx) => {
        const isSelected = hs.id === selectedHotspotId;
        if (hs.shape === 'pin') {
          return (
            <div
              key={hs.id}
              onPointerDown={(e) => handlePointerDownHotspot(e, hs)}
              style={{ left: `${hs.x}%`, top: `${hs.y}%` }}
              className={`absolute -translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full flex items-center justify-center font-extrabold text-sm cursor-move transition-transform ${
                isSelected
                  ? 'bg-amber-500 text-slate-950 ring-4 ring-amber-300 scale-110 z-20'
                  : 'bg-rose-600 text-white ring-2 ring-white/90 hover:scale-105 z-10'
              } shadow-lg`}
            >
              {idx + 1}
            </div>
          );
        }

        return (
          <div
            key={hs.id}
            onPointerDown={(e) => handlePointerDownHotspot(e, hs)}
            style={{
              left: `${hs.x}%`,
              top: `${hs.y}%`,
              width: `${hs.width}%`,
              height: `${hs.height}%`,
              borderRadius: hs.shape === 'ellipse' ? '9999px' : '6px',
            }}
            className={`absolute cursor-move transition-shadow ${
              isSelected
                ? 'border-[3px] border-amber-400 bg-amber-400/25 shadow-[0_0_0_3px_rgba(245,158,11,0.45)] z-20'
                : 'border-2 border-rose-500 bg-rose-500/15 hover:bg-rose-500/25 z-10'
            }`}
          >
            <span
              className={`absolute -top-3 -left-3 w-6 h-6 rounded-full flex items-center justify-center text-xs font-extrabold shadow ${
                isSelected ? 'bg-amber-400 text-slate-950' : 'bg-rose-600 text-white'
              }`}
            >
              {idx + 1}
            </span>
          </div>
        );
      })}

      {dragState && dragState.mode === 'create' && (
        <div
          style={{
            left: `${Math.min(dragState.startXPercent, dragState.currentXPercent)}%`,
            top: `${Math.min(dragState.startYPercent, dragState.currentYPercent)}%`,
            width: `${Math.abs(dragState.currentXPercent - dragState.startXPercent)}%`,
            height: `${Math.abs(dragState.currentYPercent - dragState.startYPercent)}%`,
            borderRadius: dragState.shape === 'ellipse' ? '9999px' : '6px',
          }}
          className="absolute border-2 border-dashed border-amber-400 bg-amber-400/25 pointer-events-none z-30"
        />
      )}
    </div>
  );
};

export const HotspotEditorModal: React.FC = () => {
  const {
    folders,
    selectedFolderId,
    activeHotspotPageId,
    openHotspotEditor,
    updatePageHotspots,
    updatePageSize,
  } = useAdminStore();

  const folder = folders.find((f) => f.id === selectedFolderId);
  const pages = folder ? [...folder.pages].sort((a, b) => a.orderIndex - b.orderIndex) : [];
  const currentIndex = pages.findIndex((p) => p.id === activeHotspotPageId);
  const page = currentIndex >= 0 ? pages[currentIndex] : null;

  const [localHotspots, setLocalHotspots] = useState<Hotspot[]>([]);
  const [selectedHotspotId, setSelectedHotspotId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<EditorTool>('rect');
  const messageTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (page) {
      setLocalHotspots(page.hotspots);
      setSelectedHotspotId(page.hotspots[0]?.id ?? null);
    }
  }, [page?.id]);

  if (!folder || !page) return null;

  const handleHotspotsChange = (next: Hotspot[], newlyCreatedId?: string) => {
    setLocalHotspots(next);
    updatePageHotspots(page.id, next);
    if (newlyCreatedId) {
      setSelectedHotspotId(newlyCreatedId);
      setTimeout(() => {
        messageTextareaRef.current?.focus();
        messageTextareaRef.current?.select();
      }, 60);
    }
  };

  const handleUpdateHotspotField = (
    hotspotId: string,
    field: 'title' | 'message',
    value: string
  ) => {
    const next = localHotspots.map((h) => (h.id === hotspotId ? { ...h, [field]: value } : h));
    setLocalHotspots(next);
    updatePageHotspots(page.id, next);
  };

  const handleDeleteHotspot = (hotspotId: string) => {
    const next = localHotspots.filter((h) => h.id !== hotspotId);
    setLocalHotspots(next);
    updatePageHotspots(page.id, next);
    if (selectedHotspotId === hotspotId) {
      setSelectedHotspotId(next[0]?.id ?? null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/95 flex flex-col">
      <div className="min-h-[56px] px-3 sm:px-6 py-2 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <span className="px-2.5 py-1 rounded-md bg-amber-500 text-slate-950 font-extrabold text-xs shrink-0 whitespace-nowrap">
            {currentIndex + 1}. SAYFA
          </span>
          <h3 className="text-xs sm:text-sm font-bold text-white truncate">
            <span className="md:hidden">Kritik Alan Editörü</span>
            <span className="hidden md:inline">Kritik Alan ve Spot Işığı (Spotlight) Uyarı Editörü</span>
          </h3>
          <span className="text-xs text-slate-400 hidden md:inline">({page.sourceFileName})</span>
        </div>

        <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800 overflow-x-auto max-w-full">
          <button
            type="button"
            onClick={() => setActiveTool('rect')}
            className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              activeTool === 'rect' ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Square className="w-3.5 h-3.5 shrink-0" />
            <span>Dikdörtgen</span>
            <span className="hidden md:inline">Çiz</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTool('ellipse')}
            className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              activeTool === 'ellipse'
                ? 'bg-amber-500 text-slate-950'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Circle className="w-3.5 h-3.5 shrink-0" />
            <span>Elips</span>
            <span className="hidden md:inline">/ Daire Çiz</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTool('pin')}
            className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              activeTool === 'pin' ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <MapPin className="w-3.5 h-3.5 shrink-0" />
            <span>Pin</span>
            <span className="hidden md:inline">Bırak</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTool('select')}
            className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              activeTool === 'select'
                ? 'bg-amber-500 text-slate-950'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <MousePointer className="w-3.5 h-3.5 shrink-0" />
            <span>Seç</span>
            <span className="hidden md:inline">/ Taşı</span>
          </button>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <div className="flex items-center gap-1 bg-slate-800 p-0.5 rounded-lg border border-slate-700">
            {(['A4', 'A3'] as const).map((sz) => (
              <button
                key={sz}
                type="button"
                onClick={() => updatePageSize(page.id, sz)}
                className={`px-2 sm:px-2.5 py-1 text-xs font-bold rounded-md transition-colors ${
                  page.paperSize === sz
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {sz}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={currentIndex <= 0}
              onClick={() => openHotspotEditor(pages[currentIndex - 1]?.id ?? null)}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200"
              title="Önceki Sayfa"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              disabled={currentIndex >= pages.length - 1}
              onClick={() => openHotspotEditor(pages[currentIndex + 1]?.id ?? null)}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200"
              title="Sonraki Sayfa"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => openHotspotEditor(null)}
            className="inline-flex items-center gap-1.5 px-3 sm:px-4 py-1.5 rounded-lg text-xs font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 transition-colors whitespace-nowrap shrink-0"
          >
            <Check className="w-4 h-4" />
            <span>Tamamla</span>
            <span className="hidden md:inline">ve Kapat</span>
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        <div className="flex-1 min-h-[45%] overflow-auto flex items-center justify-center p-3 sm:p-6 bg-slate-950">
          <HotspotCanvasLayer
            imageUrl={page.imageUrl}
            hotspots={localHotspots}
            selectedHotspotId={selectedHotspotId}
            activeTool={activeTool}
            onSelectHotspot={setSelectedHotspotId}
            onChangeHotspots={handleHotspotsChange}
          />
        </div>

        <div className="w-full lg:w-96 max-h-[45%] lg:max-h-none shrink-0 bg-slate-900 border-t lg:border-t-0 lg:border-l border-slate-800 flex flex-col overflow-y-auto">
          <div className="p-4 border-b border-slate-800">
            <h4 className="text-sm font-bold text-white">
              Bu Sayfadaki Kritik Uyarılar ({localHotspots.length})
            </h4>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Sol taraftaki evrak üzerinde mouse ile alanı seçin ve vatandaşın ekranda göreceği spot ışığı uyarısını yazın.
            </p>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {localHotspots.length === 0 ? (
              <div className="border border-dashed border-slate-700 rounded-xl p-6 text-center text-slate-400 text-xs leading-relaxed">
                Henüz bu sayfa için kritik uyarı alanı seçilmedi. Üstten{' '}
                <strong className="text-amber-400">Dikdörtgen Çiz</strong> aracını seçip evrak üzerindeki tarih, imza veya kaşe alanını mouse ile tarayın.
              </div>
            ) : (
              localHotspots.map((hs, idx) => {
                const isSelected = hs.id === selectedHotspotId;
                return (
                  <div
                    key={hs.id}
                    onClick={() => setSelectedHotspotId(hs.id)}
                    className={`rounded-xl p-3.5 border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-amber-500/10 border-amber-500 shadow-lg'
                        : 'bg-slate-800/70 border-slate-700/80 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-amber-400">
                        <span className="w-5 h-5 rounded-full bg-amber-500 text-slate-950 flex items-center justify-center text-[11px]">
                          {idx + 1}
                        </span>
                        {idx + 1}. Spot Işığı Uyarısı
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteHotspot(hs.id);
                        }}
                        className="p-1 rounded hover:bg-red-600/80 text-slate-400 hover:text-white transition-colors"
                        title="Uyarıyı Sil"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="space-y-2">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-400 mb-1">
                          Kısa Başlık (İsteğe Bağlı)
                        </label>
                        <input
                          type="text"
                          value={hs.title || ''}
                          onChange={(e) => handleUpdateHotspotField(hs.id, 'title', e.target.value)}
                          placeholder="Örn: Başvuru Tarihi / Islak İmza"
                          className="w-full px-2.5 py-1.5 text-xs text-white bg-slate-950 border border-slate-700 rounded-lg focus:outline-none focus:border-amber-500"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-slate-400 mb-1">
                          Vatandaşa Gösterilecek Kritik Uyarı Metni
                        </label>
                        <textarea
                          ref={isSelected ? messageTextareaRef : undefined}
                          rows={3}
                          value={hs.message}
                          onChange={(e) =>
                            handleUpdateHotspotField(hs.id, 'message', e.target.value)
                          }
                          placeholder="Örn: Dikkat! Buradaki tarih başvuru günü ile aynı olmalıdır."
                          className="w-full px-2.5 py-1.5 text-xs text-white bg-slate-950 border border-slate-700 rounded-lg focus:outline-none focus:border-amber-500 resize-none leading-relaxed"
                        />
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export const TimelineSlot: React.FC<{
  page: PageItem;
  index: number;
  onOpenHotspotEditor: () => void;
  onChangePaperSize: (size: PaperSize) => void;
  onReplaceDocument: (file: File) => void;
  onDeletePage: () => void;
}> = ({
  page,
  index,
  onOpenHotspotEditor,
  onChangePaperSize,
  onReplaceDocument,
  onDeletePage,
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: page.id,
  });
  const replaceInputRef = useRef<HTMLInputElement>(null);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative w-44 shrink-0 rounded-xl bg-slate-800/90 border ${
        page.paperSize === 'A3'
          ? 'border-amber-500/60 shadow-lg shadow-amber-950/30'
          : 'border-slate-700 hover:border-slate-500'
      } flex flex-col overflow-hidden select-none transition-all ${
        isDragging ? 'opacity-75 scale-105 shadow-2xl ring-2 ring-amber-400' : ''
      }`}
    >
      <div className="flex items-center justify-between px-2.5 py-1.5 bg-slate-900/90 border-b border-slate-700/80">
        <div
          {...attributes}
          {...listeners}
          title="Sırayı değiştirmek için sürükleyin"
          className="flex items-center gap-1 cursor-grab active:cursor-grabbing text-xs font-bold text-slate-200"
        >
          <GripHorizontal className="w-3.5 h-3.5 text-slate-400" />
          <span>{index + 1}. Sayfa</span>
        </div>

        <div
          onClick={(e) => e.stopPropagation()}
          className="inline-flex rounded-md bg-slate-800 p-0.5 border border-slate-700"
        >
          {(['A4', 'A3'] as const).map((sz) => (
            <button
              key={sz}
              type="button"
              onClick={() => onChangePaperSize(sz)}
              className={`px-1.5 py-0.5 text-[10px] font-bold rounded transition-colors ${
                page.paperSize === sz
                  ? sz === 'A3'
                    ? 'bg-amber-500 text-slate-950'
                    : 'bg-sky-500 text-slate-950'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {sz}
            </button>
          ))}
        </div>
      </div>

      <div
        onClick={onOpenHotspotEditor}
        className="relative flex-1 bg-slate-950/60 flex items-center justify-center p-2 cursor-pointer overflow-hidden"
      >
        <img
          src={page.thumbnailUrl || page.imageUrl}
          alt={`${index + 1}. Sayfa`}
          className={`max-h-28 object-contain rounded shadow-md bg-white transition-transform duration-200 group-hover:scale-105 ${
            page.paperSize === 'A3' ? 'w-36 border-2 border-amber-400/70' : 'w-24'
          }`}
          loading="lazy"
        />

        {page.paperSize === 'A3' && (
          <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-amber-500/95 text-slate-950 text-[9px] font-extrabold tracking-tight shadow">
            A3 Z-KATLAMA
          </span>
        )}

        <div className="absolute inset-0 bg-slate-950/65 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1 p-2 text-center">
          <Sparkles className="w-5 h-5 text-amber-400" />
          <span className="text-[11px] font-semibold text-white leading-tight">
            Kritik Alan / Uyarı Düzenle
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between px-2.5 py-1.5 bg-slate-900/90 border-t border-slate-700/80">
        <button
          type="button"
          onClick={onOpenHotspotEditor}
          className={`inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded ${
            page.hotspots.length > 0
              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
              : 'text-slate-400 hover:text-amber-300'
          }`}
        >
          <AlertCircle className="w-3 h-3" />
          {page.hotspots.length > 0 ? `${page.hotspots.length} Uyarı` : '+ Uyarı Ekle'}
        </button>

        <div className="flex items-center gap-1">
          <input
            ref={replaceInputRef}
            type="file"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                onReplaceDocument(f);
                e.target.value = '';
              }
            }}
          />
          <button
            type="button"
            onClick={() => replaceInputRef.current?.click()}
            title="Bu Sayfanın Belgesini Değiştir"
            className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onDeletePage}
            title="Bu Sayfayı Sil"
            className="p-1 rounded hover:bg-red-600/80 text-slate-400 hover:text-white transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export const BottomTimeline: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const {
    folders,
    selectedFolderId,
    isUploading,
    uploadMessage,
    selectFolder,
    openHotspotEditor,
    uploadPages,
    replacePageDocument,
    updatePageSize,
    deletePage,
    reorderPages,
  } = useAdminStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [insertAtIndex, setInsertAtIndex] = useState<number | undefined>(undefined);
  const [isDragOver, setIsDragOver] = useState(false);
  const [pageToDelete, setPageToDelete] = useState<PageItem | null>(null);

  const selectedFolder = folders.find((f) => f.id === selectedFolderId);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  if (!selectedFolder) return null;
  const pages = [...selectedFolder.pages].sort((a, b) => a.orderIndex - b.orderIndex);

  const triggerUploadAt = (idx?: number) => {
    setInsertAtIndex(idx);
    fileInputRef.current?.click();
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = pages.findIndex((p) => p.id === active.id);
    const newIndex = pages.findIndex((p) => p.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    reorderPages(arrayMove(pages, oldIndex, newIndex).map((p) => p.id));
  };

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const droppedFiles = Array.from(e.dataTransfer.files || []);
    if (droppedFiles.length > 0) uploadPages(droppedFiles);
  };

  const testViewerLink = user?.workspaceSlug
    ? `/v/${user.workspaceSlug}/dosya/${selectedFolder.id}`
    : `/dosya/${selectedFolder.id}`;

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleFileDrop}
      className={`min-h-[236px] max-h-[45dvh] sm:h-[268px] sm:max-h-none shrink-0 bg-slate-900/95 border-t-2 transition-colors flex flex-col ${
        isDragOver ? 'border-amber-400 bg-amber-950/20' : 'border-slate-700/90'
      }`}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length > 0) {
            uploadPages(files, insertAtIndex);
            e.target.value = '';
          }
        }}
      />

      <div className="min-h-[44px] px-3 sm:px-6 py-2 bg-slate-950/80 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="flex items-center gap-1.5 sm:gap-2 text-amber-400 font-semibold text-xs sm:text-sm shrink-0">
            <Layers className="w-4 h-4 shrink-0" />
            <span className="sm:hidden">Zaman Çizelgesi:</span>
            <span className="hidden sm:inline">Evrak Dizilim Zaman Çizelgesi (Timeline):</span>
          </div>
          <span className="text-xs sm:text-sm font-bold text-white px-2 sm:px-2.5 py-0.5 rounded-md bg-slate-800 border border-slate-700 truncate max-w-[140px] sm:max-w-xs">
            {selectedFolder.title}
          </span>
          <span className="text-xs text-slate-400 hidden lg:inline">
            ({pages.length} Sayfa Kare — Buradaki sıra 3D dosyadaki sayfa sırasıyla birebir aynıdır)
          </span>
        </div>

        <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap">
          {isUploading && (
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs font-medium shrink-0">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>{uploadMessage || 'Dönüştürülüyor...'}</span>
            </div>
          )}

          <button
            type="button"
            disabled={isUploading}
            onClick={() => triggerUploadAt(undefined)}
            className="inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-950 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 transition-colors shadow whitespace-nowrap shrink-0"
          >
            <FileUp className="w-3.5 h-3.5 shrink-0" />
            <span>+ Evrak Yükle</span>
            <span className="hidden md:inline">(PDF, Word, Excel, Görsel)</span>
          </button>

          <Link
            to={testViewerLink}
            className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors whitespace-nowrap shrink-0"
          >
            <ExternalLink className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="sm:hidden">3D Test</span>
            <span className="hidden sm:inline">3D Dosyada Test Et</span>
          </Link>

          <button
            type="button"
            onClick={() => selectFolder(null)}
            title="Timeline'ı Kapat"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-hidden touch-pan-x px-3 sm:px-6 py-2.5 sm:py-3 flex items-center">
        {pages.length === 0 ? (
          <div
            onClick={() => triggerUploadAt(0)}
            className="w-full h-full border-2 border-dashed border-slate-700 hover:border-amber-500/70 rounded-xl flex flex-col items-center justify-center cursor-pointer bg-slate-950/40 hover:bg-slate-900/60 transition-all p-4 text-center"
          >
            <FileUp className="w-7 h-7 text-amber-400 mb-1.5" />
            <p className="text-sm font-semibold text-slate-200">
              Bu Dosyaya Evrak Eklemek İçin Tıklayın veya Belgeleri Buraya Sürükleyin
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              Çok sayfalı PDF, Word (.docx) ve Excel (.xlsx) dosyaları otomatik olarak tekil sayfa görsellerine bölünüp sırayla dizilir.
            </p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={pages.map((p) => p.id)}
              strategy={horizontalListSortingStrategy}
            >
              <div className="flex items-stretch gap-2 h-full">
                <button
                  type="button"
                  onClick={() => triggerUploadAt(0)}
                  title="1. Sayfanın Önüne Evrak Ekle"
                  className="w-7 shrink-0 rounded-lg border border-dashed border-slate-700 hover:border-amber-500 bg-slate-950/40 hover:bg-amber-500/15 text-slate-500 hover:text-amber-400 flex items-center justify-center transition-all"
                >
                  <Plus className="w-4 h-4" />
                </button>

                {pages.map((page, idx) => (
                  <React.Fragment key={page.id}>
                    <TimelineSlot
                      page={page}
                      index={idx}
                      onOpenHotspotEditor={() => openHotspotEditor(page.id)}
                      onChangePaperSize={(size) => updatePageSize(page.id, size)}
                      onReplaceDocument={(file) => replacePageDocument(page.id, file)}
                      onDeletePage={() => setPageToDelete(page)}
                    />
                    <button
                      type="button"
                      onClick={() => triggerUploadAt(idx + 1)}
                      title={`${idx + 1}. ve ${idx + 2}. Sayfa Arasına Evrak Ekle`}
                      className="w-7 shrink-0 rounded-lg border border-dashed border-slate-700/80 hover:border-amber-500 bg-slate-950/30 hover:bg-amber-500/15 text-slate-500 hover:text-amber-400 flex items-center justify-center transition-all"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </React.Fragment>
                ))}

                <button
                  type="button"
                  onClick={() => triggerUploadAt(pages.length)}
                  className="w-40 shrink-0 rounded-xl border-2 border-dashed border-slate-700 hover:border-amber-500/70 bg-slate-950/40 hover:bg-slate-800/50 text-slate-400 hover:text-amber-400 flex flex-col items-center justify-center gap-1.5 p-3 transition-all"
                >
                  <div className="w-9 h-9 rounded-full bg-slate-800 flex items-center justify-center">
                    <Plus className="w-5 h-5" />
                  </div>
                  <span className="text-xs font-semibold">Yeni Sayfa Ekle</span>
                  <span className="text-[10px] text-slate-500 text-center">
                    {pages.length + 1}. Sıraya Ekle
                  </span>
                </button>
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(pageToDelete)}
        title="Evrak Sayfasını Sil"
        description={`"${
          pageToDelete ? pageToDelete.orderIndex + 1 : ''
        }. Sayfa" (${pageToDelete?.sourceFileName}) evrakını dosyadan çıkarmak istediğinize emin misiniz? Sonraki sayfalar otomatik olarak yeniden numaralandırılacaktır.`}
        onCancel={() => setPageToDelete(null)}
        onConfirm={() => {
          if (pageToDelete) {
            deletePage(pageToDelete.id);
            setPageToDelete(null);
          }
        }}
      />
    </div>
  );
};

const SortableFolderCard: React.FC<{
  folder: FolderItem;
  isSelected: boolean;
  isEditing: boolean;
  onSelect: () => void;
  onStartEdit: () => void;
  onCommitEdit: (newTitle: string) => void;
  onCancelEdit: () => void;
  onTogglePublished: () => void;
  onShareFolder: () => void;
  onRequestDelete: () => void;
}> = ({
  folder,
  isSelected,
  isEditing,
  onSelect,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onTogglePublished,
  onShareFolder,
  onRequestDelete,
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: folder.id,
  });
  const [draftTitle, setDraftTitle] = useState(folder.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraftTitle(folder.title);
  }, [folder.title]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 40 : undefined,
  };

  const hasA3 = folder.pages.some((p) => p.paperSize === 'A3');
  const hotspotCount = folder.pages.reduce((acc, p) => acc + p.hotspots.length, 0);
  const isPublished = folder.isPublished !== false;

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onSelect}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onStartEdit();
      }}
      className={`group relative overflow-hidden min-w-0 flex flex-col items-center rounded-2xl p-2.5 sm:p-4 cursor-pointer select-none transition-all border ${
        isSelected
          ? 'bg-amber-500/15 border-amber-500/70 shadow-xl shadow-amber-950/30 ring-2 ring-amber-500/30'
          : 'bg-slate-800/55 hover:bg-slate-800 border-slate-700/70 hover:border-slate-600'
      } ${isDragging ? 'opacity-70 scale-105 shadow-2xl' : ''} ${
        !isPublished ? 'opacity-80' : ''
      }`}
    >
      <div className="w-full flex flex-wrap items-center justify-between mb-1.5 gap-1">
        <div className="flex items-center gap-1 min-w-0">
          <button
            type="button"
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
            title="Sıralamak için sürükleyin"
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-700/60 cursor-grab active:cursor-grabbing shrink-0"
          >
            <GripVertical className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTogglePublished();
            }}
            title={isPublished ? 'Yayında (Gizlemek için tıklayın)' : 'Taslak (Yayınlamak için tıklayın)'}
            className={`px-1.5 py-0.5 rounded-full text-[9px] font-extrabold inline-flex items-center gap-1 border transition-colors whitespace-nowrap ${
              isPublished
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/25'
                : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-white'
            }`}
          >
            {isPublished ? <Globe className="w-2.5 h-2.5" /> : <EyeOff className="w-2.5 h-2.5" />}
            {isPublished ? 'Yayında' : 'Taslak'}
          </button>
        </div>

        <div className="w-full grid grid-cols-4 gap-1 mt-1.5 sm:mt-0 sm:w-auto sm:flex sm:items-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onShareFolder();
            }}
            title="Paylaş / QR Kod"
            className="flex items-center justify-center p-1.5 rounded-lg bg-slate-700/80 hover:bg-amber-500 text-amber-300 hover:text-slate-950 transition-colors"
          >
            <Share2 className="w-3.5 h-3.5" />
          </button>
          <Link
            to={`/d/${folder.shareToken || folder.id}`}
            onClick={(e) => e.stopPropagation()}
            title="Vatandaş 3D Görünümünde Aç"
            className="flex items-center justify-center p-1.5 rounded-lg bg-slate-700/80 hover:bg-sky-500 text-slate-200 hover:text-slate-950 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onStartEdit();
            }}
            title="Dosya Adını Değiştir"
            className="flex items-center justify-center p-1.5 rounded-lg bg-slate-700/80 hover:bg-slate-600 text-slate-200 transition-colors"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRequestDelete();
            }}
            title="Dosyayı Sil"
            className="flex items-center justify-center p-1.5 rounded-lg bg-slate-700/80 hover:bg-red-600 text-slate-200 hover:text-white transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="my-1 transition-transform duration-200 group-hover:-translate-y-1">
        <KraftFolderIcon
          title={folder.title}
          pageCount={folder.pages.length}
          hasA3={hasA3}
          className="w-24 h-32 sm:w-32 sm:h-44 md:w-36 md:h-48 drop-shadow-xl"
        />
      </div>

      <div className="w-full mt-2 text-center">
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCommitEdit(draftTitle);
              else if (e.key === 'Escape') {
                setDraftTitle(folder.title);
                onCancelEdit();
              }
            }}
            onBlur={() => onCommitEdit(draftTitle)}
            className="w-full px-2.5 py-1 text-sm font-semibold text-center text-white bg-slate-900 border border-amber-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        ) : (
          <h4
            title={folder.title}
            className="text-sm font-semibold text-slate-100 line-clamp-2 leading-snug px-1"
          >
            {folder.title}
          </h4>
        )}

        <div className="mt-2 flex items-center justify-center gap-1.5 flex-wrap">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-900/80 text-slate-300 border border-slate-700">
            <FileText className="w-3 h-3 text-amber-400" />
            {folder.pages.length} Evrak
          </span>
          {hasA3 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
              A3 Katlı
            </span>
          )}
          {hotspotCount > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/40">
              {hotspotCount} Uyarı
            </span>
          )}
          {(folder.viewCount ?? 0) > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/15 text-sky-300 border border-sky-500/30">
              <Eye className="w-2.5 h-2.5" />
              {folder.viewCount}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export const ExplorerGrid: React.FC<{ onShareFolder: (folder: FolderItem) => void }> = ({
  onShareFolder,
}) => {
  const {
    folders,
    selectedFolderId,
    editingFolderId,
    selectFolder,
    setEditingFolderId,
    createFolder,
    renameFolder,
    updateFolderMeta,
    deleteFolder,
    reorderFolders,
  } = useAdminStore();

  const [folderToDelete, setFolderToDelete] = useState<FolderItem | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = folders.findIndex((f) => f.id === active.id);
    const newIndex = folders.findIndex((f) => f.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    reorderFolders(arrayMove(folders, oldIndex, newIndex).map((f) => f.id));
  };

  return (
    <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 sm:py-5">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-wrap items-center justify-between mb-4 gap-2">
          <div>
            <h2 className="text-sm sm:text-base font-semibold text-slate-200 flex flex-wrap items-center gap-2">
              <span>Dosya Kategorileri (Yarım Kapak Başvuru Dosyaları)</span>
              <span className="px-2 py-0.5 text-xs rounded-full bg-slate-800 text-slate-400 border border-slate-700 whitespace-nowrap shrink-0">
                {folders.length} Klasör
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Düzenlemek istediğiniz dosyaya tıklayarak alt kısımdaki Evrak Dizilim Çizelgesini (Timeline) açabilirsiniz. İsim değiştirmek için çift tıklayın.
            </p>
          </div>
        </div>

        {folders.length === 0 ? (
          <div className="border-2 border-dashed border-slate-700 rounded-2xl p-12 text-center bg-slate-900/40">
            <div className="mx-auto w-24 h-32 mb-4 opacity-75">
              <KraftFolderIcon title="ÖRNEK DOSYA" className="w-24 h-32" />
            </div>
            <h3 className="text-lg font-semibold text-white">Henüz Başvuru Dosyası Oluşturulmadı</h3>
            <p className="text-sm text-slate-400 max-w-md mx-auto mt-1 mb-5">
              Vatandaşların 3 boyutlu olarak inceleyeceği ilk yarım kapak başvuru dosyasını (Örn: Tadilat Dosyası, Yeni Ruhsat Dosyası) hemen oluşturun.
            </p>
            <button
              type="button"
              onClick={() => createFolder()}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-950 bg-amber-500 hover:bg-amber-400 shadow-lg shadow-amber-500/20 transition-all"
            >
              <FolderPlus className="w-4 h-4" />
              + Yeni Dosya Ekle
            </button>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={folders.map((f) => f.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
                {folders.map((folder) => (
                  <SortableFolderCard
                    key={folder.id}
                    folder={folder}
                    isSelected={folder.id === selectedFolderId}
                    isEditing={folder.id === editingFolderId}
                    onSelect={() => selectFolder(folder.id)}
                    onStartEdit={() => setEditingFolderId(folder.id)}
                    onCommitEdit={(newTitle) => renameFolder(folder.id, newTitle)}
                    onCancelEdit={() => setEditingFolderId(null)}
                    onTogglePublished={() =>
                      updateFolderMeta(folder.id, { isPublished: !(folder.isPublished !== false) })
                    }
                    onShareFolder={() => onShareFolder(folder)}
                    onRequestDelete={() => setFolderToDelete(folder)}
                  />
                ))}

                <button
                  type="button"
                  onClick={() => createFolder()}
                  className="flex flex-col items-center justify-center rounded-2xl p-3 sm:p-4 border-2 border-dashed border-slate-700/80 hover:border-amber-500/60 bg-slate-900/30 hover:bg-slate-800/50 text-slate-400 hover:text-amber-400 transition-all min-h-[210px] sm:min-h-[260px] text-center group min-w-0"
                >
                  <div className="w-12 h-12 rounded-full bg-slate-800 group-hover:bg-amber-500/20 flex items-center justify-center mb-3 transition-colors">
                    <FolderPlus className="w-6 h-6" />
                  </div>
                  <span className="text-sm font-semibold">+ Yeni Dosya Ekle</span>
                  <span className="text-xs text-slate-500 mt-1">Yarım Kapak Klasör</span>
                </button>
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(folderToDelete)}
        title="Başvuru Dosyasını Sil"
        description={`"${folderToDelete?.title}" dosyasını ve içindeki ${
          folderToDelete?.pages.length ?? 0
        } adet evrak sayfasını kalıcı olarak silmek istediğinize emin misiniz?`}
        onCancel={() => setFolderToDelete(null)}
        onConfirm={() => {
          if (folderToDelete) {
            deleteFolder(folderToDelete.id);
            setFolderToDelete(null);
          }
        }}
      />
    </div>
  );
};

export const AdminLayout: React.FC = () => {
  const {
    user,
    pendingGoogleOnboarding,
    needsInitialSetup,
    isInitializing,
    checkAuthStatus,
    logout,
  } = useAuthStore();
  const { fetchFolders, resetAdminState, createFolder, error, clearError } = useAdminStore();

  const [shareTarget, setShareTarget] = useState<{
    mode: 'workspace' | 'folder';
    folder?: FolderItem;
  } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    checkAuthStatus();
  }, [checkAuthStatus]);

  useEffect(() => {
    if (user) {
      fetchFolders();
    } else {
      resetAdminState();
    }
  }, [user, fetchFolders, resetAdminState]);

  if (isInitializing) {
    return (
      <div className="h-[100dvh] w-screen bg-slate-950 flex flex-col items-center justify-center text-slate-200 gap-3">
        <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs font-semibold text-slate-400">Yönetim Paneli Hazırlanıyor...</p>
      </div>
    );
  }

  if (needsInitialSetup) {
    return <FirstRunSetupView />;
  }

  if (!user || pendingGoogleOnboarding) {
    return <AuthView />;
  }

  return (
    <div className="h-[100dvh] w-screen overflow-hidden flex flex-col bg-slate-950 text-slate-100">
      <header className="min-h-14 h-auto px-3 sm:px-5 py-2 bg-slate-900 border-b border-slate-800 flex items-center justify-between shrink-0 gap-2">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-white tracking-tight truncate">
                {user.displayName}
              </h1>
              <span className="hidden sm:inline-block px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-[10px] font-semibold text-amber-300 shrink-0">
                @{user.username}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 truncate">{user.workspaceTitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            type="button"
            onClick={() => createFolder()}
            className="inline-flex items-center gap-1.5 px-2.5 sm:px-3.5 py-2 rounded-xl text-xs font-bold text-slate-950 bg-amber-500 hover:bg-amber-400 shadow-lg shadow-amber-500/15 transition-all"
          >
            <FolderPlus className="w-4 h-4" />
            <span className="hidden sm:inline">+ Yeni Dosya Ekle</span>
          </button>

          <button
            type="button"
            onClick={() => setShareTarget({ mode: 'workspace' })}
            className="inline-flex items-center gap-1.5 px-2.5 sm:px-3.5 py-2 rounded-xl text-xs font-bold text-amber-300 bg-amber-500/15 hover:bg-amber-500 hover:text-slate-950 border border-amber-500/40 transition-all"
          >
            <Share2 className="w-4 h-4" />
            <span className="hidden md:inline">Masaüstümü Paylaş (Link & QR)</span>
          </button>

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            title="Masaüstü ve Hesap Ayarları"
            className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-xl text-xs font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors"
          >
            <Settings className="w-4 h-4 text-slate-300" />
            <span className="hidden lg:inline">Ayarlar</span>
          </button>

          <Link
            to={`/v/${user.workspaceSlug}`}
            className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-xl text-xs font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors"
          >
            <Eye className="w-4 h-4 text-amber-400" />
            <span className="hidden lg:inline">Vatandaş Vitrinim</span>
          </Link>

          <button
            type="button"
            onClick={logout}
            title="Çıkış Yap"
            className="p-2 rounded-xl text-slate-400 hover:text-rose-300 hover:bg-rose-500/15 border border-transparent hover:border-rose-500/30 transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {error && (
        <div className="bg-red-950/90 border-b border-red-800 px-6 py-2.5 flex items-center justify-between text-xs text-red-200">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={clearError}
            className="p-1 rounded hover:bg-red-900 text-red-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <ExplorerGrid
        onShareFolder={(folder) => setShareTarget({ mode: 'folder', folder })}
      />
      <BottomTimeline />
      <HotspotEditorModal />

      <ShareModal
        open={Boolean(shareTarget)}
        mode={shareTarget?.mode || 'workspace'}
        folder={shareTarget?.folder}
        onClose={() => setShareTarget(null)}
      />
      <WorkspaceSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
};

// ============================================================================
// 11. UYGULAMA KÖKÜ VE MOUNT (APP ROOT)
// ============================================================================

export const App: React.FC = () => (
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<SaaSLandingPage />} />
      <Route path="/dosya/:folderId" element={<CitizenViewerPage isPublicRoute={false} />} />
      <Route path="/v/:workspaceId" element={<CitizenShelfPage isSharedWorkspace={true} />} />
      <Route
        path="/v/:workspaceId/dosya/:folderId"
        element={<CitizenViewerPage isPublicRoute={true} />}
      />
      <Route path="/d/:shareToken" element={<CitizenViewerPage isPublicRoute={true} />} />
      <Route path="/admin" element={<AdminLayout />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </BrowserRouter>
);

const rootEl = document.getElementById('root');
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(<App />);
}
