import { describe, expect, it } from 'vitest';
import { canBePlaceholder, placeholderUrl, realTabUrl, restoreUrls } from './browser-placeholder';

describe('placeholder tabs', () => {
  it('restores the first tab for real, every other web tab as a placeholder', () => {
    expect(
      restoreUrls([
        { title: 'A', url: 'https://a.com/' },
        { title: 'B', url: 'https://b.com/' },
        { title: 'Settings', url: 'chrome://settings/' },
      ]),
    ).toEqual(['https://a.com/', placeholderUrl('https://b.com/', 'B'), 'chrome://settings/']);
  });

  it('round-trips the real URL, so an unvisited tab is saved as the tab it stands for', () => {
    const url = 'https://example.com/a?b=1&c="2"#x';
    expect(realTabUrl(placeholderUrl(url, 'Example'))).toBe(url);
  });

  it('can’t be broken out of by a hostile title or URL', () => {
    const url = 'https://example.com/</script><script>alert(1)</script>';
    const page = decodeURIComponent(placeholderUrl(url, '</title><script>alert(2)</script>'));
    expect(page.match(/<script>/g)).toHaveLength(1);
    expect(page.match(/<\/script>/g)).toHaveLength(1);
    expect(page).not.toContain('<script>alert');
    expect(realTabUrl(placeholderUrl(url, 'x'))).toBe(url);
  });

  it('shows the real title while unloaded, falling back to the URL', () => {
    expect(decodeURIComponent(placeholderUrl('https://a.com', 'Docs'))).toContain(
      '<title>Docs</title>',
    );
    expect(decodeURIComponent(placeholderUrl('https://a.com', ''))).toContain(
      '<title>https://a.com</title>',
    );
  });

  it('only stands in for web pages — a page can’t navigate to chrome:// itself', () => {
    expect(canBePlaceholder('https://a.com')).toBe(true);
    expect(canBePlaceholder('http://a.com')).toBe(true);
    expect(canBePlaceholder('chrome://settings')).toBe(false);
    expect(canBePlaceholder('file:///tmp/x.html')).toBe(false);
  });

  it('leaves every other URL alone, including someone else’s data: page', () => {
    expect(realTabUrl('https://a.com')).toBe('https://a.com');
    expect(realTabUrl('data:text/html;charset=utf-8,%3Ch1%3Ehi%3C%2Fh1%3E')).toBe(
      'data:text/html;charset=utf-8,%3Ch1%3Ehi%3C%2Fh1%3E',
    );
    expect(realTabUrl('data:text/html;charset=utf-8,%E0%A4%A')).toBe(
      'data:text/html;charset=utf-8,%E0%A4%A',
    );
  });
});
