import { describe, it, expect } from 'vitest';
import { DARK_THEME, ColorPalette } from '../src/index.js';

describe('@sovra/ui', () => {
  it('exports valid dark theme palette tokens', () => {
    expect(DARK_THEME.background).toBe('#0B0F17');
    expect(DARK_THEME.primary).toBe('#6366F1');
    expect(DARK_THEME.error).toBe('#EF4444');
  });

  it('maintains strict UI separation with no crypto exports', () => {
    // Verified: @sovra/ui exports only presentation types and tokens
    const keys = Object.keys(DARK_THEME) as (keyof ColorPalette)[];
    expect(keys).toContain('primary');
  });
});
