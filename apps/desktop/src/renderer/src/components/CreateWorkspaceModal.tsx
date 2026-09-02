import { useState } from 'react';
import { Icon } from '../icons';
import { CREATE_TOOL_PRESETS, toolColor, type CreateToolPreset } from '../constants';

interface CreateWorkspaceModalProps {
  open: boolean;
  onClose: () => void;
}

export function CreateWorkspaceModal({ open, onClose }: CreateWorkspaceModalProps): JSX.Element {
  const [createSteps, setCreateSteps] = useState<CreateToolPreset[]>([
    CREATE_TOOL_PRESETS[0]!,
    CREATE_TOOL_PRESETS[1]!,
  ]);

  function addTool(): void {
    const next = CREATE_TOOL_PRESETS[createSteps.length % CREATE_TOOL_PRESETS.length]!;
    setCreateSteps((steps) => [...steps, next]);
  }

  function removeTool(index: number): void {
    setCreateSteps((steps) => steps.filter((_, i) => i !== index));
  }

  return (
    <div
      className={`overlay ${open ? 'open' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="create-modal">
        <div className="create-modal-header">
          <h2>New workspace</h2>
          <button
            className="btn-icon"
            type="button"
            style={{ width: 28, height: 28 }}
            onClick={onClose}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
        <div className="create-modal-body">
          <p className="field-label">Workspace name</p>
          <input className="field-input" type="text" placeholder="e.g. Client C — Backend" />

          <p className="field-label">Tools · runs in order added</p>
          <div className="create-steps">
            {createSteps.map((s, i) => {
              const colors = toolColor(s.color);
              return (
                <div className="create-step" key={i}>
                  <span className="tool-icon" style={{ background: colors.bg, color: colors.fg }}>
                    <Icon name={s.icon} size={13} />
                  </span>
                  <div>
                    <div className="create-step-name">{s.name}</div>
                    <div className="create-step-config">{s.config}</div>
                  </div>
                  <span
                    className="create-step-remove"
                    onClick={() => {
                      removeTool(i);
                    }}
                  >
                    <Icon name="x" size={13} />
                  </span>
                </div>
              );
            })}
          </div>

          <button className="btn-add-tool" type="button" onClick={addTool}>
            <Icon name="plus" size={12} />
            Add tool
          </button>
        </div>
        <div className="create-modal-footer">
          <button className="btn-ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-save" type="button">
            Save workspace
          </button>
        </div>
      </div>
    </div>
  );
}
