export const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index < 3 ? 0 : 1)} ${units[index]}`;
};
export const relativeTime = (iso: string, now = Date.now()): string => {
  const seconds = Math.max(0, Math.floor((new Date(iso).getTime() - now) / 1000));
  if (seconds < 60) return "less than a minute";
  const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h${minutes ? ` ${minutes}m` : ""}` : `${minutes}m`;
};
export const age = (iso: string): string => {
  const hours = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 3600000));
  return hours ? `${hours}h ago` : "just now";
};
