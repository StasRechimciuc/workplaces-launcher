import { describe, expect, it } from 'vitest';
import { sanitizeComposeProjectName } from './compose-project-name';

describe('sanitizeComposeProjectName', () => {
  it('lowercases a simple directory name', () => {
    expect(sanitizeComposeProjectName('~/projects/MyApp')).toBe('myapp');
  });

  it('replaces illegal characters with a hyphen', () => {
    expect(sanitizeComposeProjectName('/Users/stas/My App (2)')).toBe('my-app--2-');
  });

  it('strips a trailing slash before extracting the basename', () => {
    expect(sanitizeComposeProjectName('/Users/stas/projects/my-app/')).toBe('my-app');
  });

  it('strips leading non-alphanumeric characters', () => {
    expect(sanitizeComposeProjectName('/Users/stas/projects/-my-app')).toBe('my-app');
  });

  it('falls back to "project" when nothing alphanumeric remains', () => {
    expect(sanitizeComposeProjectName('/Users/stas/projects/___')).toBe('project');
  });

  it('falls back to "project" for an empty or root-only path', () => {
    expect(sanitizeComposeProjectName('')).toBe('project');
    expect(sanitizeComposeProjectName('/')).toBe('project');
  });

  it('keeps already-legal characters (lowercase, digits, hyphen, underscore) unchanged', () => {
    expect(sanitizeComposeProjectName('/Users/stas/my_app-2')).toBe('my_app-2');
  });
});
