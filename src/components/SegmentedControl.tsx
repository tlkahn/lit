interface SegmentedControlProps {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  testId: string;
  label?: React.ReactNode;
}

export function SegmentedControl({ options, value, onChange, testId, label }: SegmentedControlProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      {label && <span className="text-sm text-text-normal">{label}</span>}
      <div className="flex rounded-md bg-bg-tertiary p-0.5">
        {options.map((option) => (
          <button
            key={option.value}
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
            data-testid={`${testId}-${option.value}`}
            className={`rounded px-2.5 py-1 text-sm transition-colors ${option.value === value ? "bg-bg-primary text-text-normal shadow-sm" : "text-text-muted hover:text-text-normal"}`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
