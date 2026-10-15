// Self-contained XKB text, built in JS. No xkbcommon native binding or build tool.
// Evdev codes are the Linux input-event ABI; XKB keycodes are evdev + 8.
export const keys = new Map();
const add = (code, evdev, normal, shifted = normal) => keys.set(code, { code, evdev, normal, shifted });
const rows = [
  ['Digit1 Digit2 Digit3 Digit4 Digit5 Digit6 Digit7 Digit8 Digit9 Digit0 Minus Equal',2,'1234567890-=','!@#$%^&*()_+'],
  ['KeyQ KeyW KeyE KeyR KeyT KeyY KeyU KeyI KeyO KeyP BracketLeft BracketRight',16,'qwertyuiop[]','QWERTYUIOP{}'],
  ['KeyA KeyS KeyD KeyF KeyG KeyH KeyJ KeyK KeyL Semicolon Quote',30,"asdfghjkl;'",'ASDFGHJKL:"'],
  ['KeyZ KeyX KeyC KeyV KeyB KeyN KeyM Comma Period Slash',44,'zxcvbnm,./','ZXCVBNM<>?'],
];
for (const [codes,start,normal,shifted] of rows) codes.split(' ').forEach((code,i)=>add(code,start+i,normal[i],shifted[i]));
add('Backquote',41,'`','~'); add('Backslash',43,'\\','|'); add('Space',57,' ');
for (const [code,evdev,sym] of [
  ['Escape',1,'Escape'],['Backspace',14,'BackSpace'],['Tab',15,'Tab'],['Enter',28,'Return'],
  ['ControlLeft',29,'Control_L'],['ShiftLeft',42,'Shift_L'],['ShiftRight',54,'Shift_R'],['AltLeft',56,'Alt_L'],
  ['CapsLock',58,'Caps_Lock'],['ControlRight',97,'Control_R'],['AltRight',100,'Alt_R'],['MetaLeft',125,'Super_L'],['MetaRight',126,'Super_R'],
  ['Home',102,'Home'],['ArrowUp',103,'Up'],['PageUp',104,'Prior'],['ArrowLeft',105,'Left'],['ArrowRight',106,'Right'],
  ['End',107,'End'],['ArrowDown',108,'Down'],['PageDown',109,'Next'],['Insert',110,'Insert'],['Delete',111,'Delete'],
]) add(code,evdev,sym);
for(let n=1;n<=12;n++) add('F'+n,n<=10?58+n:76+n,'F'+n);
const symbol = s => [...s].length === 1 ? '0x' + (s.codePointAt(0) <= 255 ? s.codePointAt(0) : 0x01000000+s.codePointAt(0)).toString(16) : s;
const name = n => `K${n}`;
export class Keymap {
  constructor() { this.unicode = new Map(); this.version = 0; }
  resolve(key, code = '') {
    if (code && keys.has(code)) return { ...keys.get(code), shift: false };
    for (const item of keys.values()) {
      if (item.normal === key || item.code === key) return { ...item, shift: false };
      if (item.shifted === key) return { ...item, shift: true };
    }
    if (key === '\n' || key === '\r') return { ...keys.get('Enter'), shift:false };
    if (key === '\t') return { ...keys.get('Tab'), shift:false };
    if ([...key].length !== 1 || key.codePointAt(0)<32) return null;
    if (!this.unicode.has(key)) {
      if (this.unicode.size >= 512) throw Error('Unicode keymap capacity reached');
      this.unicode.set(key,{evdev:256+this.unicode.size,normal:key,shifted:key}); this.version++;
    }
    return this.unicode.get(key);
  }
  text() {
    const all = [...keys.values(),...this.unicode.values()];
    return `xkb_keymap {
      xkb_keycodes "buninu" { minimum = 8; maximum = 775;
        ${all.map(k=>`<${name(k.evdev)}> = ${k.evdev+8};`).join('\n')}
      };
      xkb_types "buninu" {
        type "ONE_LEVEL" { modifiers = None; map[None] = Level1; };
        type "TWO_LEVEL" { modifiers = Shift; map[None] = Level1; map[Shift] = Level2; };
        type "ALPHABETIC" { modifiers = Shift+Lock; map[None] = Level1; map[Shift] = Level2; map[Lock] = Level2; map[Shift+Lock] = Level1; };
      };
      xkb_compatibility "buninu" {};
      xkb_symbols "buninu" {
        name[Group1] = "Buninu US + Unicode";
        ${all.map(k=>`key <${name(k.evdev)}> { type=${JSON.stringify(/^[a-z]$/.test(k.normal)?'ALPHABETIC':k.normal!==k.shifted?'TWO_LEVEL':'ONE_LEVEL')}, [ ${symbol(k.normal)}, ${symbol(k.shifted)} ] };`).join('\n')}
        modifier_map Shift { <K42>, <K54> };
        modifier_map Lock { <K58> };
        modifier_map Control { <K29>, <K97> };
        modifier_map Mod1 { <K56>, <K100> };
        modifier_map Mod4 { <K125>, <K126> };
      };
    };\n\0`;
  }
}
export const xkbModifiers = bits => ((bits&8)?1:0)|((bits&2)?4:0)|((bits&1)?8:0)|((bits&4)?64:0);
