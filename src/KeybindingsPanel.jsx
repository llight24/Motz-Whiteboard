import { Keyboard, RotateCcw, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  acceleratorFromEvent,
  defaultKeybindings,
  findKeybindingConflicts,
  formatAccelerator,
  isKeybindingDefault,
  keybindingActions,
  normalizeKeybindings,
} from "./keybindings.js";

const keybindingNote = "方向键始终可用作对齐/移动的备用键，退格键等同于删除，Ctrl+Y 等同于重做，Esc 关闭预览。";

const actionGroups = keybindingActions.reduce((groups, action) => {
  const existing = groups.find((group) => group.name === action.group);
  if (existing) {
    existing.actions.push(action);
  } else {
    groups.push({ name: action.group, actions: [action] });
  }
  return groups;
}, []);

const actionLabels = keybindingActions.reduce((labels, action) => {
  labels[action.id] = action.label;
  return labels;
}, {});

export function KeybindingsPanel({ bindings, onChange, onReset, onResetAll }) {
  const panelRef = useRef(null);
  const [recordingId, setRecordingId] = useState("");
  const normalized = useMemo(() => normalizeKeybindings(bindings), [bindings]);
  const conflicts = useMemo(() => findKeybindingConflicts(normalized), [normalized]);
  const allDefault = keybindingActions.every((action) => normalized[action.id] === defaultKeybindings[action.id]);

  useEffect(() => {
    if (!recordingId) {
      return undefined;
    }
    const finishRecording = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecordingId("");
        return;
      }
      const accelerator = acceleratorFromEvent(event);
      if (!accelerator) {
        return;
      }
      onChange(recordingId, accelerator);
      setRecordingId("");
    };
    const cancelRecording = () => setRecordingId("");
    const handleMouseDown = (event) => {
      const panel = panelRef.current;
      if (panel && event.target instanceof Node && panel.contains(event.target)) {
        return;
      }
      cancelRecording();
    };
    window.addEventListener("keydown", finishRecording, true);
    window.addEventListener("blur", cancelRecording);
    window.addEventListener("mousedown", handleMouseDown, true);
    return () => {
      window.removeEventListener("keydown", finishRecording, true);
      window.removeEventListener("blur", cancelRecording);
      window.removeEventListener("mousedown", handleMouseDown, true);
    };
  }, [recordingId, onChange]);

  return (
    <div className="keybinding-panel" ref={panelRef}>
      <p className="settings-note keybinding-note">
        <Keyboard size={13} />
        <span>{keybindingNote}</span>
      </p>
      {actionGroups.map((group) => (
        <div className="keybinding-group" key={group.name}>
          <div className="settings-section-heading">
            <strong>{group.name}</strong>
          </div>
          <div className="keybinding-list">
            {group.actions.map((action) => {
              const conflictIds = conflicts[action.id];
              const recording = recordingId === action.id;
              return (
                <div className={conflictIds ? "keybinding-row conflict" : "keybinding-row"} key={action.id}>
                  <span className="keybinding-label">{action.label}</span>
                  <span className="keybinding-chip">{formatAccelerator(normalized[action.id])}</span>
                  <button
                    type="button"
                    className={recording ? "keybinding-record active" : "keybinding-record"}
                    onClick={() => setRecordingId((current) => (current === action.id ? "" : action.id))}
                  >
                    {recording ? "按下新键…" : "修改"}
                  </button>
                  <button
                    type="button"
                    className="keybinding-reset"
                    onClick={() => onReset(action.id)}
                    disabled={isKeybindingDefault(action.id, normalized)}
                  >
                    恢复默认
                  </button>
                  {conflictIds ? (
                    <p className="keybinding-conflict">
                      <TriangleAlert size={12} />
                      <span>{`与「${conflictIds.map((id) => actionLabels[id] || id).join("、")}」冲突`}</span>
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <button type="button" className="keybinding-reset-all" onClick={onResetAll} disabled={allDefault}>
        <RotateCcw size={13} />
        <span>全部恢复默认</span>
      </button>
    </div>
  );
}
