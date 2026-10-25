"use client";

import { useId, useState, forwardRef } from "react";

interface PasswordInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
  containerStyle?: React.CSSProperties;
}

/**
 * A password <input> with a show/hide toggle. Defaults to the same
 * `.input` class the rest of the app's form fields use, so it drops in
 * without changing form layout.
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(
  { label, id, className, containerStyle, ...rest },
  ref,
) {
  const [visible, setVisible] = useState(false);
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <div style={containerStyle}>
      {label && (
        <label htmlFor={inputId} className="field-label">
          {label}
        </label>
      )}
      <div style={{ position: "relative" }}>
        <input
          {...rest}
          ref={ref}
          id={inputId}
          type={visible ? "text" : "password"}
          className={className ?? "input"}
          style={{ paddingRight: 42, ...rest.style }}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          tabIndex={0}
          style={{
            position: "absolute",
            right: 4,
            top: "50%",
            transform: "translateY(-50%)",
            width: 34,
            height: 34,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--ink-muted)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          {visible ? (
            <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.6}>
              <path d="M3 3l18 18" />
              <path d="M10.6 5.1A10.6 10.6 0 0112 5c5 0 9.3 3.1 11 7-0.6 1.4-1.5 2.7-2.6 3.8M6.6 6.6C4.4 8 2.7 9.9 1 12c1.7 3.9 6 7 11 7 1.6 0 3.1-.3 4.5-.9" />
              <path d="M9.9 9.9a3 3 0 004.2 4.2" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.6}>
              <path d="M1 12c1.7-3.9 6-7 11-7s9.3 3.1 11 7c-1.7 3.9-6 7-11 7S2.7 15.9 1 12z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
});
