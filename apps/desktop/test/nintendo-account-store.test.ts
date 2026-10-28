import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NintendoAccountStore, type NintendoCryptor } from "../src/main/nintendo/account-store";

// plain passthrough cryptor (unit tests run without Electron safeStorage)
const passthrough: NintendoCryptor = {
  encrypt: (plain) => "enc:" + Buffer.from(plain, "utf8").toString("base64"),
  decrypt: (enc) => Buffer.from(enc.replace(/^enc:/, ""), "base64").toString("utf8"),
};

const dirs: string[] = [];
function makeStore(): NintendoAccountStore {
  const dir = mkdtempSync(join(tmpdir(), "nintendo-store-"));
  dirs.push(dir);
  return new NintendoAccountStore(
    join(dir, "store.json"),
    join(dir, "covers"),
    passthrough,
  );
}
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

const SUB = "sub-abc";

describe("NintendoAccountStore (S19)", () => {
  it("round-trips an encrypted session token", () => {
    const store = makeStore();
    store.putAccount({
      sub: SUB,
      nickname: "测试",
      sessionTokenEnc: passthrough.encrypt("TOKEN123"),
      addedAt: "2026-01-01",
      lastSyncAt: null,
      cursor: null,
    });
    expect(store.has(SUB)).toBe(true);
    expect(store.accountSessionToken(SUB)).toBe("TOKEN123");
  });

  it("lists accounts sorted by addedAt", () => {
    const store = makeStore();
    store.putAccount({ sub: "b", nickname: "B", sessionTokenEnc: "x", addedAt: "2026-01-02", lastSyncAt: null, cursor: null });
    store.putAccount({ sub: "a", nickname: "A", sessionTokenEnc: "x", addedAt: "2026-01-01", lastSyncAt: null, cursor: null });
    expect(store.listAccounts().map((a) => a.sub)).toEqual(["a", "b"]);
  });

  it("removeAccount also removes its daily rows", () => {
    const store = makeStore();
    store.putAccount({ sub: SUB, nickname: "N", sessionTokenEnc: "x", addedAt: "d", lastSyncAt: null, cursor: null });
    store.appendDaily(SUB, [
      { sub: SUB, date: "2026-01-01", updatedAt: "u", device: "Switch", apps: [], totalSeconds: 0 },
    ]);
    expect(store.getDaily(SUB)).toHaveLength(1);
    store.removeAccount(SUB);
    expect(store.has(SUB)).toBe(false);
    expect(store.getDaily(SUB)).toHaveLength(0);
  });

  it("replace-by-date merge on appendDaily", () => {
    const store = makeStore();
    store.appendDaily(SUB, [
      { sub: SUB, date: "2026-01-01", updatedAt: "u1", device: "d", apps: [{ id: "a", name: "A", imageUri: "", totalSeconds: 10, sessions: [] }], totalSeconds: 10 },
    ]);
    store.appendDaily(SUB, [
      { sub: SUB, date: "2026-01-01", updatedAt: "u2", device: "d", apps: [{ id: "a", name: "A", imageUri: "", totalSeconds: 25, sessions: [] }], totalSeconds: 25 },
    ]);
    expect(store.getDaily(SUB)).toHaveLength(1);
    expect(store.getDaily(SUB)[0]!.totalSeconds).toBe(25);
  });

  it("persists across instances (same file)", () => {
    const dir = mkdtempSync(join(tmpdir(), "nintendo-store-"));
    dirs.push(dir);
    const file = join(dir, "store.json");
    const a = new NintendoAccountStore(file, join(dir, "covers"), passthrough);
    a.putAccount({ sub: SUB, nickname: "N", sessionTokenEnc: passthrough.encrypt("T"), addedAt: "d", lastSyncAt: null, cursor: "cur" });
    const b = new NintendoAccountStore(file, join(dir, "covers"), passthrough);
    expect(b.accountSessionToken(SUB)).toBe("T");
    expect(b.getCursor(SUB)).toBe("cur");
  });

  it("creates the covers dir on saveCover", () => {
    const store = makeStore();
    store.saveCover("appid-1", Buffer.from("img"));
    expect(existsSync(join(dirs[dirs.length - 1]!, "covers"))).toBe(true);
    expect(store.readCover("appid-1")?.toString()).toBe("img");
    expect(store.hasCover("appid-2")).toBe(false);
  });
});
