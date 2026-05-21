import { useState } from "react";

interface SettingsPasswordInputProps {
  testId: string;
  label?: React.ReactNode;
  hasKey: boolean;
  onSave: (value: string) => void;
  onDelete: () => void;
}

export function SettingsPasswordInput({ testId, label, hasKey, onSave, onDelete }: SettingsPasswordInputProps) {
  const [value, setValue] = useState("");

  const handleSave = () => {
    if (value.trim() === "") return;
    onSave(value);
    setValue("");
  };

  return (
    <div className="flex items-center justify-between gap-2">
      {label && <span className="text-sm text-text-normal">{label}</span>}
      <div className="flex items-center gap-2">
        {hasKey && (
          <span data-testid={`${testId}-saved`} className="text-xs text-text-success">
            Key saved
          </span>
        )}
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
          }}
          data-testid={testId}
          className="rounded-md bg-bg-tertiary px-2.5 py-1 text-sm text-text-normal outline-none focus:ring-1 focus:ring-accent"
        />
        <button
          onClick={handleSave}
          data-testid={`${testId}-save`}
          className="rounded-md bg-bg-tertiary px-2 py-1 text-xs text-text-muted hover:bg-bg-secondary"
        >
          Save
        </button>
        {hasKey && (
          <button
            onClick={onDelete}
            data-testid={`${testId}-clear`}
            className="rounded-md bg-bg-tertiary px-2 py-1 text-xs text-red-400 hover:bg-bg-secondary"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
