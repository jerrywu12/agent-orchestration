import { useId } from "react";
import { effortHelp, effortRanges, efforts, type Effort } from "../effort";

export function EffortSelect({
  value,
  onChange,
  disabled = false,
  label,
}: {
  value?: Effort | null;
  onChange: (value: Effort | null) => void;
  disabled?: boolean;
  label?: string;
}) {
  const id = useId();
  const select = (
    <select
      id={id}
      aria-label={label}
      aria-describedby={label ? undefined : `${id}-help`}
      title={effortHelp}
      value={value ?? ""}
      disabled={disabled}
      onChange={(event) =>
        onChange((event.target.value || null) as Effort | null)
      }
    >
      <option value="">Unset</option>
      {efforts.map((effort) => (
        <option key={effort} value={effort}>
          {label ? effort : `${effort} · ${effortRanges[effort]}`}
        </option>
      ))}
    </select>
  );
  if (label) return select;
  return (
    <div className="effort-field">
      <label htmlFor={id}>Effort</label>
      {select}
      <small id={`${id}-help`} className="effort-help">
        {effortHelp}
      </small>
    </div>
  );
}
