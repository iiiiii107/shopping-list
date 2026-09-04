/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { applyTheme, applySheetPalette, currentMode } from './theme.js';
import { splitPalette, withDefaults } from './storage.js';

function osIsDark(dark) {
  window.matchMedia = () => ({ matches: dark, addEventListener() {}, removeEventListener() {} });
}

beforeEach(() => {
  document.documentElement.removeAttribute('style');
  delete document.documentElement.dataset.theme;
  osIsDark(false);
});

const paper = () => document.documentElement.style.getPropertyValue('--paper');

describe('two palettes, one in force', () => {
  const both = { light: { paper: '#FFF4DC' }, dark: { paper: '#12261F' } };

  it('writes the light set by day and the dark set by night', () => {
    applyTheme({ theme: 'light', palette: both });
    expect(paper()).toBe('#FFF4DC');

    applyTheme({ theme: 'dark', palette: both });
    expect(paper()).toBe('#12261F');
  });

  /* The bug this whole change exists to fix: one flat palette was written onto
     <html> as an inline style, which beats both token blocks in tokens.css, so
     a cream page chosen by daylight was still cream at midnight. */
  it('leaves the theme you are not in completely alone', () => {
    applyTheme({ theme: 'dark', palette: { light: { paper: '#FFF4DC' }, dark: {} } });
    expect(paper()).toBe('');   // nothing written, so tokens.css decides
  });

  it('follows the operating system when the theme is System', () => {
    osIsDark(true);
    expect(currentMode({ theme: 'system' })).toBe('dark');
    applyTheme({ theme: 'system', palette: both });
    expect(paper()).toBe('#12261F');

    osIsDark(false);
    applyTheme({ theme: 'system', palette: both });
    expect(paper()).toBe('#FFF4DC');
  });

  it('an explicit choice beats the operating system', () => {
    osIsDark(true);
    expect(currentMode({ theme: 'light' })).toBe('light');
  });

  it('clearing a colour removes the property rather than blanking it', () => {
    applyTheme({ theme: 'light', palette: both });
    expect(paper()).toBe('#FFF4DC');
    applyTheme({ theme: 'light', palette: { light: {}, dark: {} } });
    expect(paper()).toBe('');
  });

  it('a sheet carries its own pair too', () => {
    const node = document.createElement('div');
    applySheetPalette(node, both, { theme: 'dark' });
    expect(node.style.getPropertyValue('--paper')).toBe('#12261F');
    applySheetPalette(node, both, { theme: 'light' });
    expect(node.style.getPropertyValue('--paper')).toBe('#FFF4DC');
  });
});

describe('palettes saved before there were two', () => {
  /* A flat palette applied to both themes at once. Copying it into both is
     the only migration that leaves someone's app looking how they left it. */
  it('a flat palette becomes the same colours in both', () => {
    expect(splitPalette({ paper: '#EEE', ink: '#111' })).toEqual({
      light: { paper: '#EEE', ink: '#111' },
      dark: { paper: '#EEE', ink: '#111' },
    });
  });

  it('a palette that is already split is left as it is', () => {
    const split = { light: { paper: '#AAA' }, dark: { paper: '#222' } };
    expect(splitPalette(split)).toEqual(split);
  });

  it('nothing at all is still valid', () => {
    expect(splitPalette(undefined)).toEqual({ light: {}, dark: {} });
  });

  it('lists saved with a flat palette are migrated on load', () => {
    const state = withDefaults({ lists: [{ id: 'a', title: 'Shop', palette: { paper: '#EEE' } }] });
    expect(state.lists[0].palette).toEqual({
      light: { paper: '#EEE' }, dark: { paper: '#EEE' },
    });
  });
});
