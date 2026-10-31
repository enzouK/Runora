import React from 'react';

interface IOSSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/**
 * iOS-style toggle switch (UISwitch): green track when on, sliding white knob.
 */
export const IOSSwitch: React.FC<IOSSwitchProps> = ({ checked, onChange, disabled = false }) => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative w-[46px] h-[28px] rounded-full transition-colors duration-200 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue/40 disabled:opacity-40 ${
        checked ? 'bg-ios-green' : 'bg-[color-mix(in_srgb,var(--color-ios-bg)_70%,black)] dark:bg-[color-mix(in_srgb,var(--color-ios-bg-dark)_70%,black)]'
      }`}
    >
      <span
        className={`absolute top-[2px] left-[2px] w-6 h-6 rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.25)] transition-transform duration-200 ${
          checked ? 'translate-x-[18px]' : 'translate-x-0'
        }`}
      />
    </button>
  );
};
