"use client";

type Props = {
  value?: string | null;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

export default function TimePickerField({ value, onChange, disabled, className }: Props) {
  return (
    <input
      type="time"
      value={value || ''}
      disabled={!!disabled}
      onChange={(e) => onChange(e.target.value)}
      className={`w-[130px] bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-sm disabled:opacity-50 ${className || ''}`}
    />
  );
}
