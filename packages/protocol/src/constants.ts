export const EzDvCommand = {
  Ready: 0xa5,
  Debug: 0x80,
  Hello: 0x81,
  Flash: 0x82,
  ScriptStart: 0x83,
  ScriptStop: 0x84,
  Version: 0x85,
  LED: 0x86,
  UnPair: 0x87,
  ChangeControllerMode: 0x88,
  ChangeControllerColor: 0x89,
  SaveAmiibo: 0x90,
  ChangeAmiiboIndex: 0x91,
} as const;

export const Reply = {
  Error: 0x00,
  Busy: 0xfe,
  Ack: 0xff,
  Hello: 0x80,
  FlashStart: 0x81,
  FlashEnd: 0x82,
  ScriptAck: 0x83,
} as const;

export const SAVE_AMIIBO_PACKET_SIZE = 20;