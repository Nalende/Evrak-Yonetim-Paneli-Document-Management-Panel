import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import cors from 'cors';
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import mammoth from 'mammoth';
import multer from 'multer';
import { customAlphabet } from 'nanoid';
import sharp from 'sharp';
import * as XLSX from 'xlsx';
import { z } from 'zod';

sharp.cache(false);
sharp.concurrency(2);

let cachedMupdf: any = null;
async function getMupdfModule(): Promise<any> {
  if (!cachedMupdf) {
    cachedMupdf = await import('mupdf');
  }
  return cachedMupdf;
}

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);

function loadDotEnvFile(): void {
  const candidates = [
    path.resolve(SERVER_DIR, '../.env'),
    path.resolve(process.cwd(), '.env'),
  ];
  for (const envPath of candidates) {
    try {
      if (!fsSync.existsSync(envPath)) continue;
      const content = fsSync.readFileSync(envPath, 'utf-8');
      for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eqIdx = line.indexOf('=');
        if (eqIdx <= 0) continue;
        const key = line.slice(0, eqIdx).trim();
        let val = line.slice(eqIdx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (key && process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
      break;
    } catch {
      // Okunamayan .env dosyası yoksayılır
    }
  }
}

loadDotEnvFile();

const DEFAULT_GOOGLE_CLIENT_ID = '';

export function extractCleanGoogleClientId(raw?: string): string {
  if (!raw || typeof raw !== 'string') return '';
  const m = raw.match(/([0-9]+-[a-zA-Z0-9_]+\.apps\.googleusercontent\.com)/i);
  return m ? m[1] : '';
}

export function getEffectiveGoogleClientId(dbClientId?: string): string {
  return (
    extractCleanGoogleClientId(process.env.GOOGLE_CLIENT_ID) ||
    extractCleanGoogleClientId(dbClientId) ||
    ''
  );
}

export function getEffectiveJwtSecret(dbSecret: string): string {
  const envSecret = process.env.JWT_SECRET?.trim();
  if (envSecret && envSecret.length >= 16) return envSecret;
  return dbSecret;
}

// ============================================================================
// 1. TİPLER VE ŞEMALAR (TYPES & SCHEMAS)
// ============================================================================

export const PaperSizeSchema = z.enum(['A4', 'A3']);
export type PaperSize = z.infer<typeof PaperSizeSchema>;

export const HotspotShapeSchema = z.enum(['rect', 'ellipse', 'pin']);
export type HotspotShape = z.infer<typeof HotspotShapeSchema>;

export const HotspotSchema = z.object({
  id: z.string().min(1),
  shape: HotspotShapeSchema.default('rect'),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  width: z.number().min(0).max(100),
  height: z.number().min(0).max(100),
  title: z.string().max(120).optional(),
  message: z.string().min(1, 'Uyarı metni boş bırakılamaz').max(500),
});

export type Hotspot = z.infer<typeof HotspotSchema>;

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
  ownerId: string;
  title: string;
  description?: string;
  category?: string;
  isPublished: boolean;
  shareToken: string;
  sharePin?: string;
  viewCount: number;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
  pages: PageItem[];
}

export interface UserItem {
  id: string;
  username: string;
  email?: string;
  displayName: string;
  workspaceTitle: string;
  workspaceSubtitle: string;
  workspaceSlug: string;
  shareToken: string;
  workspacePin?: string;
  passwordHash?: string;
  authProvider: 'local' | 'google';
  googleSub?: string;
  avatarUrl?: string;
  role: 'superadmin' | 'user';
  createdAt: string;
}

export interface SystemSettings {
  jwtSecret: string;
  googleClientId?: string;
  allowPublicRegistration: boolean;
}

export interface DatabaseSchema {
  version: number;
  settings: SystemSettings;
  users: UserItem[];
  folders: FolderItem[];
}

export type SafeUser = Omit<UserItem, 'passwordHash'> & { hasPassword: boolean };

export interface AuthenticatedRequest extends Request {
  authUser?: UserItem;
}

export type ErrorCode =
  | 'UNSUPPORTED_FORMAT'
  | 'FILE_TOO_LARGE'
  | 'LIBREOFFICE_MISSING'
  | 'CONVERSION_FAILED'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'RATE_LIMITED';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

// ============================================================================
// 2. KİMLİK VE TOKEN ÜRETİCİLERİ (ID & CRYPTO HELPERS)
// ============================================================================

const nanoid = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 10);
const shortTokenGen = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8);
const hashGen = customAlphabet('0123456789abcdef', 6);

export const createFolderId = () => `fld_${nanoid()}`;
export const createPageId = () => `pg_${nanoid()}`;
export const createHotspotId = () => `hs_${nanoid()}`;
export const createUserId = () => `usr_${nanoid()}`;
export const createWorkspaceShareToken = () => `ws_${shortTokenGen()}`;
export const createFolderShareToken = () => `f_${shortTokenGen()}`;
export const createShortHash = () => hashGen();

const TR_CHAR_MAP: Record<string, string> = {
  ç: 'c',
  Ç: 'c',
  ğ: 'g',
  Ğ: 'g',
  ı: 'i',
  İ: 'i',
  ö: 'o',
  Ö: 'o',
  ş: 's',
  Ş: 's',
  ü: 'u',
  Ü: 'u',
};

export function slugifyText(input: string, fallback = 'masa'): string {
  const mapped = input
    .split('')
    .map((ch) => TR_CHAR_MAP[ch] ?? ch)
    .join('')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return mapped || fallback;
}

export function generateUniqueWorkspaceSlug(
  desired: string,
  users: UserItem[],
  excludeUserId?: string
): string {
  const base = slugifyText(desired, 'calisma-alani');
  const taken = new Set(
    users.filter((u) => u.id !== excludeUserId).map((u) => u.workspaceSlug.toLowerCase())
  );
  if (!taken.has(base)) return base;
  let counter = 2;
  while (taken.has(`${base}-${counter}`)) {
    counter++;
  }
  return `${base}-${counter}`;
}

export function generateUniqueUsername(
  desired: string,
  users: UserItem[],
  excludeUserId?: string
): string {
  const mapped = desired
    .split('')
    .map((ch) => TR_CHAR_MAP[ch] ?? ch)
    .join('')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._-]+/g, '.')
    .replace(/\.{2,}/g, '.')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 48);

  const base = mapped.length >= 3 ? mapped : 'kullanici';
  const taken = new Set(
    users.filter((u) => u.id !== excludeUserId).map((u) => u.username.toLowerCase())
  );
  if (!taken.has(base)) return base;
  let counter = 2;
  while (taken.has(`${base}${counter}`)) {
    counter++;
  }
  return `${base}${counter}`;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  if (!salt || !keyHex) return false;
  try {
    const keyBuf = Buffer.from(keyHex, 'hex');
    const derivedBuf = crypto.scryptSync(password, salt, 64);
    if (keyBuf.length !== derivedBuf.length) return false;
    return crypto.timingSafeEqual(keyBuf, derivedBuf);
  } catch {
    return false;
  }
}

interface TokenPayload {
  sub: string;
  role: 'superadmin' | 'user';
  iat: number;
  exp: number;
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

export function signToken(user: UserItem, secret: string): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const nowSec = Math.floor(Date.now() / 1000);
  const payloadObj: TokenPayload = {
    sub: user.id,
    role: user.role,
    iat: nowSec,
    exp: nowSec + 60 * 60 * 24 * 30, // 30 gün
  };
  const payload = base64UrlEncode(JSON.stringify(payloadObj));
  const data = `${header}.${payload}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyToken(token: string, secret: string): TokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, sig] = parts;
    const data = `${header}.${payload}`;
    const expectedSig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

    const parsed = JSON.parse(base64UrlDecode(payload)) as TokenPayload;
    if (!parsed || !parsed.sub || typeof parsed.exp !== 'number') return null;
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function safeCompareString(a: string, b: string): boolean {
  const digestA = crypto.createHash('sha256').update(String(a), 'utf8').digest();
  const digestB = crypto.createHash('sha256').update(String(b), 'utf8').digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

const SAFE_SEGMENT_RE = /^[a-zA-Z0-9_-]{2,80}$/;

export function assertSafePathSegment(segment: string, label = 'kimlik'): string {
  if (!segment || typeof segment !== 'string' || !SAFE_SEGMENT_RE.test(segment)) {
    throw new AppError('VALIDATION_ERROR', `Geçersiz ${label} formatı.`, 400);
  }
  return segment;
}

export function resolveSafeMediaPath(rootDir: string, ...parts: string[]): string {
  const normalizedRoot = path.resolve(rootDir);
  const resolved = path.resolve(normalizedRoot, ...parts);
  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + path.sep)) {
    throw new AppError('FORBIDDEN', 'Geçersiz dosya yolu erişimi engellendi.', 403);
  }
  return resolved;
}

export function sanitizeUser(user: UserItem): SafeUser {
  const { passwordHash, ...safe } = user;
  return {
    ...safe,
    hasPassword: Boolean(passwordHash),
  };
}

// ============================================================================
// 3. VERİTABANI VE DEPOLAMA KATMANI (JSON STORE + OTOMATİK GÖÇ)
// ============================================================================

export const STORAGE_ROOT = path.resolve(SERVER_DIR, '../storage');
export const DATA_DIR = path.join(STORAGE_ROOT, 'data');
export const MEDIA_DIR = path.join(STORAGE_ROOT, 'media');
export const FOLDERS_MEDIA_DIR = path.join(MEDIA_DIR, 'folders');
const DB_PATH = path.join(DATA_DIR, 'db.json');

let writeQueue: Promise<void> = Promise.resolve();

async function ensureDirectories(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(FOLDERS_MEDIA_DIR, { recursive: true });
}

function normalizeDbStructure(rawParsed: Partial<DatabaseSchema> | null | undefined): {
  db: DatabaseSchema;
  changed: boolean;
} {
  let changed = false;

  const settings: SystemSettings = {
    jwtSecret:
      rawParsed?.settings?.jwtSecret && rawParsed.settings.jwtSecret.length >= 16
        ? rawParsed.settings.jwtSecret
        : (() => {
            changed = true;
            return crypto.randomBytes(32).toString('hex');
          })(),
    googleClientId:
      extractCleanGoogleClientId(rawParsed?.settings?.googleClientId) || DEFAULT_GOOGLE_CLIENT_ID,
    allowPublicRegistration:
      typeof rawParsed?.settings?.allowPublicRegistration === 'boolean'
        ? rawParsed.settings.allowPublicRegistration
        : (() => {
            changed = true;
            return true;
          })(),
  };

  if (!rawParsed?.settings) {
    changed = true;
  }

  const users: UserItem[] = Array.isArray(rawParsed?.users)
    ? rawParsed!.users.map((u) => {
        const shareToken = u.shareToken || (() => {
          changed = true;
          return createWorkspaceShareToken();
        })();
        const workspaceSlug = u.workspaceSlug || (() => {
          changed = true;
          return slugifyText(u.displayName || u.username || 'calisma-alani');
        })();
        return {
          ...u,
          shareToken,
          workspaceSlug,
          workspaceTitle: u.workspaceTitle || 'Resmi Başvuru Dosyası Rehberleri',
          workspaceSubtitle:
            u.workspaceSubtitle || 'Başvuru öncesinde fiziksel dosya dizilimini ve kritik uyarıları inceleyin.',
          authProvider: u.authProvider || 'local',
          role: u.role || 'user',
        };
      })
    : (() => {
        changed = true;
        return [];
      })();

  const defaultOwnerId = users.find((u) => u.role === 'superadmin')?.id || users[0]?.id || '';

  const folders: FolderItem[] = Array.isArray(rawParsed?.folders)
    ? rawParsed!.folders.map((f) => {
        const ownerId =
          f.ownerId !== undefined
            ? f.ownerId
            : (() => {
                changed = true;
                return defaultOwnerId;
              })();
        const isPublished =
          typeof f.isPublished === 'boolean'
            ? f.isPublished
            : (() => {
                changed = true;
                return true;
              })();
        const shareToken =
          f.shareToken ||
          (() => {
            changed = true;
            return createFolderShareToken();
          })();
        const viewCount =
          typeof f.viewCount === 'number'
            ? f.viewCount
            : (() => {
                changed = true;
                return 0;
              })();

        return {
          ...f,
          ownerId: ownerId || defaultOwnerId,
          isPublished,
          shareToken,
          viewCount,
          pages: Array.isArray(f.pages) ? f.pages : [],
        };
      })
    : (() => {
        changed = true;
        return [];
      })();

  const version = rawParsed?.version && rawParsed.version >= 2 ? rawParsed.version : (() => {
    changed = true;
    return 2;
  })();

  return {
    db: {
      version,
      settings,
      users,
      folders,
    },
    changed,
  };
}

async function writeDbAtomic(db: DatabaseSchema): Promise<void> {
  const tmpPath = `${DB_PATH}.tmp.${Date.now()}.${Math.random().toString(16).slice(2, 6)}`;
  await fs.writeFile(tmpPath, JSON.stringify(db, null, 2), 'utf-8');
  await fs.rename(tmpPath, DB_PATH);
}

export async function readDb(): Promise<DatabaseSchema> {
  await ensureDirectories();
  try {
    const raw = await fs.readFile(DB_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<DatabaseSchema>;
    const { db, changed } = normalizeDbStructure(parsed);
    if (changed) {
      await writeDbAtomic(db).catch(() => {});
    }
    return db;
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      const { db } = normalizeDbStructure({
        version: 2,
        users: [],
        folders: [],
      });
      await writeDbAtomic(db);
      return db;
    }
    throw err;
  }
}

export async function mutateDb<T>(mutator: (db: DatabaseSchema) => Promise<T> | T): Promise<T> {
  let result!: T;
  let error: unknown;

  const task = writeQueue.then(async () => {
    try {
      const db = await readDb();
      result = await mutator(db);
      await writeDbAtomic(db);
    } catch (e) {
      error = e;
    }
  });

  writeQueue = task.catch(() => {});
  await task;

  if (error) {
    throw error;
  }
  return result;
}

// ============================================================================
// 4. EVRAK GÖRSEL İŞLEME VE DÖNÜŞTÜRME HATTI (INGEST PIPELINE)
// ============================================================================

export interface ProcessedPageImage {
  imageUrl: string;
  thumbnailUrl: string;
  naturalWidth: number;
  naturalHeight: number;
}

const MAX_PDF_PAGES = 150;
const SHARP_MAX_INPUT_PIXELS = 100_000_000;

export async function processAndSavePageImage(
  folderId: string,
  pageId: string,
  inputBuffer: Buffer
): Promise<ProcessedPageImage> {
  const safeFolderId = assertSafePathSegment(folderId, 'klasör kimliği');
  const safePageId = assertSafePathSegment(pageId, 'sayfa kimliği');
  const folderDir = resolveSafeMediaPath(FOLDERS_MEDIA_DIR, safeFolderId);
  await fs.mkdir(folderDir, { recursive: true });

  const hash = createShortHash();
  const mainFileName = `${safePageId}_${hash}.webp`;
  const thumbFileName = `${safePageId}_${hash}_thumb.webp`;

  const mainFilePath = resolveSafeMediaPath(folderDir, mainFileName);
  const thumbFilePath = resolveSafeMediaPath(folderDir, thumbFileName);

  const mainResult = await sharp(inputBuffer, { limitInputPixels: SHARP_MAX_INPUT_PIXELS })
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize({
      width: 3600,
      height: 3600,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 84, smartSubsample: true, effort: 4 })
    .toFile(mainFilePath);

  await sharp(mainFilePath, { limitInputPixels: SHARP_MAX_INPUT_PIXELS })
    .resize({
      width: 320,
      height: 450,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 80, effort: 3 })
    .toFile(thumbFilePath);

  return {
    imageUrl: `/media/folders/${safeFolderId}/${mainFileName}`,
    thumbnailUrl: `/media/folders/${safeFolderId}/${thumbFileName}`,
    naturalWidth: mainResult.width,
    naturalHeight: mainResult.height,
  };
}

export async function deletePageMediaFiles(imageUrl: string, thumbnailUrl: string): Promise<void> {
  const removeUrl = async (urlStr: string) => {
    if (!urlStr || !urlStr.startsWith('/media/folders/')) return;
    const rel = urlStr.slice('/media/folders/'.length);
    if (!rel) return;
    try {
      const fullPath = resolveSafeMediaPath(FOLDERS_MEDIA_DIR, ...rel.split('/').filter(Boolean));
      await fs.unlink(fullPath).catch(() => {});
    } catch {
      // Geçersiz yol girişimi yoksayılır
    }
  };
  await Promise.all([removeUrl(imageUrl), removeUrl(thumbnailUrl)]);
}

export async function forEachPdfRenderedPage(
  pdfBuffer: Buffer,
  onPagePng: (pngBuffer: Buffer, pageIndex: number) => Promise<void>
): Promise<void> {
  let doc: any = null;
  try {
    const mupdf = await getMupdfModule();
    doc = mupdf.Document.openDocument(pdfBuffer, 'application/pdf');
    if (doc.needsPassword()) {
      throw new AppError(
        'CONVERSION_FAILED',
        'Yüklenen PDF dosyası şifreli olduğu için işlenemedi. Lütfen şifresiz bir PDF yükleyiniz.',
        422
      );
    }

    const pageCount = doc.countPages();
    if (pageCount <= 0) {
      throw new AppError('CONVERSION_FAILED', 'PDF dosyasında geçerli bir sayfa bulunamadı.', 422);
    }
    if (pageCount > MAX_PDF_PAGES) {
      throw new AppError(
        'FILE_TOO_LARGE',
        `Tek bir PDF dosyasında en fazla ${MAX_PDF_PAGES} sayfa işlenebilir (Yüklenen: ${pageCount} sayfa).`,
        413
      );
    }

    // 240 DPI (~1984x2807 A4 / ~2807x3968 A3): yüksek metin & teknik çizim netliği + düşük bellek
    const scale = 240 / 72;
    const matrix = mupdf.Matrix.scale(scale, scale);

    for (let i = 0; i < pageCount; i++) {
      const page: any = doc.loadPage(i);
      let pixmap: any = null;
      try {
        pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true);
        const pngUint8 = pixmap.asPNG();
        await onPagePng(Buffer.from(pngUint8), i);
      } finally {
        pixmap?.destroy?.();
        page?.destroy?.();
      }
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('PDF render error:', err);
    throw new AppError(
      'CONVERSION_FAILED',
      'PDF belgesi yüksek çözünürlüklü sayfa görsellerine dönüştürülürken hata oluştu.',
      422
    );
  } finally {
    doc?.destroy?.();
  }
}

export async function cleanupOrphanMediaFiles(): Promise<number> {
  await ensureDirectories();
  const db = await readDb();
  const validFolderMap = new Map<string, Set<string>>();

  for (const folder of db.folders) {
    const fileSet = new Set<string>();
    const prefix = `/media/folders/${folder.id}/`;
    for (const p of folder.pages) {
      if (p.imageUrl?.startsWith(prefix)) fileSet.add(p.imageUrl.slice(prefix.length));
      if (p.thumbnailUrl?.startsWith(prefix)) fileSet.add(p.thumbnailUrl.slice(prefix.length));
    }
    validFolderMap.set(folder.id, fileSet);
  }

  let removedCount = 0;
  const now = Date.now();
  const entries = await fs.readdir(FOLDERS_MEDIA_DIR, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    const fullEntryPath = path.join(FOLDERS_MEDIA_DIR, entry.name);
    if (!entry.isDirectory()) continue;

    const validFiles = validFolderMap.get(entry.name);
    if (!validFiles) {
      const stat = await fs.stat(fullEntryPath).catch(() => null);
      if (stat && now - stat.mtimeMs > 60_000) {
        await fs.rm(fullEntryPath, { recursive: true, force: true }).catch(() => {});
        removedCount++;
      }
      continue;
    }

    const subEntries = await fs.readdir(fullEntryPath, { withFileTypes: true }).catch(() => []);
    for (const sub of subEntries) {
      if (!sub.isFile()) continue;
      if (!validFiles.has(sub.name)) {
        const subPath = path.join(fullEntryPath, sub.name);
        const stat = await fs.stat(subPath).catch(() => null);
        if (stat && now - stat.mtimeMs > 60_000) {
          await fs.unlink(subPath).catch(() => {});
          removedCount++;
        }
      }
    }
  }

  return removedCount;
}

const CANDIDATE_LIBREOFFICE_PATHS = [
  process.env.LIBREOFFICE_PATH,
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  'soffice',
].filter(Boolean) as string[];

async function findLibreOfficeExecutable(): Promise<string | null> {
  for (const candidate of CANDIDATE_LIBREOFFICE_PATHS) {
    if (candidate === 'soffice') {
      try {
        await execFileAsync('where.exe', ['soffice']);
        return 'soffice';
      } catch {
        continue;
      }
    } else {
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        continue;
      }
    }
  }
  return null;
}

export async function tryConvertOfficeViaLibreOffice(
  inputBuffer: Buffer,
  ext: string
): Promise<Buffer | null> {
  const soffice = await findLibreOfficeExecutable();
  if (!soffice) return null;

  const jobId = `${Date.now()}_${createShortHash()}`;
  const workDir = path.join(os.tmpdir(), `belediye_ingest_${jobId}`);
  const profileDir = path.join(os.tmpdir(), `lo_profile_${jobId}`);

  await fs.mkdir(workDir, { recursive: true });
  await fs.mkdir(profileDir, { recursive: true });

  const inputPath = path.join(workDir, `input${ext}`);
  const outputPath = path.join(workDir, 'input.pdf');

  try {
    await fs.writeFile(inputPath, inputBuffer);
    const profileUri = `file:///${profileDir.replace(/\\/g, '/')}`;

    await execFileAsync(
      soffice,
      [
        '--headless',
        '--nologo',
        '--nofirststartwizard',
        `-env:UserInstallation=${profileUri}`,
        '--convert-to',
        'pdf',
        '--outdir',
        workDir,
        inputPath,
      ],
      { timeout: 120_000 }
    );

    return await fs.readFile(outputPath);
  } catch (err) {
    console.warn('LibreOffice conversion failed, falling back to built-in renderer:', err);
    return null;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapTextLines(text: string, maxCharsPerLine: number): string[] {
  const result: string[] = [];
  const paragraphs = text.split(/\r?\n/);
  for (const para of paragraphs) {
    const trimmed = para.trimEnd();
    if (!trimmed) {
      result.push('');
      continue;
    }
    const words = trimmed.split(/\s+/);
    let current = '';
    for (const word of words) {
      if ((current + ' ' + word).trim().length <= maxCharsPerLine) {
        current = (current + ' ' + word).trim();
      } else {
        if (current) result.push(current);
        current = word;
      }
    }
    if (current) result.push(current);
  }
  return result;
}

export async function renderDocxFallbackToBuffers(
  inputBuffer: Buffer,
  fileName: string
): Promise<Buffer[]> {
  try {
    const rawResult = await mammoth.extractRawText({ buffer: inputBuffer });
    const text = rawResult.value?.trim() || `Belge İçeriği: ${fileName}`;
    const allLines = wrapTextLines(text, 78);
    const linesPerPage = 44;
    const totalPages = Math.max(1, Math.ceil(allLines.length / linesPerPage));
    const buffers: Buffer[] = [];

    for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
      const pageLines = allLines.slice(pageIdx * linesPerPage, (pageIdx + 1) * linesPerPage);
      const width = 1654;
      const height = 2339;

      const textElements = pageLines
        .map((line, i) => {
          const y = 260 + i * 42;
          return `<text x="140" y="${y}" font-family="Arial, sans-serif" font-size="24" fill="#1e293b">${escapeXml(
            line
          )}</text>`;
        })
        .join('\n');

      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <rect width="100%" height="100%" fill="#ffffff"/>
        <rect x="90" y="90" width="${width - 180}" height="${height - 180}" fill="none" stroke="#cbd5e1" stroke-width="2"/>
        <text x="140" y="165" font-family="Arial, sans-serif" font-size="28" font-weight="bold" fill="#0f172a">${escapeXml(
          fileName
        )}</text>
        <line x1="140" y1="195" x2="${width - 140}" y2="195" stroke="#94a3b8" stroke-width="2"/>
        ${textElements}
        <text x="${width - 140}" y="${height - 120}" text-anchor="end" font-family="Arial, sans-serif" font-size="20" fill="#64748b">Sayfa ${
          pageIdx + 1
        } / ${totalPages}</text>
      </svg>`;

      const png = await sharp(Buffer.from(svg)).png().toBuffer();
      buffers.push(png);
    }

    return buffers;
  } catch {
    throw new AppError(
      'CONVERSION_FAILED',
      'Word belgesi yüksek çözünürlüklü görsele dönüştürülemedi.',
      422
    );
  }
}

export async function renderSpreadsheetFallbackToBuffers(
  inputBuffer: Buffer,
  fileName: string
): Promise<Buffer[]> {
  try {
    const workbook = XLSX.read(inputBuffer, { type: 'buffer' });
    const buffers: Buffer[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' });
      const width = 1654;
      const height = 2339;
      const maxRows = Math.min(rows.length || 1, 38);
      const maxCols = Math.min(
        Math.max(1, ...rows.slice(0, maxRows).map((r) => (Array.isArray(r) ? r.length : 1))),
        8
      );

      const tableLeft = 120;
      const tableTop = 230;
      const tableWidth = width - 240;
      const colWidth = Math.floor(tableWidth / maxCols);
      const rowHeight = 46;

      let cellsSvg = '';
      for (let r = 0; r < maxRows; r++) {
        const row = rows[r] || [];
        const y = tableTop + r * rowHeight;
        const isHeader = r === 0;
        for (let c = 0; c < maxCols; c++) {
          const x = tableLeft + c * colWidth;
          const cellVal = String(row[c] ?? '').slice(0, 26);
          cellsSvg += `<rect x="${x}" y="${y}" width="${colWidth}" height="${rowHeight}" fill="${
            isHeader ? '#f1f5f9' : '#ffffff'
          }" stroke="#cbd5e1" stroke-width="1.5"/>`;
          cellsSvg += `<text x="${x + 12}" y="${y + 30}" font-family="Arial, sans-serif" font-size="20" font-weight="${
            isHeader ? 'bold' : 'normal'
          }" fill="#1e293b">${escapeXml(cellVal)}</text>`;
        }
      }

      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <rect width="100%" height="100%" fill="#ffffff"/>
        <text x="120" y="150" font-family="Arial, sans-serif" font-size="28" font-weight="bold" fill="#0f172a">${escapeXml(
          fileName
        )} — ${escapeXml(sheetName)}</text>
        <line x1="120" y1="180" x2="${width - 120}" y2="180" stroke="#94a3b8" stroke-width="2"/>
        ${cellsSvg}
      </svg>`;

      const png = await sharp(Buffer.from(svg)).png().toBuffer();
      buffers.push(png);
    }

    return buffers.length > 0
      ? buffers
      : [
          await sharp({
            create: { width: 1654, height: 2339, channels: 3, background: '#ffffff' },
          })
            .png()
            .toBuffer(),
        ];
  } catch {
    throw new AppError(
      'CONVERSION_FAILED',
      'Excel tablosu yüksek çözünürlüklü görsele dönüştürülemedi.',
      422
    );
  }
}

export type DetectedFileKind = 'pdf' | 'image' | 'word' | 'excel';

export function detectFileKind(buffer: Buffer, originalName: string): DetectedFileKind {
  const ext = path.extname(originalName).toLowerCase();

  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    return 'pdf';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image';
  }
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image';
  }

  const isZip =
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04;
  const isOle =
    buffer.length >= 4 &&
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0;

  if ((isZip || isOle) && (ext === '.doc' || ext === '.docx')) {
    return 'word';
  }
  if ((isZip || isOle) && (ext === '.xls' || ext === '.xlsx')) {
    return 'excel';
  }

  throw new AppError(
    'UNSUPPORTED_FORMAT',
    `Desteklenmeyen dosya formatı (${ext || 'bilinmeyen'}). Lütfen yalnızca PDF, Word (.doc/.docx), Excel (.xls/.xlsx), JPG veya PNG yükleyiniz.`,
    415
  );
}

export async function ingestDocumentToPageImages(
  folderId: string,
  fileBuffer: Buffer,
  originalName: string,
  createIdFn: () => string
): Promise<Array<{ pageId: string; processed: ProcessedPageImage }>> {
  const kind = detectFileKind(fileBuffer, originalName);
  const ext = path.extname(originalName).toLowerCase();
  const results: Array<{ pageId: string; processed: ProcessedPageImage }> = [];

  if (kind === 'image') {
    const pageId = createIdFn();
    const processed = await processAndSavePageImage(folderId, pageId, fileBuffer);
    results.push({ pageId, processed });
    return results;
  }

  if (kind === 'pdf') {
    await forEachPdfRenderedPage(fileBuffer, async (pngBuf) => {
      const pageId = createIdFn();
      const processed = await processAndSavePageImage(folderId, pageId, pngBuf);
      results.push({ pageId, processed });
    });
    return results;
  }

  if (kind === 'word' || kind === 'excel') {
    const pdfBuf = await tryConvertOfficeViaLibreOffice(fileBuffer, ext);
    if (pdfBuf) {
      await forEachPdfRenderedPage(pdfBuf, async (pngBuf) => {
        const pageId = createIdFn();
        const processed = await processAndSavePageImage(folderId, pageId, pngBuf);
        results.push({ pageId, processed });
      });
      return results;
    }

    const pageBuffers =
      kind === 'word'
        ? await renderDocxFallbackToBuffers(fileBuffer, originalName)
        : await renderSpreadsheetFallbackToBuffers(fileBuffer, originalName);

    for (const buf of pageBuffers) {
      const pageId = createIdFn();
      const processed = await processAndSavePageImage(folderId, pageId, buf);
      results.push({ pageId, processed });
    }
    return results;
  }

  throw new AppError('UNSUPPORTED_FORMAT', 'Desteklenmeyen dosya formatı.', 415);
}

// ============================================================================
// 5. KİMLİK DOĞRULAMA MIDDLEWARE VE YARDIMCILARI (AUTH HELPERS)
// ============================================================================

function getClientIp(req: Request): string {
  return (req.ip || req.socket?.remoteAddress || 'unknown').replace(/^::ffff:/, '');
}

interface RateBucket {
  hits: number[];
}

function createRateLimiter(options: {
  windowMs: number;
  max: number;
  message: string;
  skip?: (req: Request) => boolean;
}) {
  const buckets = new Map<string, RateBucket>();
  const cleanupTimer = setInterval(() => {
    const cutoff = Date.now() - options.windowMs;
    for (const [key, bucket] of buckets.entries()) {
      bucket.hits = bucket.hits.filter((t) => t > cutoff);
      if (bucket.hits.length === 0) buckets.delete(key);
    }
  }, 60_000);
  cleanupTimer.unref();

  return (req: Request, _res: Response, next: NextFunction) => {
    if (options.skip?.(req)) {
      next();
      return;
    }
    const now = Date.now();
    const cutoff = now - options.windowMs;
    const ip = getClientIp(req);
    const bucket = buckets.get(ip) || { hits: [] };
    bucket.hits = bucket.hits.filter((t) => t > cutoff);
    if (bucket.hits.length >= options.max) {
      next(new AppError('RATE_LIMITED', options.message, 429));
      return;
    }
    bucket.hits.push(now);
    buckets.set(ip, bucket);
    next();
  };
}

function createPinFailureTracker(maxFailures = 12, windowMs = 10 * 60 * 1000) {
  const failures = new Map<string, number[]>();
  const cleanupTimer = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [ip, list] of failures.entries()) {
      const fresh = list.filter((t) => t > cutoff);
      if (fresh.length === 0) failures.delete(ip);
      else failures.set(ip, fresh);
    }
  }, 60_000);
  cleanupTimer.unref();

  return {
    isBlocked(ip: string): boolean {
      const cutoff = Date.now() - windowMs;
      const list = (failures.get(ip) || []).filter((t) => t > cutoff);
      if (list.length === 0) {
        failures.delete(ip);
        return false;
      }
      failures.set(ip, list);
      return list.length >= maxFailures;
    },
    recordFailure(ip: string): boolean {
      const now = Date.now();
      const cutoff = now - windowMs;
      const list = (failures.get(ip) || []).filter((t) => t > cutoff);
      list.push(now);
      failures.set(ip, list);
      return list.length >= maxFailures;
    },
    reset(ip: string): void {
      failures.delete(ip);
    },
  };
}

const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Çok fazla kimlik doğrulama denemesi yapıldı. Lütfen 15 dakika sonra tekrar deneyin.',
});

const apiRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 360,
  message: 'Çok fazla istek gönderildi. Lütfen kısa bir süre sonra tekrar deneyin.',
  skip: (req) => req.path === '/health',
});

const pinFailureTracker = createPinFailureTracker(12, 10 * 60 * 1000);

function extractBearerToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth || typeof auth !== 'string') return null;
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

function resolveOptionalUser(req: Request, db: DatabaseSchema): UserItem | null {
  const token = extractBearerToken(req);
  if (!token) return null;
  const payload = verifyToken(token, getEffectiveJwtSecret(db.settings.jwtSecret));
  if (!payload) return null;
  return db.users.find((u) => u.id === payload.sub) ?? null;
}

async function requireAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction) {
  try {
    const db = await readDb();
    const user = resolveOptionalUser(req, db);
    if (!user) {
      throw new AppError(
        'UNAUTHORIZED',
        'Bu işlemi gerçekleştirmek için yönetici/kullanıcı girişi yapmalısınız.',
        401
      );
    }
    req.authUser = user;
    next();
  } catch (err) {
    next(err);
  }
}

function getProvidedPin(req: Request): string {
  const queryPin = typeof req.query.pin === 'string' ? req.query.pin : '';
  const headerPin = typeof req.headers['x-access-pin'] === 'string' ? req.headers['x-access-pin'] : '';
  return (queryPin || headerPin).trim();
}

function toPublicFolder(folder: FolderItem): FolderItem {
  const { sharePin: _pin, ...rest } = folder;
  return {
    ...rest,
    pages: [...folder.pages].sort((a, b) => a.orderIndex - b.orderIndex),
  };
}

function toPublicWorkspace(owner: UserItem) {
  return {
    id: owner.id,
    displayName: owner.displayName,
    workspaceTitle: owner.workspaceTitle,
    workspaceSubtitle: owner.workspaceSubtitle,
    workspaceSlug: owner.workspaceSlug,
    shareToken: owner.shareToken,
    hasPin: Boolean(owner.workspacePin),
  };
}

// ============================================================================
// 6. KİMLİK DOĞRULAMA & ÇALIŞMA ALANI ROTALARI (AUTH & WORKSPACE)
// ============================================================================

const authRouter = Router();

authRouter.get('/status', async (req, res, next) => {
  try {
    const db = await readDb();
    const user = resolveOptionalUser(req, db);
    res.json({
      needsInitialSetup: db.users.length === 0,
      allowPublicRegistration: db.settings.allowPublicRegistration,
      googleClientId: getEffectiveGoogleClientId(db.settings.googleClientId),
      user: user ? sanitizeUser(user) : null,
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/setup', authRateLimiter, async (req, res, next) => {
  try {
    const schema = z.object({
      username: z
        .string()
        .trim()
        .min(3, 'Kullanıcı adı en az 3 karakter olmalıdır.')
        .max(60, 'Kullanıcı adı en fazla 60 karakter olabilir.'),
      password: z
        .string()
        .min(4, 'Şifre en az 4 karakter olmalıdır.')
        .max(100, 'Şifre en fazla 100 karakter olabilir.'),
      displayName: z
        .string()
        .trim()
        .min(2, 'Kurum veya Ad Soyad en az 2 karakter olmalıdır.')
        .max(100),
      workspaceTitle: z.string().trim().min(2).max(120).optional(),
      workspaceSubtitle: z.string().trim().max(240).optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message || 'Geçersiz kurulum bilgileri.',
        400
      );
    }

    const result = await mutateDb((db) => {
      if (db.users.length > 0) {
        throw new AppError(
          'FORBIDDEN',
          'İlk kurulum daha önce tamamlanmış. Lütfen giriş yapın.',
          403
        );
      }

      const now = new Date().toISOString();
      const userId = createUserId();
      const normalizedUsername = parsed.data.username.toLowerCase();
      const slug = generateUniqueWorkspaceSlug(parsed.data.displayName, db.users);

      const newUser: UserItem = {
        id: userId,
        username: normalizedUsername,
        displayName: parsed.data.displayName,
        workspaceTitle: parsed.data.workspaceTitle || 'Resmi Başvuru Dosyası Rehberleri',
        workspaceSubtitle:
          parsed.data.workspaceSubtitle ||
          'Başvuru öncesinde fiziksel dosya dizilimini ve kritik uyarıları inceleyin.',
        workspaceSlug: slug,
        shareToken: createWorkspaceShareToken(),
        passwordHash: hashPassword(parsed.data.password),
        authProvider: 'local',
        role: 'superadmin',
        createdAt: now,
      };

      db.users.push(newUser);

      // Mevcut sahipsiz tüm dosyaları bu ilk yöneticiye bağla
      for (const folder of db.folders) {
        if (!folder.ownerId) {
          folder.ownerId = userId;
        }
      }

      const token = signToken(newUser, getEffectiveJwtSecret(db.settings.jwtSecret));
      return { token, user: sanitizeUser(newUser) };
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

authRouter.post('/login', authRateLimiter, async (req, res, next) => {
  try {
    const schema = z.object({
      username: z.string().trim().min(1, 'Kullanıcı adı veya e-posta giriniz.'),
      password: z.string().min(1, 'Şifrenizi giriniz.'),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message || 'Kullanıcı adı ve şifre gereklidir.',
        400
      );
    }

    const db = await readDb();
    const identifier = parsed.data.username.toLowerCase();
    const user = db.users.find(
      (u) =>
        u.username.toLowerCase() === identifier ||
        (u.email && u.email.toLowerCase() === identifier)
    );

    if (!user || !user.passwordHash || !verifyPassword(parsed.data.password, user.passwordHash)) {
      throw new AppError('UNAUTHORIZED', 'Kullanıcı adı veya şifre hatalı.', 401);
    }

    const token = signToken(user, getEffectiveJwtSecret(db.settings.jwtSecret));
    res.json({ token, user: sanitizeUser(user) });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/register', authRateLimiter, async (req, res, next) => {
  try {
    const schema = z.object({
      username: z
        .string()
        .trim()
        .min(3, 'Kullanıcı adı en az 3 karakter olmalıdır.')
        .max(60),
      password: z
        .string()
        .min(4, 'Şifre en az 4 karakter olmalıdır.')
        .max(100),
      displayName: z
        .string()
        .trim()
        .min(2, 'Kurum veya Ad Soyad en az 2 karakter olmalıdır.')
        .max(100),
      email: z.string().trim().email('Geçerli bir e-posta adresi giriniz.').optional().or(z.literal('')),
      workspaceTitle: z.string().trim().min(2).max(120).optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message || 'Geçersiz kayıt bilgileri.',
        400
      );
    }

    const result = await mutateDb((db) => {
      if (db.users.length > 0 && !db.settings.allowPublicRegistration) {
        throw new AppError(
          'FORBIDDEN',
          'Yeni kullanıcı kayıtları sistem yöneticisi tarafından kapatılmıştır.',
          403
        );
      }

      const normalizedUsername = parsed.data.username.toLowerCase();
      const normalizedEmail = parsed.data.email ? parsed.data.email.toLowerCase() : undefined;

      const exists = db.users.some(
        (u) =>
          u.username.toLowerCase() === normalizedUsername ||
          (normalizedEmail && u.email && u.email.toLowerCase() === normalizedEmail)
      );
      if (exists) {
        throw new AppError(
          'CONFLICT',
          'Bu kullanıcı adı veya e-posta adresi zaten kayıtlı.',
          409
        );
      }

      const isFirst = db.users.length === 0;
      const userId = createUserId();
      const newUser: UserItem = {
        id: userId,
        username: normalizedUsername,
        email: normalizedEmail,
        displayName: parsed.data.displayName,
        workspaceTitle:
          parsed.data.workspaceTitle || `${parsed.data.displayName} — Dosya Rehberleri`,
        workspaceSubtitle:
          'Başvuru öncesinde fiziksel dosya dizilimini ve kritik uyarıları inceleyin.',
        workspaceSlug: generateUniqueWorkspaceSlug(parsed.data.displayName, db.users),
        shareToken: createWorkspaceShareToken(),
        passwordHash: hashPassword(parsed.data.password),
        authProvider: 'local',
        role: isFirst ? 'superadmin' : 'user',
        createdAt: new Date().toISOString(),
      };

      db.users.push(newUser);
      if (isFirst) {
        for (const f of db.folders) {
          if (!f.ownerId) f.ownerId = userId;
        }
      }

      const token = signToken(newUser, getEffectiveJwtSecret(db.settings.jwtSecret));
      return { token, user: sanitizeUser(newUser) };
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

async function resolveGoogleCredentialPayload(
  credential: string,
  expectedClientId?: string
): Promise<{ email: string; name: string; sub: string; picture?: string }> {
  const parts = credential.split('.');
  if (parts.length !== 3) {
    throw new AppError('VALIDATION_ERROR', 'Geçersiz Google kimlik doğrulama jetonu.', 400);
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`,
      { signal: controller.signal }
    );
    clearTimeout(timer);

    if (!resp.ok) {
      throw new AppError('UNAUTHORIZED', 'Google kimlik jetonu doğrulanamadı.', 401);
    }

    const info = (await resp.json()) as Record<string, any>;
    if (expectedClientId && info.aud && info.aud !== expectedClientId) {
      throw new AppError('UNAUTHORIZED', 'Google Client ID eşleşmedi.', 401);
    }
    if (!info.email || !info.sub) {
      throw new AppError('VALIDATION_ERROR', 'Google hesabından kimlik bilgisi alınamadı.', 400);
    }
    if (info.email_verified === false || info.email_verified === 'false') {
      throw new AppError('UNAUTHORIZED', 'Doğrulanmamış Google e-posta adresi reddedildi.', 401);
    }

    return {
      email: String(info.email),
      name: String(info.name || String(info.email).split('@')[0]),
      sub: String(info.sub),
      picture:
        typeof info.picture === 'string' && info.picture.startsWith('https://')
          ? info.picture
          : undefined,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('UNAUTHORIZED', 'Google sunucusuna bağlanılamadı.', 401);
  }
}

async function resolveGoogleAccessTokenProfile(
  accessToken: string,
  expectedClientId?: string
): Promise<{ email: string; name: string; sub: string; picture?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    const [tokenInfoResp, userInfoResp] = await Promise.all([
      fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`, {
        signal: controller.signal,
      }),
      fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      }),
    ]);
    clearTimeout(timer);

    if (!tokenInfoResp.ok || !userInfoResp.ok) {
      throw new AppError('UNAUTHORIZED', 'Google erişim izni doğrulanamadı.', 401);
    }

    const tokenInfo = (await tokenInfoResp.json()) as Record<string, any>;
    if (expectedClientId) {
      const audMatch = tokenInfo?.aud === expectedClientId || tokenInfo?.azp === expectedClientId;
      if (!audMatch) {
        throw new AppError('UNAUTHORIZED', 'Google erişim jetonu bu uygulama için verilmemiş.', 401);
      }
    }

    const info = (await userInfoResp.json()) as Record<string, any>;
    if (!info?.email || !info?.sub) {
      throw new AppError('VALIDATION_ERROR', 'Google hesabından kimlik bilgisi alınamadı.', 400);
    }
    if (info.email_verified === false || info.email_verified === 'false') {
      throw new AppError('UNAUTHORIZED', 'Doğrulanmamış Google e-posta adresi reddedildi.', 401);
    }

    return {
      email: String(info.email),
      name: String(info.name || info.given_name || String(info.email).split('@')[0]),
      sub: String(info.sub),
      picture:
        typeof info.picture === 'string' && info.picture.startsWith('https://')
          ? info.picture
          : undefined,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('UNAUTHORIZED', 'Google sunucusuna bağlanılamadı.', 401);
  }
}

authRouter.post('/google/config', authRateLimiter, async (req, res, next) => {
  try {
    const schema = z.object({
      googleClientId: z
        .string()
        .trim()
        .min(10, 'Geçerli bir Google OAuth Client ID giriniz.')
        .max(2000),
    });

    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message || 'Geçersiz Google Client ID formatı.',
        400
      );
    }

    const cleanId = extractCleanGoogleClientId(parsed.data.googleClientId);
    if (!cleanId) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Geçerli bir Google Client ID (xxxx.apps.googleusercontent.com) bulunamadı.',
        400
      );
    }

    const caller = await (async () => {
      const db = await readDb();
      return resolveOptionalUser(req, db);
    })();

    const result = await mutateDb((db) => {
      if (getEffectiveGoogleClientId(db.settings.googleClientId) && (!caller || caller.role !== 'superadmin')) {
        throw new AppError(
          'FORBIDDEN',
          'Google Client ID yalnızca sistem yöneticisi tarafından değiştirilebilir.',
          403
        );
      }
      db.settings.googleClientId = cleanId;
      return { googleClientId: getEffectiveGoogleClientId(db.settings.googleClientId) };
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

authRouter.post('/google', authRateLimiter, async (req, res, next) => {
  try {
    const schema = z.object({
      credential: z.string().min(10).optional(),
      accessToken: z.string().min(10).optional(),
    });

    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message || 'Geçersiz Google kimlik doğrulama verisi.',
        400
      );
    }

    const dbSnap = await readDb();
    const expectedGoogleClientId = getEffectiveGoogleClientId(dbSnap.settings.googleClientId) || undefined;
    let profile: { email: string; name: string; sub: string; picture?: string };

    if (parsed.data.credential) {
      profile = await resolveGoogleCredentialPayload(
        parsed.data.credential,
        expectedGoogleClientId
      );
    } else if (parsed.data.accessToken) {
      profile = await resolveGoogleAccessTokenProfile(
        parsed.data.accessToken,
        expectedGoogleClientId
      );
    } else {
      throw new AppError(
        'VALIDATION_ERROR',
        'Gerçek Google kimlik doğrulama jetonu (accessToken veya credential) gereklidir.',
        400
      );
    }

    const result = await mutateDb((db) => {
      const normalizedEmail = profile.email.toLowerCase();
      let user = db.users.find(
        (u) =>
          (u.googleSub && u.googleSub === profile.sub) ||
          (u.email && u.email.toLowerCase() === normalizedEmail)
      );

      if (!user) {
        if (db.users.length > 0 && !db.settings.allowPublicRegistration) {
          throw new AppError(
            'FORBIDDEN',
            'Yeni kullanıcı kayıtları sistem yöneticisi tarafından kapatılmıştır.',
            403
          );
        }

        const isFirst = db.users.length === 0;
        const userId = createUserId();
        const emailPrefix = normalizedEmail.split('@')[0] || profile.name;
        user = {
          id: userId,
          username: generateUniqueUsername(emailPrefix, db.users),
          email: normalizedEmail,
          displayName: profile.name,
          workspaceTitle: `${profile.name} — 3D Dosya Rehberleri`,
          workspaceSubtitle:
            'Başvuru öncesinde fiziksel dosya dizilimini ve kritik uyarıları inceleyin.',
          workspaceSlug: generateUniqueWorkspaceSlug(profile.name, db.users),
          shareToken: createWorkspaceShareToken(),
          authProvider: 'google',
          googleSub: profile.sub,
          avatarUrl: profile.picture,
          role: isFirst ? 'superadmin' : 'user',
          createdAt: new Date().toISOString(),
        };
        db.users.push(user);

        if (isFirst) {
          for (const f of db.folders) {
            if (!f.ownerId) f.ownerId = userId;
          }
        }
      } else {
        user.googleSub = user.googleSub || profile.sub;
        user.email = user.email || normalizedEmail;
        if (profile.picture) user.avatarUrl = profile.picture;
      }

      const token = signToken(user, getEffectiveJwtSecret(db.settings.jwtSecret));
      return { token, user: sanitizeUser(user) };
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

const workspaceRouter = Router();

workspaceRouter.patch('/settings', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const schema = z.object({
      username: z
        .string()
        .trim()
        .min(3, 'Kullanıcı adı en az 3 karakter olmalıdır.')
        .max(60, 'Kullanıcı adı en fazla 60 karakter olabilir.')
        .optional(),
      displayName: z.string().trim().min(2, 'Kurum / Kullanıcı adı en az 2 karakter olmalıdır.').max(100).optional(),
      workspaceTitle: z.string().trim().min(2, 'Vitrin başlığı en az 2 karakter olmalıdır.').max(120).optional(),
      workspaceSubtitle: z.string().trim().max(240).optional(),
      workspaceSlug: z.string().trim().min(2).max(60).optional(),
      workspacePin: z.string().trim().max(24).optional(),
      newPassword: z.string().min(4, 'Yeni şifre en az 4 karakter olmalıdır.').max(100).optional().or(z.literal('')),
      googleClientId: z.string().trim().max(200).optional(),
      allowPublicRegistration: z.boolean().optional(),
    });

    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message || 'Geçersiz ayar verisi.',
        400
      );
    }

    const authUserId = req.authUser!.id;
    const result = await mutateDb((db) => {
      const user = db.users.find((u) => u.id === authUserId);
      if (!user) {
        throw new AppError('NOT_FOUND', 'Kullanıcı bulunamadı.', 404);
      }

      if (parsed.data.username !== undefined) {
        const cleanUsername = parsed.data.username.toLowerCase().replace(/\s+/g, '');
        if (cleanUsername.length < 3) {
          throw new AppError('VALIDATION_ERROR', 'Kullanıcı adı en az 3 karakter olmalıdır.', 400);
        }
        const usernameCollision = db.users.some(
          (u) => u.id !== user.id && u.username.toLowerCase() === cleanUsername
        );
        if (usernameCollision) {
          throw new AppError('CONFLICT', 'Bu kullanıcı adı başka bir hesap tarafından kullanılıyor.', 409);
        }
        user.username = cleanUsername;
      }

      if (parsed.data.displayName !== undefined) {
        user.displayName = parsed.data.displayName;
      }
      if (parsed.data.workspaceTitle !== undefined) {
        user.workspaceTitle = parsed.data.workspaceTitle;
      }
      if (parsed.data.workspaceSubtitle !== undefined) {
        user.workspaceSubtitle = parsed.data.workspaceSubtitle;
      }
      if (parsed.data.workspaceSlug !== undefined) {
        const cleanSlug = slugifyText(parsed.data.workspaceSlug, '');
        if (!cleanSlug || cleanSlug.length < 2) {
          throw new AppError('VALIDATION_ERROR', 'Geçerli bir kısa link adı giriniz.', 400);
        }
        const collision = db.users.some(
          (u) => u.id !== user.id && u.workspaceSlug.toLowerCase() === cleanSlug.toLowerCase()
        );
        if (collision) {
          throw new AppError('CONFLICT', 'Bu kısa link adresi başka bir kullanıcı tarafından kullanılıyor.', 409);
        }
        user.workspaceSlug = cleanSlug;
      }
      if (parsed.data.workspacePin !== undefined) {
        user.workspacePin = parsed.data.workspacePin || undefined;
      }
      if (parsed.data.newPassword) {
        user.passwordHash = hashPassword(parsed.data.newPassword);
      }

      if (user.role === 'superadmin') {
        if (parsed.data.googleClientId !== undefined) {
          db.settings.googleClientId =
            extractCleanGoogleClientId(parsed.data.googleClientId) || '';
        }
        if (parsed.data.allowPublicRegistration !== undefined) {
          db.settings.allowPublicRegistration = parsed.data.allowPublicRegistration;
        }
      }

      return {
        user: sanitizeUser(user),
        googleClientId: getEffectiveGoogleClientId(db.settings.googleClientId),
        allowPublicRegistration: db.settings.allowPublicRegistration,
      };
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// 7. HALKA AÇIK PAYLAŞIM ROTALARI (PUBLIC WORKSPACE & FOLDER ROUTES)
// ============================================================================

const publicRouter = Router();

const pendingViewIncrements = new Map<string, number>();
let viewFlushTimer: ReturnType<typeof setTimeout> | null = null;

function flushPendingViewIncrements(): void {
  if (pendingViewIncrements.size === 0) return;
  const snapshot = new Map(pendingViewIncrements);
  pendingViewIncrements.clear();
  void mutateDb((mDb) => {
    for (const [folderId, delta] of snapshot.entries()) {
      const target = mDb.folders.find((f) => f.id === folderId);
      if (target) {
        target.viewCount = (target.viewCount || 0) + delta;
      }
    }
  }).catch(() => {});
}

function schedulePublicViewIncrement(folderId: string): number {
  const nextPending = (pendingViewIncrements.get(folderId) || 0) + 1;
  pendingViewIncrements.set(folderId, nextPending);
  if (!viewFlushTimer) {
    viewFlushTimer = setTimeout(() => {
      viewFlushTimer = null;
      flushPendingViewIncrements();
    }, 10_000);
    viewFlushTimer.unref();
  }
  return nextPending;
}

publicRouter.get('/workspace/:identifier', async (req, res, next) => {
  try {
    const identifier = String(req.params.identifier || '').trim().toLowerCase();
    const db = await readDb();

    // Dahili kullanıcı kimliği (usr_...) üzerinden numaralandırmayı önlemek için yalnızca workspaceSlug veya shareToken eşleştirilir
    const owner = db.users.find(
      (u) =>
        u.workspaceSlug.toLowerCase() === identifier ||
        u.shareToken.toLowerCase() === identifier
    );

    if (!owner) {
      throw new AppError('NOT_FOUND', 'Aranan paylaşım masaüstü bulunamadı.', 404);
    }

    const ip = getClientIp(req);
    const providedPin = getProvidedPin(req);
    const currentUser = resolveOptionalUser(req, db);
    const isOwner = currentUser?.id === owner.id;

    if (owner.workspacePin && !isOwner) {
      if (pinFailureTracker.isBlocked(ip)) {
        throw new AppError(
          'RATE_LIMITED',
          'Çok fazla hatalı erişim şifresi denemesi yapıldı. Lütfen 10 dakika sonra tekrar deneyin.',
          429
        );
      }
      if (!providedPin || !safeCompareString(providedPin, owner.workspacePin)) {
        if (providedPin) {
          const blocked = pinFailureTracker.recordFailure(ip);
          if (blocked) {
            throw new AppError(
              'RATE_LIMITED',
              'Çok fazla hatalı erişim şifresi denemesi yapıldı. Lütfen 10 dakika sonra tekrar deneyin.',
              429
            );
          }
        }
        res.json({
          requiresPin: true,
          workspace: toPublicWorkspace(owner),
          folders: [],
        });
        return;
      }
      pinFailureTracker.reset(ip);
    }

    const folders = db.folders
      .filter((f) => f.ownerId === owner.id && f.isPublished !== false)
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map(toPublicFolder);

    res.json({
      requiresPin: false,
      workspace: toPublicWorkspace(owner),
      folders,
    });
  } catch (err) {
    next(err);
  }
});

publicRouter.get('/folder/:identifier', async (req, res, next) => {
  try {
    const identifier = String(req.params.identifier || '').trim();
    const workspaceFilter =
      typeof req.query.workspace === 'string' ? req.query.workspace.trim().toLowerCase() : '';
    const db = await readDb();

    // f.id ile doğrudan aramayı engelle; f.id yalnızca ?workspace= parametresi ile eşleşen sahip alanı doğrulandığında kabul edilir
    const folder = db.folders.find((f) => {
      if (f.shareToken === identifier) return true;
      if (workspaceFilter && f.id === identifier) {
        const fOwner = db.users.find((u) => u.id === f.ownerId);
        return Boolean(
          fOwner &&
            (fOwner.workspaceSlug.toLowerCase() === workspaceFilter ||
              fOwner.shareToken.toLowerCase() === workspaceFilter)
        );
      }
      return false;
    });
    if (!folder) {
      throw new AppError('NOT_FOUND', 'Aranan başvuru dosyası bulunamadı.', 404);
    }

    const owner = db.users.find((u) => u.id === folder.ownerId) || null;
    if (workspaceFilter) {
      const ownerMatches =
        owner &&
        (owner.workspaceSlug.toLowerCase() === workspaceFilter ||
          owner.shareToken.toLowerCase() === workspaceFilter);
      if (!ownerMatches) {
        throw new AppError('NOT_FOUND', 'Bu çalışma alanında aranan dosya bulunamadı.', 404);
      }
    }

    const currentUser = resolveOptionalUser(req, db);
    const isOwner = Boolean(currentUser && (currentUser.id === folder.ownerId || !folder.ownerId));

    if (!folder.isPublished && !isOwner) {
      throw new AppError(
        'FORBIDDEN',
        'Bu dosya şu anda Taslak durumundadır ve dış paylaşıma kapalıdır.',
        403
      );
    }

    const ip = getClientIp(req);
    const requiredPin = folder.sharePin || owner?.workspacePin || '';
    const providedPin = getProvidedPin(req);
    if (requiredPin && !isOwner) {
      if (pinFailureTracker.isBlocked(ip)) {
        throw new AppError(
          'RATE_LIMITED',
          'Çok fazla hatalı erişim şifresi denemesi yapıldı. Lütfen 10 dakika sonra tekrar deneyin.',
          429
        );
      }
      if (!providedPin || !safeCompareString(providedPin, requiredPin)) {
        if (providedPin) {
          const blocked = pinFailureTracker.recordFailure(ip);
          if (blocked) {
            throw new AppError(
              'RATE_LIMITED',
              'Çok fazla hatalı erişim şifresi denemesi yapıldı. Lütfen 10 dakika sonra tekrar deneyin.',
              429
            );
          }
        }
        res.json({
          requiresPin: true,
          title: folder.title,
          workspace: owner ? toPublicWorkspace(owner) : null,
        });
        return;
      }
      pinFailureTracker.reset(ip);
    }

    // Görüntülenme sayacını disk DoS'unu önlemek için bellekte biriktirip periyodik yaz
    const pendingDelta = !isOwner ? schedulePublicViewIncrement(folder.id) : (pendingViewIncrements.get(folder.id) || 0);
    const folderForResponse: FolderItem = {
      ...folder,
      viewCount: (folder.viewCount || 0) + pendingDelta,
    };

    res.json({
      requiresPin: false,
      folder: toPublicFolder(folderForResponse),
      workspace: owner ? toPublicWorkspace(owner) : null,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// 8. KLASÖR VE SAYFA YÖNETİM ROTALARI (FOLDERS & PAGES ROUTERS)
// ============================================================================

const foldersRouter = Router();

function generateUniqueDefaultTitle(existingTitles: string[], base = 'Yeni Dosya'): string {
  const normalized = new Set(existingTitles.map((t) => t.trim().toLowerCase()));
  if (!normalized.has(base.toLowerCase())) return base;
  let counter = 2;
  while (normalized.has(`${base.toLowerCase()} (${counter})`)) {
    counter++;
  }
  return `${base} (${counter})`;
}

foldersRouter.get('/', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const db = await readDb();
    const authUser = req.authUser!;
    const mine = db.folders
      .filter((f) => f.ownerId === authUser.id)
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((f) => ({
        ...f,
        pages: [...f.pages].sort((a, b) => a.orderIndex - b.orderIndex),
      }));
    res.json({
      folders: mine,
      workspace: toPublicWorkspace(authUser),
    });
  } catch (err) {
    next(err);
  }
});

foldersRouter.put('/reorder', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const schema = z.object({ folderIds: z.array(z.string().min(1)) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Geçersiz klasör sıralama verisi.', 400);
    }

    const ownerId = req.authUser!.id;
    const updatedMine = await mutateDb((db) => {
      const idOrder = parsed.data.folderIds;
      const myFolders = db.folders.filter((f) => f.ownerId === ownerId);
      const otherFolders = db.folders.filter((f) => f.ownerId !== ownerId);

      const folderMap = new Map(myFolders.map((f) => [f.id, f]));
      const reordered: FolderItem[] = [];

      for (const id of idOrder) {
        const item = folderMap.get(id);
        if (item) {
          reordered.push(item);
          folderMap.delete(id);
        }
      }
      for (const remaining of folderMap.values()) {
        reordered.push(remaining);
      }

      reordered.forEach((f, idx) => {
        f.orderIndex = idx;
      });
      db.folders = [...reordered, ...otherFolders];
      return reordered;
    });

    res.json({ folders: updatedMine });
  } catch (err) {
    next(err);
  }
});

foldersRouter.get('/:folderId', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const db = await readDb();
    const authUser = req.authUser!;
    const folder = db.folders.find(
      (f) => f.id === req.params.folderId || f.shareToken === req.params.folderId
    );
    if (!folder) {
      throw new AppError('NOT_FOUND', 'Aranan başvuru dosyası bulunamadı.', 404);
    }

    if (folder.ownerId !== authUser.id) {
      throw new AppError('FORBIDDEN', 'Bu dosyayı görüntüleme yetkiniz yok.', 403);
    }

    res.json({
      requiresPin: false,
      folder: {
        ...folder,
        pages: [...folder.pages].sort((a, b) => a.orderIndex - b.orderIndex),
      },
      workspace: toPublicWorkspace(authUser),
    });
  } catch (err) {
    next(err);
  }
});

foldersRouter.post('/', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const schema = z.object({
      title: z.string().trim().min(1).max(80).optional(),
      description: z.string().trim().max(300).optional(),
      category: z.string().trim().max(60).optional(),
    });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Geçersiz dosya başlığı.', 400);
    }

    const ownerId = req.authUser!.id;
    const newFolder = await mutateDb((db) => {
      const now = new Date().toISOString();
      const myFolders = db.folders.filter((f) => f.ownerId === ownerId);
      const title =
        parsed.data.title || generateUniqueDefaultTitle(myFolders.map((f) => f.title));

      const folder: FolderItem = {
        id: createFolderId(),
        ownerId,
        title,
        description: parsed.data.description,
        category: parsed.data.category,
        isPublished: true,
        shareToken: createFolderShareToken(),
        viewCount: 0,
        orderIndex: myFolders.length,
        createdAt: now,
        updatedAt: now,
        pages: [],
      };
      db.folders.push(folder);
      return folder;
    });

    res.status(201).json({ folder: newFolder });
  } catch (err) {
    next(err);
  }
});

foldersRouter.patch('/:folderId', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const schema = z.object({
      title: z
        .string()
        .trim()
        .min(1, 'Dosya adı boş olamaz')
        .max(80, 'Dosya adı en fazla 80 karakter olabilir')
        .optional(),
      description: z.string().trim().max(300).optional(),
      category: z.string().trim().max(60).optional(),
      isPublished: z.boolean().optional(),
      sharePin: z.string().trim().max(24).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message || 'Geçersiz dosya güncelleme verisi.',
        400
      );
    }

    const ownerId = req.authUser!.id;
    const updatedFolder = await mutateDb((db) => {
      const folder = db.folders.find((f) => f.id === req.params.folderId);
      if (!folder) {
        throw new AppError('NOT_FOUND', 'Güncellenecek dosya bulunamadı.', 404);
      }
      if (folder.ownerId !== ownerId) {
        throw new AppError('FORBIDDEN', 'Bu dosya üzerinde düzenleme yetkiniz yok.', 403);
      }

      if (parsed.data.title !== undefined) folder.title = parsed.data.title;
      if (parsed.data.description !== undefined) folder.description = parsed.data.description;
      if (parsed.data.category !== undefined) folder.category = parsed.data.category;
      if (parsed.data.isPublished !== undefined) folder.isPublished = parsed.data.isPublished;
      if (parsed.data.sharePin !== undefined) {
        folder.sharePin = parsed.data.sharePin || undefined;
      }

      folder.updatedAt = new Date().toISOString();
      return folder;
    });

    res.json({ folder: updatedFolder });
  } catch (err) {
    next(err);
  }
});

foldersRouter.delete('/:folderId', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const folderId = assertSafePathSegment(req.params.folderId, 'klasör kimliği');
    const ownerId = req.authUser!.id;

    await mutateDb((db) => {
      const idx = db.folders.findIndex((f) => f.id === folderId);
      if (idx === -1) {
        throw new AppError('NOT_FOUND', 'Silinecek dosya bulunamadı.', 404);
      }
      if (db.folders[idx].ownerId !== ownerId) {
        throw new AppError('FORBIDDEN', 'Bu dosyayı silme yetkiniz yok.', 403);
      }
      db.folders.splice(idx, 1);
      db.folders
        .filter((f) => f.ownerId === ownerId)
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .forEach((f, i) => {
          f.orderIndex = i;
        });
    });

    const folderMediaPath = resolveSafeMediaPath(FOLDERS_MEDIA_DIR, folderId);
    await fs.rm(folderMediaPath, { recursive: true, force: true }).catch(() => {});

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

const pagesRouter = Router({ mergeParams: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 20,
  },
});

function decodeMulterFileName(name: string): string {
  try {
    return Buffer.from(name, 'latin1').toString('utf8');
  } catch {
    return name;
  }
}

pagesRouter.post('/', requireAuth, upload.array('files', 20), async (req: AuthenticatedRequest, res, next) => {
  try {
    const { folderId: rawFolderId } = req.params as Record<string, string>;
    const folderId = assertSafePathSegment(rawFolderId, 'klasör kimliği');
    const ownerId = req.authUser!.id;
    const files = (req.files as Express.Multer.File[]) || [];
    if (files.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'Lütfen yüklenecek en az bir evrak seçiniz.', 400);
    }

    const dbCheck = await readDb();
    const targetFolder = dbCheck.folders.find((f) => f.id === folderId);
    if (!targetFolder) {
      throw new AppError('NOT_FOUND', 'Evrak eklenecek klasör bulunamadı.', 404);
    }
    if (targetFolder.ownerId !== ownerId) {
      throw new AppError('FORBIDDEN', 'Bu klasöre evrak ekleme yetkiniz yok.', 403);
    }

    const rawInsertAt = req.body?.insertAtIndex;
    const parsedInsertAt =
      rawInsertAt !== undefined && rawInsertAt !== '' ? Number(rawInsertAt) : undefined;

    const createdPageItems: PageItem[] = [];
    const now = new Date().toISOString();

    for (const file of files) {
      const originalName = decodeMulterFileName(file.originalname);
      const ingested = await ingestDocumentToPageImages(
        folderId,
        file.buffer,
        originalName,
        createPageId
      );

      for (const item of ingested) {
        createdPageItems.push({
          id: item.pageId,
          orderIndex: 0,
          imageUrl: item.processed.imageUrl,
          thumbnailUrl: item.processed.thumbnailUrl,
          naturalWidth: item.processed.naturalWidth,
          naturalHeight: item.processed.naturalHeight,
          paperSize: 'A4',
          sourceFileName: originalName,
          hotspots: [],
          createdAt: now,
        });
      }
    }

    const updatedFolder = await mutateDb((db) => {
      const folder = db.folders.find((f) => f.id === folderId);
      if (!folder) {
        throw new AppError('NOT_FOUND', 'Evrak eklenecek klasör bulunamadı.', 404);
      }
      if (folder.ownerId !== ownerId) {
        throw new AppError('FORBIDDEN', 'Bu klasöre evrak ekleme yetkiniz yok.', 403);
      }

      folder.pages.sort((a, b) => a.orderIndex - b.orderIndex);
      const insertIndex =
        parsedInsertAt !== undefined && !Number.isNaN(parsedInsertAt)
          ? Math.max(0, Math.min(folder.pages.length, parsedInsertAt))
          : folder.pages.length;

      folder.pages.splice(insertIndex, 0, ...createdPageItems);
      folder.pages.forEach((p, idx) => {
        p.orderIndex = idx;
      });
      folder.updatedAt = new Date().toISOString();
      return folder;
    });

    res.status(201).json({
      folder: updatedFolder,
      addedPages: createdPageItems,
    });
  } catch (err) {
    next(err);
  }
});

pagesRouter.put('/reorder', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { folderId } = req.params as Record<string, string>;
    const ownerId = req.authUser!.id;
    const schema = z.object({ pageIds: z.array(z.string().min(1)) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Geçersiz sayfa sıralama verisi.', 400);
    }

    const updatedFolder = await mutateDb((db) => {
      const folder = db.folders.find((f) => f.id === folderId);
      if (!folder) {
        throw new AppError('NOT_FOUND', 'Klasör bulunamadı.', 404);
      }
      if (folder.ownerId !== ownerId) {
        throw new AppError('FORBIDDEN', 'Bu klasörü düzenleme yetkiniz yok.', 403);
      }

      const pageMap = new Map(folder.pages.map((p) => [p.id, p]));
      const reordered: PageItem[] = [];

      for (const id of parsed.data.pageIds) {
        const p = pageMap.get(id);
        if (p) {
          reordered.push(p);
          pageMap.delete(id);
        }
      }
      for (const rem of pageMap.values()) {
        reordered.push(rem);
      }

      reordered.forEach((p, idx) => {
        p.orderIndex = idx;
      });
      folder.pages = reordered;
      folder.updatedAt = new Date().toISOString();
      return folder;
    });

    res.json({ folder: updatedFolder });
  } catch (err) {
    next(err);
  }
});

pagesRouter.post('/:pageId/replace', requireAuth, upload.single('file'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const { folderId, pageId } = req.params as Record<string, string>;
    const ownerId = req.authUser!.id;
    const file = req.file;
    if (!file) {
      throw new AppError('VALIDATION_ERROR', 'Lütfen değiştirilecek yeni belgeyi seçiniz.', 400);
    }

    const dbCheck = await readDb();
    const checkFolder = dbCheck.folders.find((f) => f.id === folderId);
    if (!checkFolder) {
      throw new AppError('NOT_FOUND', 'Klasör bulunamadı.', 404);
    }
    if (checkFolder.ownerId !== ownerId) {
      throw new AppError('FORBIDDEN', 'Bu klasörü düzenleme yetkiniz yok.', 403);
    }
    const existingPage = checkFolder.pages.find((p) => p.id === pageId);
    if (!existingPage) {
      throw new AppError('NOT_FOUND', 'Değiştirilecek sayfa bulunamadı.', 404);
    }

    const originalName = decodeMulterFileName(file.originalname);
    let isFirst = true;
    const ingested = await ingestDocumentToPageImages(
      folderId,
      file.buffer,
      originalName,
      () => {
        if (isFirst) {
          isFirst = false;
          return pageId;
        }
        return createPageId();
      }
    );

    const oldMedia = {
      imageUrl: existingPage.imageUrl,
      thumbnailUrl: existingPage.thumbnailUrl,
    };

    const updatedFolder = await mutateDb((db) => {
      const folder = db.folders.find((f) => f.id === folderId);
      if (!folder) {
        throw new AppError('NOT_FOUND', 'Klasör bulunamadı.', 404);
      }
      folder.pages.sort((a, b) => a.orderIndex - b.orderIndex);
      const targetIdx = folder.pages.findIndex((p) => p.id === pageId);
      if (targetIdx === -1) {
        throw new AppError('NOT_FOUND', 'Sayfa bulunamadı.', 404);
      }

      const first = ingested[0];
      const current = folder.pages[targetIdx];
      current.imageUrl = first.processed.imageUrl;
      current.thumbnailUrl = first.processed.thumbnailUrl;
      current.naturalWidth = first.processed.naturalWidth;
      current.naturalHeight = first.processed.naturalHeight;
      current.sourceFileName = originalName;

      if (ingested.length > 1) {
        const now = new Date().toISOString();
        const extraPages: PageItem[] = ingested.slice(1).map((extra) => ({
          id: extra.pageId,
          orderIndex: 0,
          imageUrl: extra.processed.imageUrl,
          thumbnailUrl: extra.processed.thumbnailUrl,
          naturalWidth: extra.processed.naturalWidth,
          naturalHeight: extra.processed.naturalHeight,
          paperSize: current.paperSize,
          sourceFileName: originalName,
          hotspots: [],
          createdAt: now,
        }));
        folder.pages.splice(targetIdx + 1, 0, ...extraPages);
      }

      folder.pages.forEach((p, idx) => {
        p.orderIndex = idx;
      });
      folder.updatedAt = new Date().toISOString();
      return folder;
    });

    await deletePageMediaFiles(oldMedia.imageUrl, oldMedia.thumbnailUrl);

    res.json({ folder: updatedFolder });
  } catch (err) {
    next(err);
  }
});

pagesRouter.patch('/:pageId', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { folderId, pageId } = req.params as Record<string, string>;
    const ownerId = req.authUser!.id;
    const schema = z.object({
      paperSize: PaperSizeSchema.optional(),
      hotspots: z.array(HotspotSchema).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message || 'Geçersiz sayfa güncelleme verisi.',
        400
      );
    }

    const updatedFolder = await mutateDb((db) => {
      const folder = db.folders.find((f) => f.id === folderId);
      if (!folder) {
        throw new AppError('NOT_FOUND', 'Klasör bulunamadı.', 404);
      }
      if (folder.ownerId !== ownerId) {
        throw new AppError('FORBIDDEN', 'Bu klasörü düzenleme yetkiniz yok.', 403);
      }
      const page = folder.pages.find((p) => p.id === pageId);
      if (!page) {
        throw new AppError('NOT_FOUND', 'Sayfa bulunamadı.', 404);
      }

      if (parsed.data.paperSize !== undefined) {
        page.paperSize = parsed.data.paperSize;
      }
      if (parsed.data.hotspots !== undefined) {
        page.hotspots = parsed.data.hotspots;
      }

      folder.updatedAt = new Date().toISOString();
      return folder;
    });

    res.json({ folder: updatedFolder });
  } catch (err) {
    next(err);
  }
});

pagesRouter.delete('/:pageId', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { folderId, pageId } = req.params as Record<string, string>;
    const ownerId = req.authUser!.id;
    let removedPage: PageItem | undefined;

    const updatedFolder = await mutateDb((db) => {
      const folder = db.folders.find((f) => f.id === folderId);
      if (!folder) {
        throw new AppError('NOT_FOUND', 'Klasör bulunamadı.', 404);
      }
      if (folder.ownerId !== ownerId) {
        throw new AppError('FORBIDDEN', 'Bu klasörü düzenleme yetkiniz yok.', 403);
      }
      const idx = folder.pages.findIndex((p) => p.id === pageId);
      if (idx === -1) {
        throw new AppError('NOT_FOUND', 'Silinecek sayfa bulunamadı.', 404);
      }
      [removedPage] = folder.pages.splice(idx, 1);
      folder.pages
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .forEach((p, i) => {
          p.orderIndex = i;
        });
      folder.updatedAt = new Date().toISOString();
      return folder;
    });

    if (removedPage) {
      await deletePageMediaFiles(removedPage.imageUrl, removedPage.thumbnailUrl);
    }

    res.json({ folder: updatedFolder });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// 9. EXPRESS UYGULAMASI VE PORTABLE SUNUCU BAŞLATICI
// ============================================================================

const CLIENT_DIST_DIR = path.resolve(SERVER_DIR, './public');
const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');

  const isEmbed = req.query.embed === '1';
  if (!isEmbed) {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  }

  const frameAncestors = isEmbed
    ? "frame-ancestors 'self' https: http:;"
    : "frame-ancestors 'self';";
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://accounts.google.com https://apis.google.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob: https://*.googleusercontent.com https://*.ggpht.com https://*.google.com",
      "media-src 'self' data: blob:",
      "connect-src 'self' https://accounts.google.com https://oauth2.googleapis.com https://www.googleapis.com",
      "frame-src 'self' https://accounts.google.com",
      "object-src 'none'",
      "base-uri 'self'",
      frameAncestors,
    ].join('; ')
  );
  next();
});

const configuredCorsOrigins = new Set(
  (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
);
app.use(
  cors((req, callback) => {
    const origin = req.header('Origin');
    if (!origin) {
      callback(null, { origin: true });
      return;
    }
    if (
      configuredCorsOrigins.has(origin) ||
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
    ) {
      callback(null, { origin: true });
      return;
    }
    try {
      const originHost = new URL(origin).host.toLowerCase();
      const forwardedHost = (req.headers['x-forwarded-host'] as string | undefined)
        ?.split(',')[0]
        ?.trim()
        ?.toLowerCase();
      const reqHost = (req.headers.host || '').trim().toLowerCase();
      if (originHost && (originHost === forwardedHost || originHost === reqHost)) {
        callback(null, { origin: true });
        return;
      }
    } catch {
      // ignore malformed origin
    }
    callback(new AppError('FORBIDDEN', 'Yetkisiz CORS kaynağı.', 403));
  })
);

app.use(express.json({ limit: '10mb' }));
app.use('/api', apiRateLimiter);

app.use(
  '/media',
  express.static(MEDIA_DIR, {
    maxAge: '365d',
    immutable: true,
    dotfiles: 'deny',
  })
);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRouter);
app.use('/api/workspace', workspaceRouter);
app.use('/api/public', publicRouter);
app.use('/api/folders', foldersRouter);
app.use('/api/folders/:folderId/pages', pagesRouter);

if (fsSync.existsSync(CLIENT_DIST_DIR)) {
  app.use(express.static(CLIENT_DIST_DIR));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/media')) {
      next();
      return;
    }
    res.sendFile(path.join(CLIENT_DIST_DIR, 'index.html'));
  });
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
      },
    });
    return;
  }

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        error: {
          code: 'FILE_TOO_LARGE',
          message: 'Yüklenen dosya boyutu çok büyük (Maksimum 50 MB).',
        },
      });
      return;
    }
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: `Dosya yükleme hatası: ${err.message}`,
      },
    });
    return;
  }

  console.error('Unhandled Server Error:', err);
  res.status(500).json({
    error: {
      code: 'CONVERSION_FAILED',
      message: 'Sunucu tarafında beklenmeyen bir işlem hatası oluştu.',
    },
  });
});

async function start() {
  await readDb();
  const cleaned = await cleanupOrphanMediaFiles().catch(() => 0);
  if (cleaned > 0) {
    console.log(`[STORAGE] ${cleaned} adet kullanılmayan yetim medya öğesi temizlendi.`);
  }
  app.listen(PORT, () => {
    console.log(`[SERVER] 3D Fiziksel Dosya Rehberi Platformu çalışıyor: http://localhost:${PORT}`);
    if (process.env.AUTO_OPEN_BROWSER === '1' && process.platform === 'win32') {
      execFile('cmd.exe', ['/c', 'start', '', `http://localhost:${PORT}`], () => {});
    }
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
