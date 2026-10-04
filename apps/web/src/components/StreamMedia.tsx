import { useEffect, useRef } from "react";

/** Native browser controls; the full HLS build supports separate audio streams. */
export function StreamMedia({ url, name, audio, onError }: { url: string; name: string; audio: boolean; onError: () => void }) {
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const errorHandler = useRef(onError); errorHandler.current = onError;
  useEffect(() => {
    const element = media.current; if (!element) return;
    let active = true, destroy: (() => void) | undefined;
    if (!new URL(url).hostname.endsWith(".seedr.cc")) element.src = url;
    else void import("hls.js").then(({ default: Hls }) => {
      if (!active) return;
      if (Hls.isSupported()) {
        // The light build omits separate audio renditions supplied by Seedr.
        const player = new Hls({ maxBufferLength: 15, maxMaxBufferLength: 30, backBufferLength: 15 });
        destroy = () => player.destroy();
        player.on(Hls.Events.ERROR, (_event, data) => { if (active && data.fatal) errorHandler.current(); });
        player.attachMedia(element); player.loadSource(url);
      } else if (element.canPlayType("application/vnd.apple.mpegurl")) element.src = url;
      else errorHandler.current();
    }).catch(() => { if (active) errorHandler.current(); });
    return () => {
      active = false; destroy?.();
      element.pause(); element.removeAttribute("src"); element.load();
    };
  }, [url]);
  const props = { ref: media, controls: true, preload: "metadata", "aria-label": name, onError };
  return <div className="video-stage">{audio ? <audio {...props}/> : <video {...props} playsInline/>}</div>;
}
