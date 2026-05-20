interface SettingsSliderProps {
  value: number;
  onChange: (value: number) => void;
  testId: string;
  label?: React.ReactNode;
  min: number;
  max: number;
  step: number;
}

export function SettingsSlider({ value, onChange, testId, label, min, max, step }: SettingsSliderProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      {label && <span className="text-sm text-text-normal">{label}</span>}
      <div className="flex items-center gap-2">
        <input
          type="range"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          min={min}
          max={max}
          step={step}
          data-testid={testId}
          className="accent-accent"
        />
        <span data-testid={`${testId}-value`} className="w-8 text-right text-sm text-text-muted">
          {value}
        </span>
      </div>
    </div>
  );
}
