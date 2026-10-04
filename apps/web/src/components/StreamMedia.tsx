import { useEffect, useRef, useState } from "react";
import type Hls from "hls.js";
import { qualityChoices } from "../lib/stream-options";

type Choice = { index: number; label: string };
type NativeAudioList = EventTarget & { length: number; [index: number]: { label: string; language: string; enabled: boolean } };
type NativeMedia = HTMLMediaElement & { audioTracks?: NativeAudioList };

/** Basic native playback, with only actual audio tracks and stream qualities. */
export function StreamMedia({ url, name, audio, onError }: { url: string; name: string; audio: boolean; onError: () => void }) {
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const hls = useRef<Hls | null>(null), errorHandler = useRef(onError); errorHandler.current = onError;
  const [audioTracks, setAudioTracks] = useState<Choice[]>([]), [audioTrack, setAudioTrack] = useState(-1);
  const [qualities, setQualities] = useState<Choice[]>([]), [quality, setQuality] = useState(-1);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const element = media.current; if (!element) return;
    let active = true; const native = element as NativeMedia;
    setAudioTracks([]); setAudioTrack(-1); setQualities([]); setQuality(-1); setNotice("");
    const syncTracks = () => {
      if (hls.current || !active) return;
      const tracks = native.audioTracks;
      setAudioTracks(tracks ? Array.from({ length: tracks.length }, (_, index) => ({ index, label: tracks[index].label || tracks[index].language || `Audio ${index + 1}` })) : []);
      if (tracks) setAudioTrack(Array.from({ length: tracks.length }, (_, i) => i).find(i => tracks[i].enabled) ?? -1);
    };
    element.addEventListener("loadedmetadata", syncTracks);
    native.audioTracks?.addEventListener("change", syncTracks); native.audioTracks?.addEventListener("addtrack", syncTracks);
    if (!new URL(url).hostname.endsWith(".seedr.cc")) element.src = url;
    else void import("hls.js").then(({ default: HlsPlayer }) => {
      if (!active) return;
      if (HlsPlayer.isSupported()) {
        // The light build omits separate audio streams. Keep the full build lazy.
        const player = new HlsPlayer({ maxBufferLength: 15, maxMaxBufferLength: 30, backBufferLength: 15 }); hls.current = player;
        player.on(HlsPlayer.Events.MANIFEST_PARSED, () => { if (active) setQualities(qualityChoices(player.levels)); });
        player.on(HlsPlayer.Events.AUDIO_TRACKS_UPDATED, () => { if (active) setAudioTracks(player.audioTracks.map((track, index) => ({ index, label: track.name || track.lang || `Audio ${index + 1}` }))); });
        player.on(HlsPlayer.Events.AUDIO_TRACK_SWITCHED, () => { if (active) setAudioTrack(player.audioTrack); });
        player.on(HlsPlayer.Events.ERROR, (_event, data) => {
          if (!active) return;
          if (data.fatal) errorHandler.current();
          else if (String(data.details).startsWith("audioTrackLoad")) setNotice("Audio could not load. Try another available track or retry playback.");
        });
        player.attachMedia(element); player.loadSource(url);
      } else if (element.canPlayType("application/vnd.apple.mpegurl")) element.src = url;
      else errorHandler.current();
    }).catch(() => { if (active) errorHandler.current(); });
    return () => {
      active = false; hls.current?.destroy(); hls.current = null;
      element.removeEventListener("loadedmetadata", syncTracks);
      native.audioTracks?.removeEventListener("change", syncTracks); native.audioTracks?.removeEventListener("addtrack", syncTracks);
      element.pause(); element.removeAttribute("src"); element.load();
    };
  }, [url]);
  const selectAudio = (index: number) => {
    if (!audioTracks.some(track => track.index === index)) return;
    if (hls.current) hls.current.audioTrack = index;
    else { const tracks = (media.current as NativeMedia | null)?.audioTracks; if (tracks) for (let i = 0; i < tracks.length; i++) tracks[i].enabled = i === index; }
    setAudioTrack(index); setNotice("");
  };
  const selectQuality = (index: number) => {
    if (!hls.current || (index !== -1 && !qualities.some(level => level.index === index))) return;
    hls.current.currentLevel = index; setQuality(index); setNotice("");
  };
  const props = { ref: media, controls: true, controlsList: "nodownload noplaybackrate", preload: "metadata", "aria-label": name, onError };
  return <div className="stream-player">
    <div className="video-stage">{audio ? <audio {...props}/> : <video {...props} playsInline disablePictureInPicture/>}</div>
    <div className="player-controls" aria-label="Stream options">
      <div className="player-options">
        <label>Audio<select aria-label="Audio track" value={audioTrack} disabled={audioTracks.length < 2} onChange={event => selectAudio(Number(event.target.value))}>{audioTracks.length ? audioTracks.map(track => <option value={track.index} key={track.index}>{track.label}</option>) : <option value={-1}>Default audio</option>}</select></label>
        {!audio && <label>Quality<select aria-label="Streaming quality" value={quality} disabled={qualities.length < 2} onChange={event => selectQuality(Number(event.target.value))}><option value={-1}>{qualities.length === 1 ? qualities[0].label : "Auto"}</option>{qualities.length > 1 && qualities.map(level => <option value={level.index} key={level.index}>{level.label}</option>)}</select></label>}
      </div>
      <p className="player-note">Only audio tracks and quality levels provided by the stream are available.</p>
      {notice && <p className="player-notice" role="status">{notice}</p>}
    </div>
  </div>;
}
