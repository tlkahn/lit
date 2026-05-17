interface SettingsTextInputProps {
  value: string;
  onChange: (value: string) => void;
  testId: string;
  label?: React.ReactNode;
  onCommit?: () => void;
}

export function SettingsTextInput({ value, onChange, testId, label, onCommit }: SettingsTextInputProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      {label && <span className="text-sm text-text-normal">{label}</span>}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onCommit?.()}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit?.();
        }}
        data-testid={testId}
        className="rounded-md bg-bg-tertiary px-2.5 py-1 text-sm text-text-normal outline-none focus:ring-1 focus:ring-accent"
      />
    </div>
  );
}
