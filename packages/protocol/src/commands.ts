import { EzDvCommand } from "./constants";

export function buildHelloFrame(): Uint8Array {
  return Uint8Array.from([EzDvCommand.Ready, EzDvCommand.Hello]);
}

export function buildWakeFrame(): Uint8Array {
  return Uint8Array.from([EzDvCommand.Ready, EzDvCommand.Wake]);
}

export function buildChangeAmiiboIndexFrame(index: number): Uint8Array {
  return Uint8Array.from([
    EzDvCommand.Ready,
    index & 0x0f,
    EzDvCommand.ChangeAmiiboIndex,
  ]);
}

export function buildSaveAmiiboMetaFrame(
  offset: number,
  len: number,
  index: number,
): Uint8Array {
  return Uint8Array.from([
    EzDvCommand.Ready,
    offset & 0x7f,
    (offset >> 7) & 0x7f,
    len & 0x7f,
    (len >> 7) & 0x7f,
    index & 0xff,
    EzDvCommand.SaveAmiibo,
  ]);
}