/**
 * Sovra Shared Design Tokens & Theme Definitions
 * Pure UI presentation logic. Contains zero cryptographic primitives or protocol couplings.
 */

export type ThemeMode = 'dark' | 'light' | 'system';

export interface ColorPalette {
  readonly primary: string;
  readonly secondary: string;
  readonly background: string;
  readonly surface: string;
  readonly border: string;
  readonly textPrimary: string;
  readonly textMuted: string;
  readonly error: string;
  readonly warning: string;
  readonly success: string;
}

export const DARK_THEME: ColorPalette = {
  primary: '#6366F1', // Indigo
  secondary: '#EC4899', // Pink
  background: '#0B0F17', // Deep slate
  surface: '#151D2C', // Elevated card
  border: '#233047', // Subtle border
  textPrimary: '#F8FAFC',
  textMuted: '#94A3B8',
  error: '#EF4444',
  warning: '#F59E0B',
  success: '#10B981',
} as const;

export interface ButtonProps {
  readonly variant: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  readonly size: 'sm' | 'md' | 'lg';
  readonly disabled?: boolean;
  readonly loading?: boolean;
}

export interface ModalProps {
  readonly isOpen: boolean;
  readonly title: string;
  readonly showCloseButton?: boolean;
}
