interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  testId: string;
  label?: React.ReactNode;
}

export function ToggleSwitch({ checked, onChange, testId, label }: ToggleSwitchProps) {
  return (
    <label className="flex items-center justify-between gap-2">
      {label && <span className="text-sm text-text-normal">{label}</span>}
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        data-testid={testId}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${checked ? "bg-accent" : "bg-bg-tertiary"}`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-[1.125rem]" : "translate-x-0.5"}`}
        />
      </button>
    </label>
  );
}
