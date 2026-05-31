interface SettingsDropdownProps {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  testId: string;
  label?: React.ReactNode;
  nullable?: boolean;
}

export function SettingsDropdown({ options, value, onChange, testId, label, nullable }: SettingsDropdownProps) {
  return (
    <div className="flex items-center justify-between gap-2 min-w-0 flex-wrap">
      {label && <span className="text-sm text-text-normal">{label}</span>}
      <select
        data-testid={testId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md bg-bg-tertiary px-2.5 py-1 text-sm text-text-normal outline-none focus:ring-1 focus:ring-accent"
      >
        {nullable && <option value="">Default</option>}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
