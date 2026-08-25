import { describe, expect, it } from "vitest";
import {
  EzDvCommand,
  Reply,
  SAVE_AMIIBO_PACKET_SIZE,
  buildChangeAmiiboIndexFrame,
  buildHelloFrame,
  buildSaveAmiiboMetaFrame,
  commands,
} from "../src/index";

describe("Reply constants", () => {
  it("match the protocol table", () => {
    expect(Reply.Error).toBe(0x00);
    expect(Reply.Busy).toBe(0xfe);
    expect(Reply.Ack).toBe(0xff);
    expect(Reply.Hello).toBe(0x80);
    expect(Reply.FlashStart).toBe(0x81);
    expect(Reply.FlashEnd).toBe(0x82);
    expect(Reply.ScriptAck).toBe(0x83);
  });
});

describe("EzDvCommand constants", () => {
  it("match the protocol table", () => {
    expect(EzDvCommand.Ready).toBe(0xa5);
    expect(EzDvCommand.Hello).toBe(0x81);
    expect(EzDvCommand.SaveAmiibo).toBe(0x90);
    expect(EzDvCommand.ChangeAmiiboIndex).toBe(0x91);
  });

  it("defines the SaveAmiibo packet size", () => {
    expect(SAVE_AMIIBO_PACKET_SIZE).toBe(20);
  });
});

describe("buildHelloFrame", () => {
  it("is [Ready, Hello]", () => {
    expect(buildHelloFrame()).toEqual(Uint8Array.from([0xa5, 0x81]));
    expect(commands.hello()).toEqual(Uint8Array.from([0xa5, 0x81]));
  });
});

describe("buildChangeAmiiboIndexFrame", () => {
  it("is [Ready, index, ChangeAmiiboIndex]", () => {
    expect(buildChangeAmiiboIndexFrame(0)).toEqual(
      Uint8Array.from([0xa5, 0x00, 0x91]),
    );
    expect(buildChangeAmiiboIndexFrame(15)).toEqual(
      Uint8Array.from([0xa5, 0x0f, 0x91]),
    );
    expect(commands.changeAmiiboIndex(3)).toEqual(
      Uint8Array.from([0xa5, 0x03, 0x91]),
    );
  });

  it("masks the index to 0..15", () => {
    expect(buildChangeAmiiboIndexFrame(20)).toEqual(
      Uint8Array.from([0xa5, 0x04, 0x91]),
    );
  });
});

describe("buildSaveAmiiboMetaFrame", () => {
  it("lays out offset/len big-endian with 7-bit halves", () => {
    expect(buildSaveAmiiboMetaFrame(0, 20, 0)).toEqual(
      Uint8Array.from([0xa5, 0x00, 0x00, 0x14, 0x00, 0x00, 0x90]),
    );
  });

  it("splits offset 540 into (0x1C, 0x04)", () => {
    expect(buildSaveAmiiboMetaFrame(540, 1, 3)).toEqual(
      Uint8Array.from([0xa5, 0x1c, 0x04, 0x01, 0x00, 0x03, 0x90]),
    );
  });

  it("is exposed as commands.saveAmiiboHeader", () => {
    expect(commands.saveAmiiboHeader(0, 20, 0)).toEqual(
      buildSaveAmiiboMetaFrame(0, 20, 0),
    );
  });
});

describe("commands.ready", () => {
  it("is the Ready prefix byte alone", () => {
    expect(commands.ready()).toEqual(Uint8Array.from([0xa5]));
  });
});