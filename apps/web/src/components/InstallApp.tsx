import { useState, useSyncExternalStore } from "react";
import { Download, RefreshCw, Smartphone } from "lucide-react";
import { applyAppUpdate, getInstallState, promptInstall, subscribeInstall } from "../lib/pwa";

export function InstallApp() {
  const state = useSyncExternalStore(subscribeInstall, getInstallState, getInstallState);
  const [help, setHelp] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  async function install() {
    if (!state.canPrompt) { setHelp(value => !value); return; }
    setBusy(true); setNotice("");
    try {
      const result = await promptInstall();
      if (result === "accepted") setNotice("Installation requested. Follow your browser’s confirmation.");
      else setHelp(true);
    } catch { setHelp(true); }
    finally { setBusy(false); }
  }
  return <section className="card install-card" aria-labelledby="install-title">
    <div className="install-heading"><Smartphone size={22} aria-hidden="true"/><div><h2 id="install-title">LinkBox app</h2><p>{state.standalone ? "You’re using the installed app." : "Keep LinkBox on your home screen or desktop."}</p></div></div>
    {!state.standalone && <button className="primary" onClick={() => { void install(); }} disabled={busy} aria-expanded={help}><Download size={18} aria-hidden="true"/>{busy ? "Opening installation…" : state.canPrompt ? "Install LinkBox" : "How to install"}</button>}
    {help && !state.standalone && <div className="install-help">
      <p><strong>Android:</strong> Open in Chrome, then choose Install app or Add to Home screen from its menu.</p>
      <p><strong>iPhone / iPad:</strong> Open in Safari, tap Share, then Add to Home Screen and Add.</p>
      <p><strong>Windows:</strong> Open in Edge or Chrome and use the address-bar install icon or the browser’s Install app menu.</p>
      <p>If installation is unavailable, keep using LinkBox in your browser. Installation requires HTTPS (or localhost); browser support varies.</p>
    </div>}
    {state.updateReady && <button className="secondary install-update" onClick={applyAppUpdate}><RefreshCw size={17} aria-hidden="true"/>Update app & reload</button>}
    <p className="install-note">Files and playback need internet. Only the app interface is cached—not your files, account details or media.</p>
    {state.registrationFailed && <p className="install-note">Offline setup was unavailable. You can still use LinkBox online.</p>}
    {notice && <p className="install-note" role="status">{notice}</p>}
  </section>;
}
