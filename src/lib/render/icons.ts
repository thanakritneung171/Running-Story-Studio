import {
  Activity as ActivityIcon, Clock, Flag, Flame, Footprints, Heart, MapPin, Medal, Mountain, Route, Star, Sun, Timer,
  Trophy, Zap, Gauge, Sunrise, Moon, Wind, CloudRain,
} from 'lucide';

type IconNode = [string, Record<string, string | number>][];

/** Stroke icons (from the ISC-licensed Lucide set) available as icon layers. */
export const ICONS: Record<string, IconNode> = {
  'map-pin': MapPin as IconNode,
  flag: Flag as IconNode,
  clock: Clock as IconNode,
  timer: Timer as IconNode,
  heart: Heart as IconNode,
  mountain: Mountain as IconNode,
  zap: Zap as IconNode,
  flame: Flame as IconNode,
  route: Route as IconNode,
  trophy: Trophy as IconNode,
  medal: Medal as IconNode,
  footprints: Footprints as IconNode,
  star: Star as IconNode,
  sun: Sun as IconNode,
  sunrise: Sunrise as IconNode,
  moon: Moon as IconNode,
  wind: Wind as IconNode,
  rain: CloudRain as IconNode,
  gauge: Gauge as IconNode,
  activity: ActivityIcon as IconNode,
};
export const ICON_NAMES = Object.keys(ICONS);

const cache = new Map<string, Path2D>();

/** Convert an icon definition into one Path2D in a 24×24 coordinate space. */
export function iconPath(name: string): Path2D | null {
  const hit = cache.get(name);
  if (hit) return hit;
  const node = ICONS[name];
  if (!node || typeof Path2D === 'undefined') return null;
  const path = new Path2D();
  const n = (v: unknown) => Number(v ?? 0);
  for (const [tag, a] of node) {
    if (tag === 'path') path.addPath(new Path2D(String(a.d)));
    else if (tag === 'circle') {
      path.moveTo(n(a.cx) + n(a.r), n(a.cy));
      path.arc(n(a.cx), n(a.cy), n(a.r), 0, Math.PI * 2);
    } else if (tag === 'ellipse') {
      path.moveTo(n(a.cx) + n(a.rx), n(a.cy));
      path.ellipse(n(a.cx), n(a.cy), n(a.rx), n(a.ry), 0, 0, Math.PI * 2);
    } else if (tag === 'line') {
      path.moveTo(n(a.x1), n(a.y1));
      path.lineTo(n(a.x2), n(a.y2));
    } else if (tag === 'rect') {
      const p = new Path2D();
      p.roundRect(n(a.x), n(a.y), n(a.width), n(a.height), n(a.rx));
      path.addPath(p);
    } else if (tag === 'polyline' || tag === 'polygon') {
      const nums = String(a.points).trim().split(/[\s,]+/).map(Number);
      for (let i = 0; i < nums.length; i += 2) (i === 0 ? path.moveTo : path.lineTo).call(path, nums[i], nums[i + 1]);
      if (tag === 'polygon') path.closePath();
    }
  }
  cache.set(name, path);
  return path;
}
