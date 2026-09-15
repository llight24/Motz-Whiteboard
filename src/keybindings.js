// 键位设置：加速键的解析、归一化、录制与冲突检测。纯逻辑模块，不依赖 React 或 DOM。

export const keybindingActions = [
  { id: "preview", label: "预览选中素材 / 关闭预览", group: "素材库与白板", default: "Space" },
  { id: "selectAllAssets", label: "选中全部素材", group: "素材库与白板", default: "Ctrl+A" },
  { id: "deleteSelection", label: "删除选中项", group: "素材库与白板", default: "Delete" },
  { id: "arrangeTop", label: "上对齐 / 上移", group: "画布对齐", default: "W" },
  { id: "arrangeLeft", label: "左对齐 / 左移", group: "画布对齐", default: "A" },
  { id: "arrangeBottom", label: "下对齐 / 下移", group: "画布对齐", default: "S" },
  { id: "arrangeRight", label: "右对齐 / 右移", group: "画布对齐", default: "D" },
  { id: "undo", label: "撤销", group: "编辑", default: "Ctrl+Z" },
  { id: "redo", label: "重做", group: "编辑", default: "Ctrl+Shift+Z" },
];

const modifierOrder = ["Ctrl", "Shift", "Alt", "Meta"];

const namedKeys = new Set([
  "Space",
  "Escape",
  "Enter",
  "Tab",
  "Backspace",
  "Delete",
  "Insert",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);

const punctuationKeys = new Set(["-", "=", "[", "]", "\\", ";", "'", ",", ".", "/", "`"]);

const codeKeys = {
  Space: "Space",
  Escape: "Escape",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backquote: "`",
};

const letterKeyPattern = /^[A-Z]$/;
const digitKeyPattern = /^[0-9]$/;
const numpadKeyPattern = /^Num[0-9]$/;
const functionKeyPattern = /^F([1-9]|1[0-9]|2[0-4])$/;
const letterCodePattern = /^Key([A-Z])$/;
const digitCodePattern = /^Digit([0-9])$/;
const numpadCodePattern = /^Numpad([0-9])$/;

function isSupportedKey(key) {
  if (typeof key !== "string" || !key) {
    return false;
  }
  if (letterKeyPattern.test(key) || digitKeyPattern.test(key) || numpadKeyPattern.test(key) || functionKeyPattern.test(key)) {
    return true;
  }
  return namedKeys.has(key) || punctuationKeys.has(key);
}

// event.code → 加速键里的 <Key>；无法识别时返回空串。
function keyFromCode(code) {
  if (typeof code !== "string" || !code) {
    return "";
  }
  if (Object.prototype.hasOwnProperty.call(codeKeys, code)) {
    return codeKeys[code];
  }
  const letter = letterCodePattern.exec(code);
  if (letter) {
    return letter[1];
  }
  const digit = digitCodePattern.exec(code);
  if (digit) {
    return digit[1];
  }
  const numpad = numpadCodePattern.exec(code);
  if (numpad) {
    return `Num${numpad[1]}`;
  }
  if (functionKeyPattern.test(code)) {
    return code;
  }
  return "";
}

// 严格语法：[Ctrl+][Shift+][Alt+][Meta+]<Key>：修饰键顺序固定为 Ctrl、Shift、Alt、Meta，
// 每个修饰键最多出现一次，可省略其中任意若干个（例如 Shift+A、Alt+A、Ctrl+Alt+A）。
function parseAccelerator(accelerator) {
  if (typeof accelerator !== "string" || !accelerator) {
    return null;
  }
  const parts = accelerator.split("+");
  const key = parts[parts.length - 1];
  if (!isSupportedKey(key)) {
    return null;
  }
  const modifiers = parts.slice(0, -1);
  let previousIndex = -1;
  for (const modifier of modifiers) {
    const index = modifierOrder.indexOf(modifier);
    if (index <= previousIndex) {
      return null;
    }
    previousIndex = index;
  }
  return { modifiers, key };
}

// 事件当前生效的修饰键（Meta / Command 归一为 Ctrl）。
function pressedModifiers(event) {
  const modifiers = [];
  if (event.ctrlKey || event.metaKey) {
    modifiers.push("Ctrl");
  }
  if (event.shiftKey) {
    modifiers.push("Shift");
  }
  if (event.altKey) {
    modifiers.push("Alt");
  }
  return modifiers;
}

export const defaultKeybindings = keybindingActions.reduce((bindings, action) => {
  bindings[action.id] = action.default;
  return bindings;
}, {});

export function isKeybindingAccelerator(value) {
  return parseAccelerator(value) !== null;
}

export function normalizeKeybindings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const bindings = {};
  for (const action of keybindingActions) {
    const value = source[action.id];
    bindings[action.id] = isKeybindingAccelerator(value) ? value : defaultKeybindings[action.id];
  }
  return bindings;
}

export function acceleratorFromEvent(event) {
  if (!event || event.repeat) {
    return "";
  }
  const key = keyFromCode(event.code);
  if (!key) {
    return "";
  }
  return [...pressedModifiers(event), key].join("+");
}

export function formatAccelerator(accelerator) {
  const parsed = parseAccelerator(accelerator);
  if (!parsed) {
    return "未设置";
  }
  return [...parsed.modifiers, parsed.key].join(" + ");
}

export function matchesKeybinding(event, accelerator) {
  if (!event) {
    return false;
  }
  const parsed = parseAccelerator(accelerator);
  if (!parsed || keyFromCode(event.code) !== parsed.key) {
    return false;
  }
  const modifiers = pressedModifiers(event);
  if (modifiers.length !== parsed.modifiers.length) {
    return false;
  }
  return parsed.modifiers.every((modifier, index) => modifier === modifiers[index]);
}

export function findKeybindingConflicts(bindings) {
  const normalized = normalizeKeybindings(bindings);
  const byAccelerator = new Map();
  for (const action of keybindingActions) {
    const accelerator = normalized[action.id];
    const ids = byAccelerator.get(accelerator);
    if (ids) {
      ids.push(action.id);
    } else {
      byAccelerator.set(accelerator, [action.id]);
    }
  }
  const conflicts = {};
  for (const ids of byAccelerator.values()) {
    if (ids.length < 2) {
      continue;
    }
    for (const id of ids) {
      conflicts[id] = ids.filter((other) => other !== id);
    }
  }
  return conflicts;
}

export function isKeybindingDefault(actionId, bindings) {
  if (!Object.prototype.hasOwnProperty.call(defaultKeybindings, actionId)) {
    return false;
  }
  return normalizeKeybindings(bindings)[actionId] === defaultKeybindings[actionId];
}
