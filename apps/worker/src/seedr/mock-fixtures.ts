import type { FileEntry } from "@temporary-share/shared";
import type { DownloadRow } from "../types";

const gib = 1024 ** 3;
const mib = 1024 ** 2;
/** Names and sizes from the repository's approved 12-screen reference. */
export function mockRows(now = Date.now()): DownloadRow[] {
  const fixtures = [
    ["Sample Video.mkv", 1.4 * gib, "downloading", .1, "seedr-b", 68],
    ["Project Files", 2.8 * gib, "fetching_metadata", 5, "seedr-a", 24],
    ["User Guide.pdf", 24 * mib, "ready", 4, "seedr-b", 100],
    ["Photo Collection", .6 * gib, "ready", 1, "seedr-a", 100],
    ["Audio Sample.mp3", 18 * mib, "ready", 2, "seedr-b", 100],
  ] as const;
  return fixtures.map(([name, size, status, hours, account, progress], index) => {
    const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    const created = now - hours * 3600000;
    return { id, publicId: id, seedrAccountId: account, seedrItemId: `mock-fixture-${index + 1}`,
      magnetHash: `fixture-${index + 1}`, displayName: name, sizeBytes: Math.round(size), status, progress,
      createdAt: new Date(created).toISOString(), cleanupAllowedAt: new Date(created + 3 * 3600000).toISOString(),
      expiresAt: new Date(created + 24 * 3600000).toISOString(), deletedAt: null, errorMessage: null,
      cleanupClaimedAt: null, playable: /\.(mkv|mp3)$/.test(name) };
  });
}

export const projectEntries: FileEntry[] = [
  { id: "video", displayName: "video.mp4", sizeBytes: Math.round(1.4 * gib), kind: "video", playable: true, preview: null },
  { id: "document", displayName: "document.pdf", sizeBytes: 12 * mib, kind: "pdf", playable: false, preview: "guide" },
  { id: "photos", displayName: "photos.zip", sizeBytes: 800 * mib, kind: "archive", playable: false, preview: null },
  { id: "notes", displayName: "notes.txt", sizeBytes: 4 * 1024, kind: "text", playable: false, preview: null },
  { id: "sheet", displayName: "sheet.xlsx", sizeBytes: 24 * 1024, kind: "sheet", playable: false, preview: null },
  { id: "presentation", displayName: "presentation.pptx", sizeBytes: 12 * mib, kind: "presentation", playable: false, preview: null },
  { id: "music", displayName: "music.mp3", sizeBytes: 18 * mib, kind: "audio", playable: true, preview: null },
];
