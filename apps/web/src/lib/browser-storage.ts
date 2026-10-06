/** Storage can be blocked in private browsing or by browser policy. */
export function readBrowserValue(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function writeBrowserValue(key: string, value: string): boolean {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}
export function readAppearance(): string {
  const value = readBrowserValue("linkbox-appearance");
  return value && ["light", "dark", "system"].includes(value) ? value : "light";
}
