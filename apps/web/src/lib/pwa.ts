interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
export interface InstallState { standalone: boolean; canPrompt: boolean; updateReady: boolean; registrationFailed: boolean; }
let state: InstallState = { standalone: false, canPrompt: false, updateReady: false, registrationFailed: false };
let promptEvent: InstallEvent | null = null;
let registration: ServiceWorkerRegistration | null = null;
let started = false, reloadRequested = false;
const listeners = new Set<() => void>();
function publish(changes: Partial<InstallState>) { state = { ...state, ...changes }; for (const listener of listeners) listener(); }
export const getInstallState = () => state;
export const subscribeInstall = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Start before React mounts so a browser install event cannot be missed. */
export function startPwa(production: boolean) {
  if (started) return;
  started = true;
  const display = window.matchMedia("(display-mode: standalone)");
  const syncDisplay = () => publish({ standalone: display.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true });
  syncDisplay(); display.addEventListener("change", syncDisplay);
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault(); promptEvent = event as InstallEvent; publish({ canPrompt: true });
  });
  window.addEventListener("appinstalled", () => { promptEvent = null; publish({ canPrompt: false }); });
  if (!production || !window.isSecureContext || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // Never unexpectedly interrupt a video or an in-flight submission.
    if (reloadRequested) window.location.reload();
  });
  const register = async () => {
    try {
      registration = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      const syncUpdate = () => publish({ updateReady: Boolean(registration?.waiting) });
      syncUpdate();
      registration.addEventListener("updatefound", () => registration?.installing?.addEventListener("statechange", syncUpdate));
    } catch { publish({ registrationFailed: true }); }
  };
  if (document.readyState === "complete") void register();
  else window.addEventListener("load", () => { void register(); }, { once: true });
}
export async function promptInstall(): Promise<"accepted" | "dismissed" | "manual"> {
  const event = promptEvent;
  if (!event) return "manual";
  promptEvent = null; publish({ canPrompt: false });
  await event.prompt();
  return (await event.userChoice).outcome;
}
export function applyAppUpdate() {
  if (!registration?.waiting) return;
  reloadRequested = true;
  registration.waiting.postMessage({ type: "SKIP_WAITING" });
}
