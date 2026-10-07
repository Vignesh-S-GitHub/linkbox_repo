import { ChevronRight } from "lucide-react";
import { Brand } from "../components/Brand";
import { BrandIcon, type BrandIconName } from "../components/BrandIcon";
import type { Screen } from "../lib/routes";
import { useEffect, useState } from "react";
import { InstallApp } from "../components/InstallApp";
import { readAppearance, writeBrowserValue } from "../lib/browser-storage";

export function SettingsPage({ go }: { go: (screen: Screen, id?: string, entry?: string, section?: string) => void }) {
  const [theme, setTheme] = useState(readAppearance);
  useEffect(() => { document.documentElement.dataset.theme = theme; writeBrowserValue("linkbox-appearance", theme); }, [theme]);
  return <div className="settings-page">
    <section className="card appearance"><h2>Appearance</h2>{["system", "light", "dark"].map(value => <label key={value}><input type="radio" name="appearance" checked={theme === value} onChange={() => setTheme(value)}/>{value[0].toUpperCase() + value.slice(1)}</label>)}</section>
    <div className="menu-card">{([
      ["storage", "Storage", "storage", undefined], ["info", "Accounts", "accounts", undefined], ["info", "About LinkBox", "about", undefined],
      ["info", "How it works", "about", "how"], ["file", "Privacy", "about", "privacy"],
    ] as const).map(([icon, title, screen, section]) => <button key={title} onClick={() => go(screen, undefined, undefined, section)}><BrandIcon name={icon}/><span>{title}</span><ChevronRight size={17}/></button>)}</div>
    <InstallApp/>
    <footer className="version"><Brand/><small>Version 1.0.0</small></footer>
  </div>;
}
const topics: { id: string; icon: BrandIconName; title: string; body: string }[] = [
  { id: "how", icon: "info", title: "How it works", body: "Paste a magnet link and LinkBox temporarily fetches and stores available files. When ready, open, play or download your file." },
  { id: "temporary", icon: "file", title: "Temporary storage", body: "Files are automatically removed after 24 hours. Scheduled cleanup runs hourly, so removal may take up to one additional cleanup cycle. Save anything you need before then." },
  { id: "shared", icon: "share", title: "Shared storage", body: "The browser that added a download can delete it anytime. Other users must wait 3 hours; after that, anyone can delete the whole download. All files expire after 24 hours. The Storage page shows the connected capacity. One download must fit within one storage account; free space cannot be combined for a single file." },
  { id: "support", icon: "file", title: "File support", body: "Video, audio, images, PDF, documents, archives, folders and other downloadable files. Browsing and previews depend on the storage service’s supported capabilities." },
  { id: "playback", icon: "play", title: "Playback and preview", body: "Supported media opens in a native player. Other files remain downloadable. In mock mode, playback uses a small externally hosted CC0 sample and downloads are synthetic text fixtures, not the original media." },
  { id: "important", icon: "warning", title: "Important", body: "LinkBox is temporary shared storage, not a backup. Only add content you are authorized to access. Everyone using this shared space can see the file list." },
  { id: "privacy", icon: "info", title: "Privacy", body: "No registration is required. A random browser identifier is saved locally for request limits and creator-only deletion; keep it private. Clearing browser data loses immediate deletion access, but shared deletion remains available after 3 hours. File names, magnet hashes and lifecycle metadata are stored by the backend. No email, phone number or location is collected. Storage credentials are never sent to your browser." },
];
export function AboutPage({ section }: { section?: string }) {
  return <div className="about-page"><div className="about-logo"><Brand large/></div><div className="menu-card info-topics">{topics.filter(topic => topic.id !== "privacy" || section === "privacy").map(topic => <details key={`${topic.id}-${section}`} open={topic.id === section}><summary><BrandIcon name={topic.icon}/><span>{topic.title}</span><ChevronRight size={17}/></summary><p>{topic.body}</p></details>)}</div></div>;
}
