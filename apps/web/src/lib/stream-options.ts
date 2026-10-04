/** Label provider variants without inventing resolutions or transcoding. */
export function qualityChoices(levels: readonly { height?: number; bitrate?: number }[]): { index: number; label: string }[] {
  return levels.map((level, index) => {
    const resolution = Number.isFinite(level.height) && (level.height ?? 0) > 0 ? `${Math.round(level.height!)}p` : "";
    const bitrate = Number.isFinite(level.bitrate) && (level.bitrate ?? 0) > 0 ? `${(level.bitrate! / 1000000).toFixed(1)} Mbps` : "";
    return { index, label: resolution || bitrate || `Stream ${index + 1}` };
  }).map((choice, index, choices) => {
    if (choices.filter(other => other.label === choice.label).length < 2) return choice;
    const bitrate = levels[index].bitrate;
    return { ...choice, label: `${choice.label} · ${Number.isFinite(bitrate) && (bitrate ?? 0) > 0 ? `${(bitrate! / 1000000).toFixed(1)} Mbps` : `Stream ${index + 1}`}` };
  });
}
