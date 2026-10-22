import { useEffect, useRef } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { useDoc, useEditor } from './store';
import { pauseAllVideos, syncVideosToTime } from './playback';

/** Deterministic preview timeline: animation is a pure function of the time value. */
export function Timeline() {
  const doc = useDoc();
  const time = useEditor((s) => s.time);
  const playing = useEditor((s) => s.playing);
  const st = useEditor.getState();
  const raf = useRef(0);
  const dur = doc.timeline.durationS;

  useEffect(() => {
    if (!playing) {
      pauseAllVideos();
      return;
    }
    const startT = useEditor.getState().time ?? 0;
    const t0 = performance.now() - (startT >= dur ? 0 : startT) * 1000;
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      if (t >= dur) {
        st.setTime(dur);
        st.setPlaying(false);
        return;
      }
      st.setTime(t);
      syncVideosToTime(useEditor.getState().history.present, t, true);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, dur]);

  useEffect(() => {
    const h = () => {
      const s = useEditor.getState();
      if (!s.playing && (s.time === null || s.time >= dur)) s.setTime(0);
      s.setPlaying(!s.playing);
    };
    window.addEventListener('rss:toggle-play', h);
    return () => window.removeEventListener('rss:toggle-play', h);
  }, [dur]);

  return (
    <div className="flex h-12 shrink-0 items-center gap-3 border-t border-ink-800 bg-ink-900 px-3" data-testid="timeline">
      <button
        className="btn btn-icon"
        aria-label={playing ? 'Pause' : 'Play animation'}
        onClick={() => {
          if (!playing && (time === null || time >= dur)) st.setTime(0);
          st.setPlaying(!playing);
        }}
      >
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <input
        type="range"
        aria-label="Timeline position"
        className="flex-1"
        min={0}
        max={dur}
        step={1 / doc.timeline.fps}
        value={time ?? dur}
        onChange={(e) => {
          st.setPlaying(false);
          st.setTime(parseFloat(e.target.value));
        }}
      />
      <span className="w-24 text-right text-xs text-ink-400 tabular-nums">
        {time === null ? 'Final frame' : `${time.toFixed(1)}s`} / {dur}s
      </span>
      <button
        className="btn btn-ghost btn-icon"
        title="Show the final (static) state"
        aria-label="Show final state"
        onClick={() => {
          st.setPlaying(false);
          st.setTime(null);
        }}
      >
        <RotateCcw size={15} />
      </button>
    </div>
  );
}
