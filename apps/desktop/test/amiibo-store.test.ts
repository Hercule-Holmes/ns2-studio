import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AmiiboStore } from "../src/main/amiibo/amiibo-store";

async function makeStore(): Promise<{ store: AmiiboStore; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "amiibo-store-"));
  return { store: new AmiiboStore(dir), dir };
}

async function writeDump(dir: string, name: string, bytes: Uint8Array): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, bytes);
  return path;
}

describe("AmiiboStore", () => {
  it("imports a dump, writes index.json and copies the raw file", async () => {
    const { store, dir } = await makeStore();
    const src = await writeDump(dir, "inkling.bin", new Uint8Array(540));

    const item = await store.importFile(src);

    expect(item.name).toBe("inkling");
    expect(item.size).toBe(540);
    expect(item.relPath).toBe(`files/${item.fileName}`);
    expect(item.fileName).toMatch(/\.bin$/);

    const onDisk = await readFile(join(dir, item.relPath));
    expect(onDisk.byteLength).toBe(540);

    const indexRaw = await readFile(join(dir, "index.json"), "utf8");
    const index = JSON.parse(indexRaw);
    expect(index.magic).toBe("AMIIBO");
    expect(index.version).toBe(1);
    expect(index.items).toHaveLength(1);
  });

  it("deduplicates names with a (2) suffix", async () => {
    const { store, dir } = await makeStore();
    const a = await writeDump(dir, "mario.bin", new Uint8Array(1));
    const b = await writeDump(dir, "mario.bin", new Uint8Array(2));

    const itemA = await store.importFile(a);
    const itemB = await store.importFile(b);

    expect(itemA.name).toBe("mario");
    expect(itemB.name).toBe("mario (2)");
    expect(itemA.id).not.toBe(itemB.id);
  });

  it("renames an item", async () => {
    const { store, dir } = await makeStore();
    const src = await writeDump(dir, "x.bin", new Uint8Array(8));
    const item = await store.importFile(src);

    const renamed = await store.rename(item.id, "Link");

    expect(renamed.name).toBe("Link");
    expect((await store.list())[0]?.name).toBe("Link");
  });

  it("remove deletes the file and the index entry", async () => {
    const { store, dir } = await makeStore();
    const src = await writeDump(dir, "y.bin", new Uint8Array(8));
    const item = await store.importFile(src);
    const filePath = join(dir, item.relPath);

    await store.remove(item.id);

    expect(await store.list()).toHaveLength(0);
    const remaining = await readdir(join(dir, "files"));
    expect(remaining).toHaveLength(0);
    await expect(readFile(filePath)).rejects.toThrow();
  });

  it("readBytes returns the raw payload", async () => {
    const { store, dir } = await makeStore();
    const payload = Uint8Array.from([0x04, 0x00, 0x06, 0x01, 0x99]);
    const src = await writeDump(dir, "peach.bin", payload);
    const item = await store.importFile(src);

    const bytes = await store.readBytes(item.id);
    expect(Array.from(bytes)).toEqual(Array.from(payload));
  });

  it("setLastSlot persists the slot in the index", async () => {
    const { store, dir } = await makeStore();
    const src = await writeDump(dir, "p.bin", new Uint8Array(8));
    const item = await store.importFile(src);

    await store.setLastSlot(item.id, 7);
    const updated = await store.getItem(item.id);
    expect(updated?.lastSlot).toBe(7);
  });

  it("rejects empty imports", async () => {
    const { store, dir } = await makeStore();
    const src = await writeDump(dir, "empty.bin", new Uint8Array(0));
    await expect(store.importFile(src)).rejects.toThrow(/空/);
  });

  it("treats a corrupt index.json as empty without throwing", async () => {
    const { store, dir } = await makeStore();
    await mkdir(join(dir, "files"), { recursive: true });
    await writeFile(join(dir, "index.json"), "not json {{{", "utf8");

    expect(await store.list()).toHaveLength(0);

    const src = await writeDump(dir, "ok.bin", new Uint8Array(16));
    const item = await store.importFile(src);
    expect(item.size).toBe(16);
    expect(await store.list()).toHaveLength(1);
  });
});