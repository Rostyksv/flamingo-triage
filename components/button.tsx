import type { ButtonHTMLAttributes, ReactNode } from "react";

type Props = {
  children: ReactNode;
  variant?: "primary" | "secondary" | "success" | "danger";
  size?: "sm" | "xs";
  pending?: boolean;
  className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className">;

const base =
  "inline-flex items-center justify-center rounded-md font-medium cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

const variants: Record<string, string> = {
  primary: "bg-slate-950 text-white hover:bg-slate-800",
  secondary:
    "border border-slate-300 text-slate-700 hover:bg-slate-50 bg-white",
  success: "bg-emerald-600 text-white hover:bg-emerald-700",
  danger: "bg-red-600 text-white hover:bg-red-700",
};

const sizes: Record<string, string> = {
  sm: "px-3 py-1.5 text-xs",
  xs: "px-2 py-1.5 text-xs",
};

export function Button({
  children,
  variant = "primary",
  size = "sm",
  pending = false,
  disabled,
  className = "",
  ...rest
}: Props) {
  return (
    <button
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled || pending}
      {...rest}
    >
      {pending && (
        <svg
          className="h-3 w-3 animate-spin mr-1"
          viewBox="0 0 24 24"
          fill="none"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      )}
      {children}
    </button>
  );
}
