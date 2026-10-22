import { useEffect } from 'react';
import { useEditor } from './store';
import { cmd } from '../../lib/editor/commands';

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const s = useEditor.getState();
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') {
        e.preventDefault();
        e.shiftKey ? s.redo() : s.undo();
      } else if (mod && k === 'y') {
        e.preventDefault();
        s.redo();
      } else if (mod && k === 'd') {
        e.preventDefault();
        s.duplicateSelected();
      } else if (mod && k === 'c') s.copy();
      else if (mod && k === 'v') {
        e.preventDefault();
        s.paste();
      } else if (mod && k === 's') {
        e.preventDefault();
        void s.saveNow();
      } else if (mod && k === 'a') {
        e.preventDefault();
        s.select(s.history.present.layers.filter((l) => !l.locked && l.visible).map((l) => l.id));
      } else if (k === 'delete' || k === 'backspace') {
        if (s.selection.length) {
          e.preventDefault();
          s.deleteSelected();
        }
      } else if (k === 'escape') s.select([]);
      else if (k.startsWith('arrow') && s.selection.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0;
        const dy = k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0;
        s.run('Nudge', cmd.move(s.selection, dx, dy), 'nudge');
      } else if (e.key === ']' && s.selection.length) s.run(mod ? 'Bring to front' : 'Bring forward', cmd.zOrder(s.selection, mod ? 'front' : 'forward'));
      else if (e.key === '[' && s.selection.length) s.run(mod ? 'Send to back' : 'Send backward', cmd.zOrder(s.selection, mod ? 'back' : 'backward'));
      else if (k === ' ' && !mod) {
        e.preventDefault();
        window.dispatchEvent(new Event('rss:toggle-play'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
