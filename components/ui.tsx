import type { ButtonHTMLAttributes, HTMLAttributes } from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[1.75rem] border border-slate-200/80 bg-white/90 p-6 shadow-[0_18px_60px_-36px_rgba(15,23,42,0.45)] backdrop-blur-sm",
        className,
      )}
      {...props}
    />
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-gradient-to-r from-blue-600 via-blue-600 to-cyan-500 text-white shadow-[0_12px_30px_-16px_rgba(37,99,235,0.8)] hover:-translate-y-0.5 hover:from-blue-700 hover:to-cyan-600",
  secondary:
    "border border-slate-200 bg-white text-slate-800 shadow-sm hover:-translate-y-0.5 hover:border-blue-200 hover:bg-blue-50/60 hover:text-blue-700",
  ghost: "bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-950",
  danger:
    "border border-red-200 bg-red-50 text-red-700 hover:-translate-y-0.5 hover:border-red-300 hover:bg-red-100",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "rounded-xl px-3.5 py-2 text-sm",
  md: "rounded-xl px-5 py-3 text-sm",
  lg: "rounded-2xl px-6 py-3.5 text-base",
};

export function Button({ className, variant = "primary", size = "md", ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 font-semibold transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  );
}
