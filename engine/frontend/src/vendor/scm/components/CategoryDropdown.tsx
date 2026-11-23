import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useEscapeLayer } from '../../../lib/escapeStack';
import styles from './ItemPickerDialog.module.css';

export interface CategoryOption {
  value: string;
  label: string;
}

export interface CategoryDropdownProps {
  value: string;
  options: readonly CategoryOption[];
  onChange: (value: string) => void;
}

export function CategoryDropdown({ value, options, onChange }: CategoryDropdownProps): ReactElement {
  const [isOpen, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useEscapeLayer(() => setOpen(false), isOpen);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnOutside = ({ target }: MouseEvent): void => {
      if (target instanceof Node && !wrapRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutside);
    return () => document.removeEventListener('mousedown', closeOnOutside);
  }, [isOpen]);

  const selected = options.find((option) => option.value === value) ?? options[0];

  return (
    <div ref={wrapRef} className={styles.dropdown}>
      <button
        type="button"
        className={styles.categoryInput}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={menuId}
        onClick={() => setOpen((open) => !open)}
      >
        <span className={styles.triggerLabel}>{selected?.label}</span>
        <ChevronDown size={16} strokeWidth={1.75} aria-hidden className={isOpen ? styles.chevronOpen : styles.chevron} />
      </button>
      {isOpen && (
        <ul id={menuId} role="listbox" aria-label="Category" className={styles.menu}>
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <li key={option.value || 'all'} role="option" aria-selected={isSelected}>
                <button
                  type="button"
                  className={isSelected ? styles.optionSelected : styles.option}
                  onClick={() => { onChange(option.value); setOpen(false); }}
                >
                  <span>{option.label}</span>
                  {isSelected && <Check size={14} aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
