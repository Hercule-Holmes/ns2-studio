import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { AmiiboItem } from "../../shared/ipc";
import { AmiiboError } from "./errors";

const INDEX_MAGIC = "AMIIBO";
const INDEX_VERSION = 1;
const MAX_NAME_LENGTH = 80;

interface AmiiboIndex {
  magic: typeof INDEX_MAGIC;
  version: typeof INDEX_VERSION;
  items: AmiiboItem[];
}

/**
 * Raw-bytes amiibo library on disk:
 *
 *   userData/amiibo/
 *     index.json        # { magic, version, items: AmiiboItem[] }
 *     files/<uuid>.bin  # raw dump copies, never edited
 *
 * This is deliberately a "raw bytes repository": no decryption, no crafting.
 * Session S9 owns this directory tree.
 */
export class AmiiboStore {
  private readonly filesDir: string;
  private readonly indexPath: string;

  constructor(private readonly baseDir: string) {
    this.filesDir = join(baseDir, "files");
    this.indexPath = join(baseDir, "index.json");
  }

  async list(): Promise<AmiiboItem[]> {
    const index = await this.loadIndex();
    return index.items;
  }

  async getItem(id: string): Promise<AmiiboItem | undefined> {
    const index = await this.loadIndex();
    return index.items.find((item) => item.id === id);
  }

  /**
   * Copy an imported dump into the library. On a name collision the new name
   * gets a " (2)" / " (3)" suffix; the on-disk file always gets a fresh UUID.
   */
  async importFile(srcPath: string, name?: string): Promise<AmiiboItem> {
    const bytes = await readFile(srcPath).catch((err) => {
      throw new AmiiboError("IO", `无法读取导入文件: ${String(err)}`);
    });
    if (bytes.byteLength === 0) {
      throw new AmiiboError("EMPTY", "导入文件为空（0 字节）");
    }

    await mkdir(this.filesDir, { recursive: true });
    const index = await this.loadIndex();

    const id = randomUUID();
    const fileName = `${id}.bin`;
    const relPath = `files/${fileName}`;
    await copyFile(srcPath, join(this.baseDir, relPath));

    const baseName = sanitizeName(
      name ?? stripExtension(basename(srcPath)),
    );
    const finalName = uniqueName(baseName, index.items.map((i) => i.name));

    const item: AmiiboItem = {
      id,
      name: finalName,
      fileName,
      relPath,
      size: bytes.byteLength,
    };
    index.items.push(item);
    await this.saveIndex(index);
    return item;
  }

  async rename(id: string, newName: string): Promise<AmiiboItem> {
    const clean = sanitizeName(newName);
    if (!clean) throw new AmiiboError("IO", "名称不能为空");

    const index = await this.loadIndex();
    const item = index.items.find((i) => i.id === id);
    if (!item) throw new AmiiboError("NOT_FOUND", "条目不存在");

    item.name = uniqueName(
      clean,
      index.items.filter((i) => i.id !== id).map((i) => i.name),
    );
    await this.saveIndex(index);
    return item;
  }

  async remove(id: string): Promise<void> {
    const index = await this.loadIndex();
    const pos = index.items.findIndex((i) => i.id === id);
    if (pos < 0) return;
    const [removed] = index.items.splice(pos, 1);
    if (removed) {
      await unlink(join(this.baseDir, removed.relPath)).catch(() => {
        /* file already gone: fine */
      });
    }
    await this.saveIndex(index);
  }

  async readBytes(id: string): Promise<Uint8Array> {
    const item = await this.getItem(id);
    if (!item) throw new AmiiboError("NOT_FOUND", "条目不存在");
    const file = join(this.baseDir, item.relPath);
    const bytes = await readFile(file).catch((err) => {
      throw new AmiiboError("IO", `无法读取 ${item.relPath}: ${String(err)}`);
    });
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  async setLastSlot(id: string, slot: number): Promise<AmiiboItem> {
    const index = await this.loadIndex();
    const item = index.items.find((i) => i.id === id);
    if (!item) throw new AmiiboError("NOT_FOUND", "条目不存在");
    item.lastSlot = slot;
    await this.saveIndex(index);
    return item;
  }

  /** Size of the on-disk file backing an item (used for verification). */
  async fileSize(id: string): Promise<number> {
    const item = await this.getItem(id);
    if (!item) throw new AmiiboError("NOT_FOUND", "条目不存在");
    const info = await stat(join(this.baseDir, item.relPath));
    return info.size;
  }

  // ------------------------------------------------------------------
  // index.json
  // ------------------------------------------------------------------

  private async loadIndex(): Promise<AmiiboIndex> {
    const empty = (): AmiiboIndex => ({
      magic: INDEX_MAGIC,
      version: INDEX_VERSION,
      items: [],
    });
    const raw = await readFile(this.indexPath, "utf8").catch(() => null);
    if (raw === null) return empty();
    try {
      const parsed = JSON.parse(raw) as Partial<AmiiboIndex>;
      if (
        parsed?.magic !== INDEX_MAGIC ||
        parsed.version !== INDEX_VERSION ||
        !Array.isArray(parsed.items)
      ) {
        return empty();
      }
      return parsed as AmiiboIndex;
    } catch {
      return empty();
    }
  }

  private async saveIndex(index: AmiiboIndex): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
    await writeFile(
      this.indexPath,
      JSON.stringify(index, null, 2),
      "utf8",
    );
  }
}

function sanitizeName(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}

function stripExtension(fileName: string): string {
  const ext = extname(fileName);
  return ext ? fileName.slice(0, -ext.length) : fileName;
}

function uniqueName(base: string, existing: string[]): string {
  if (base.length === 0) return "未命名";
  if (!existing.includes(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base} (${i})`;
    if (!existing.includes(candidate)) return candidate;
  }
  return `${base} (${randomUUID().slice(0, 8)})`;
}