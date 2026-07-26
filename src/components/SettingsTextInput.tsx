interface SettingsTextInputProps {
  value: string;
  onChange: (value: string) => void;
  testId: string;
  label?: React.ReactNode;
  onCommit?: () => void;
  placeholder?: string;
  hint?: string;
}

export function SettingsTextInput({ value, onChange, testId, label, onCommit, placeholder, hint }: SettingsTextInputProps) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex items-center justify-between gap-2 min-w-0 flex-wrap">
        {label && <span className="text-sm text-text-normal">{label}</span>}
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => onCommit?.()}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommit?.();
          }}
          placeholder={placeholder}
          data-testid={testId}
          className="rounded-md bg-bg-tertiary px-2.5 py-1 text-sm text-text-normal outline-none focus:ring-1 focus:ring-accent"
        />
      </div>
      {hint && (
        <span className="text-xs text-text-muted" data-testid={`${testId}-hint`}>
          {hint}
        </span>
      )}
    </div>
  );
}
