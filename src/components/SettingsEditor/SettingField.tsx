import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { ModSettingDef } from "../../lib/luaParser";
import { renderColoredText } from "../../utils/renderColoredText";

interface Props {
  setting: ModSettingDef;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
}

export default function SettingField({ setting, value, onChange }: Props) {
  const handleChange = (newValue: unknown) => {
    onChange(setting.key, newValue);
  };

  return (
    <div className="py-3 border-b border-slate-700/50 last:border-0">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <label className="text-sm font-medium text-slate-200 block truncate">
            {renderColoredText(setting.displayName || setting.key)}
          </label>
          {setting.description && (
            <p className="text-xs text-slate-500 mt-0.5">
              {renderColoredText(setting.description)}
            </p>
          )}
        </div>
        <div className="shrink-0">
          {setting.settingType === "Toggle" && (
            <ToggleField value={value} onChange={handleChange} />
          )}
          {setting.settingType === "Slider" && (
            <SliderField
              value={value}
              onChange={handleChange}
              min={setting.minValue ?? 0}
              max={setting.maxValue ?? 100}
              step={setting.stepSize ?? 1}
            />
          )}
          {setting.settingType === "Dropdown" && (
            <DropdownField
              value={value}
              onChange={handleChange}
              options={setting.options ?? {}}
            />
          )}
          {setting.settingType === "InputField" && (
            <InputField
              value={value}
              defaultValue={setting.defaultValue}
              onChange={handleChange}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ToggleField({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (v: boolean) => void;
}) {
  const checked = !!value;
  return (
    <label className="relative inline-flex items-center cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only peer"
      />
      <div className="w-9 h-5 bg-slate-600 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600" />
    </label>
  );
}

function SliderField({
  value,
  onChange,
  min,
  max,
  step,
}: {
  value: unknown;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  const rawValue = typeof value === "number" ? value : Number(value) || min;
  const numValue = Math.min(Math.max(rawValue, min), max);
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={numValue}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-28 h-1.5 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-blue-500"
      />
      <span className="text-xs text-slate-300 w-10 text-right tabular-nums">
        {numValue}
      </span>
    </div>
  );
}

function DropdownField({
  value,
  onChange,
  options,
}: {
  value: unknown;
  onChange: (v: number) => void;
  options: Record<number, string>;
}) {
  const numValue = typeof value === "number" ? value : Number(value) || 0;
  const entries = Object.entries(options).map(
    ([k, v]) => [Number(k), v] as const,
  );
  entries.sort((a, b) => a[0] - b[0]);
  return (
    <select
      value={numValue}
      onChange={(e) => onChange(Number(e.target.value))}
      className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-slate-200 cursor-pointer focus:outline-none focus:border-blue-500"
    >
      {entries.length === 0 ? (
        <option disabled value="">
          无可用选项
        </option>
      ) : (
        entries.map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))
      )}
    </select>
  );
}

/**
 * Single-line text input for SettingType = "InputField".
 * Numeric mode (default value is a number): filters non-numeric characters,
 * commits a parsed number on valid input, and reverts to the last committed
 * value on blur when the field is empty or invalid.
 */
function InputField({
  value,
  defaultValue,
  onChange,
}: {
  value: unknown;
  defaultValue: unknown;
  onChange: (v: string | number) => void;
}) {
  const numeric = typeof defaultValue === "number";
  const initText = (v: unknown) => String(v ?? "");
  const [text, setText] = useState(() => initText(value ?? defaultValue));
  const lastCommitRef = useRef<unknown>(value ?? defaultValue);

  // Reflect external value changes (profile load, default fallback, etc.)
  useEffect(() => {
    if (value !== lastCommitRef.current) {
      setText(initText(value ?? defaultValue));
      lastCommitRef.current = value ?? defaultValue;
    }
  }, [value, defaultValue]);

  const commit = (raw: string) => {
    if (numeric) {
      const n = Number(raw);
      if (raw.trim() !== "" && Number.isFinite(n)) {
        lastCommitRef.current = n;
        onChange(n);
      }
    } else {
      lastCommitRef.current = raw;
      onChange(raw);
    }
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = numeric
      ? e.target.value.replace(/[^0-9.\-]/g, "")
      : e.target.value;
    setText(raw);
    commit(raw);
  };

  const handleBlur = () => {
    if (numeric) {
      const n = Number(text);
      if (text.trim() === "" || !Number.isFinite(n)) {
        setText(initText(lastCommitRef.current));
      }
    }
  };

  return (
    <input
      type="text"
      inputMode={numeric ? "decimal" : "text"}
      value={text}
      onChange={handleChange}
      onBlur={handleBlur}
      className="w-40 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
    />
  );
}
