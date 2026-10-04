import { useEffect, useRef } from "react";

/** Keep native controls; lazy-load HLS only for real Seedr streams. */
export function StreamMedia({ url, name, audio, onError }: { url: string; name: string; audio: boolean; onError: () => void }) {
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const errorHandler = useRef(onError);
  errorHandler.current = onError;
  useEffect(() => {
    const element = media.current; if (!element) return;
    let active = true; let destroy: (() => void) | undefined;
    if (!new URL(url).hostname.endsWith(".seedr.cc")) element.src = url;
    else void import("hls.js/light").then(({ default: Hls }) => {
      if (!active) return;
      if (Hls.isSupported()) {
        const hls = new Hls({ maxBufferLength: 15, maxMaxBufferLength: 30, backBufferLength: 15 });
        destroy = () => hls.destroy();
        hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) errorHandler.current(); });
        hls.attachMedia(element); hls.loadSource(url);
      } else if (element.canPlayType("application/vnd.apple.mpegurl")) element.src = url;
      else errorHandler.current();
    }).catch(() => errorHandler.current());
    return () => { active = false; destroy?.(); element.pause(); element.removeAttribute("src"); element.load(); };
  }, [url]);
  const props = { ref: media, controls: true, preload: "metadata", "aria-label": name, onError };
  return audio ? <audio {...props}/> : <video {...props} playsInline/>;
}
