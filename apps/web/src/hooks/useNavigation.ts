import { useEffect, useState } from "react";
import { parseRoute, routeUrl, type Screen } from "../lib/routes";

export function useNavigation() {
  const [route, setRoute] = useState(() => parseRoute(location.pathname, location.search));
  useEffect(() => {
    const onPop = () => setRoute(parseRoute(location.pathname, location.search));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const go = (screen: Screen, id?: string, entry?: string, section?: string) => {
    const path = routeUrl(screen, id, entry) + (section ? `?section=${encodeURIComponent(section)}` : "");
    history.pushState(null, "", path);
    setRoute(parseRoute(location.pathname, location.search));
    window.scrollTo({ top: 0 });
  };
  return { route, go };
}
