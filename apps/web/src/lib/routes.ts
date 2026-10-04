export const screenNames = ["home", "progress", "files", "folder", "preview", "player", "storage", "storage-full", "settings", "about", "unavailable"] as const;
export type Screen = typeof screenNames[number];
export interface Route { screen: Screen; id?: string; entry?: string; section?: string; }
export function parseRoute(pathname: string, search = ""): Route {
  const [screen = "", id] = pathname.split("/").filter(Boolean);
  const params = new URLSearchParams(search);
  if (!screen) return { screen: "home" };
  if (!screenNames.includes(screen as Screen) || pathname.split("/").filter(Boolean).length > 2) return { screen: "unavailable" };
  return { screen: screen as Screen, id, entry: params.get("entry") ?? undefined, section: params.get("section") ?? undefined };
}
export function routeUrl(screen: Screen, id?: string, entry?: string) {
  return `${screen === "home" ? "/" : `/${screen}`}${id ? `/${encodeURIComponent(id)}` : ""}${entry ? `?entry=${encodeURIComponent(entry)}` : ""}`;
}
