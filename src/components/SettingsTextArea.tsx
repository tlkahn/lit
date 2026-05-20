interface SettingsTextAreaProps {
  value: string;
  onChange: (value: string) => void;
  testId: string;
  label?: React.ReactNode;
  onCommit?: () => void;
}

export function SettingsTextArea({ value, onChange, testId, label, onCommit }: SettingsTextAreaProps) {
  return (
    <div className="flex flex-col gap-1">
      {label && <span className="text-sm text-text-normal">{label}</span>}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onCommit?.()}
        data-testid={testId}
        rows={4}
        className="rounded-md bg-bg-tertiary px-2.5 py-1 text-sm text-text-normal outline-none focus:ring-1 focus:ring-accent resize-y"
      />
    </div>
  );
}
