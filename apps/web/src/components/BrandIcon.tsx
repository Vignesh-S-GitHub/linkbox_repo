export type BrandIconName = "add" | "back" | "check" | "download" | "file" | "folder" | "info" | "link" | "more" | "play" | "preview" | "settings" | "share" | "storage" | "warning";
export function BrandIcon({ name, size = 20, className = "", variant = "default" }: { name: BrandIconName; size?: number; className?: string; variant?: "default" | "file" }) {
  const classes = `brand-ui-icon brand-ui-icon-${name} ${className}`;
  // The handoff's outline placeholders differ from the approved rendered mockup.
  // Use code-native versions here; keep the supplied files unchanged for provenance.
  if (name === "settings") return <svg className={classes} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <g fill="currentColor"><rect x="10.25" y="1" width="3.5" height="5.2" rx=".9"/><rect x="10.25" y="17.8" width="3.5" height="5.2" rx=".9"/><rect x="1" y="10.25" width="5.2" height="3.5" rx=".9"/><rect x="17.8" y="10.25" width="5.2" height="3.5" rx=".9"/>{[45,135,225,315].map(angle => <rect key={angle} x="10.25" y="1" width="3.5" height="5.2" rx=".9" transform={`rotate(${angle} 12 12)`}/>)}</g><circle cx="12" cy="12" r="7" fill="currentColor"/><circle cx="12" cy="12" r="3.2" fill="var(--lb-surface)"/>
  </svg>;
  if (name === "folder") return <svg className={`${classes} ${variant === "file" ? "folder-art" : ""}`} width={size} height={size} viewBox="0 0 32 28" fill="none" aria-hidden="true">
    <path d="M2 7V4.8C2 3.25 3.25 2 4.8 2h7.1l3.2 3.4h12.1C28.75 5.4 30 6.65 30 8.2v15C30 24.75 28.75 26 27.2 26H4.8C3.25 26 2 24.75 2 23.2V7Z" fill={variant === "file" ? "#FFBB31" : "currentColor"}/>
    <path d="M2 9.3C2 8 3 7 4.3 7h23.4C29 7 30 8 30 9.3v13.9c0 1.55-1.25 2.8-2.8 2.8H4.8C3.25 26 2 24.75 2 23.2V9.3Z" fill={variant === "file" ? "#FFD164" : "currentColor"}/>
    {variant === "file" && <path d="M4 9h24" stroke="#FFE49B" strokeWidth="1.2" strokeLinecap="round"/>}
  </svg>;
  if (name === "storage") return <svg className={classes} width={size} height={size} viewBox="0 0 28 30" fill="none" aria-hidden="true">
    <path d="M3 7v5c0 3 4.9 5.4 11 5.4S25 15 25 12V7M3 14v5c0 3 4.9 5.4 11 5.4S25 22 25 19v-5M3 21v2c0 3 4.9 5.4 11 5.4S25 26 25 23v-2" fill="currentColor" stroke="var(--lb-surface)" strokeWidth="1.2"/><ellipse cx="14" cy="6.5" rx="11" ry="5.2" fill="currentColor" stroke="var(--lb-surface)" strokeWidth="1.2"/>
  </svg>;
  if (name === "play") return <svg className={classes} width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7.5 4.75c-.65-.38-1.5.09-1.5.84v12.82c0 .75.85 1.22 1.5.84l11-6.41a.97.97 0 0 0 0-1.68l-11-6.41Z"/></svg>;
  return <img className={classes} src={`/brand/04_ui_icons/svg/${name}.svg`} width={size} height={size} alt="" aria-hidden="true"/>;
}
