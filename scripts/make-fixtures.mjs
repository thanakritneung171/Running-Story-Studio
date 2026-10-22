// Generates deterministic activity fixtures with known ground truth.
// Run: node scripts/make-fixtures.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { Encoder, Profile } from '@garmin/fitsdk';

const dir = new URL('../tests/fixtures/', import.meta.url);
mkdirSync(dir, { recursive: true });
const write = (name, data) => writeFileSync(new URL(name, dir), data);

const R = 6371008.8;
const M_PER_DEG_LAT = (Math.PI / 180) * R; // metres per degree of latitude
const T0 = Date.parse('2026-05-03T05:30:00Z');

// ---------- straight-5k: due north, 3 m/s, 1 Hz, 60 s stop at 2500 m ----------
// Ground truth: distance 5000 m, moving 1666.67 s, elapsed 1666.67 + 60 s,
// elevation climbs 0→50 m over first 2500 m then back to 0 (gain ≈ 50, loss ≈ 50).
function straight() {
  const pts = [];
  const lat0 = 13.73;
  const lon0 = 100.54;
  let t = 0;
  const speed = 3;
  const total = 5000;
  for (let d = 0; d <= total + 1e-9; d += speed) {
    const ele = d <= 2500 ? (d / 2500) * 50 : ((5000 - d) / 2500) * 50;
    pts.push({ lat: lat0 + d / M_PER_DEG_LAT, lon: lon0, ele, t: T0 + t * 1000, hr: 150, cad: 85 });
    if (Math.abs(d - 2499) < 1e-6 || (d < 2500 && d + speed > 2500 && pts.length && !pts.stopped)) {
      // stop: 60 s standing still
      if (!pts.stopped) {
        for (let s = 1; s <= 60; s++) pts.push({ ...pts[pts.length - 1], t: pts[pts.length - 1].t + 1000 });
        pts.stopped = true;
        t += 60;
      }
    }
    t += 1;
  }
  // final point exactly at 5000 m
  const last = pts[pts.length - 1];
  const lastD = (last.lat - lat0) * M_PER_DEG_LAT;
  if (lastD < total - 1e-6) {
    const dt = (total - lastD) / speed;
    pts.push({ lat: lat0 + total / M_PER_DEG_LAT, lon: lon0, ele: 0, t: last.t + dt * 1000, hr: 150, cad: 85 });
  }
  return pts;
}

const gpx = (name, pts, { time = true, ele = true, ext = true } = {}) => `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="fixture" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <metadata><name>${name}</name><time>${new Date(T0).toISOString()}</time></metadata>
  <trk><name>${name}</name><type>running</type><trkseg>
${pts
  .map(
    (p) =>
      `    <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">${ele ? `<ele>${p.ele.toFixed(2)}</ele>` : ''}${time ? `<time>${new Date(p.t).toISOString()}</time>` : ''}${ext ? `<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${p.hr}</gpxtpx:hr><gpxtpx:cad>${p.cad}</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions>` : ''}</trkpt>`,
  )
  .join('\n')}
  </trkseg></trk>
</gpx>
`;

const s = straight();
write('straight-5k.gpx', gpx('Straight 5K', s));
write('no-time.gpx', gpx('No timestamps', s.filter((_, i) => i % 10 === 0), { time: false, ext: false }));
write('no-elevation.gpx', gpx('No elevation', s.filter((_, i) => i % 10 === 0), { ele: false, ext: false }));

// ---------- loop: a realistic-looking 7.3 km park loop (used by e2e) ----------
function loop() {
  const pts = [];
  const c = { lat: 13.7307, lon: 100.5418 };
  const n = 1500;
  let t = T0;
  let prev;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 520 + 160 * Math.sin(3 * a) + 60 * Math.cos(5 * a);
    const x = Math.cos(a) * r * 1.3;
    const y = Math.sin(a) * r;
    const lat = c.lat + y / M_PER_DEG_LAT;
    const lon = c.lon + x / (M_PER_DEG_LAT * Math.cos((c.lat * Math.PI) / 180));
    if (prev) {
      const d = Math.hypot(x - prev.x, y - prev.y);
      const v = 3.1 + 0.4 * Math.sin(a * 2);
      t += (d / v) * 1000;
    }
    prev = { x, y };
    pts.push({ lat, lon, ele: 8 + 6 * Math.sin(a * 2) + 3 * Math.sin(a * 7), t, hr: Math.round(145 + 12 * Math.sin(a)), cad: 86 });
  }
  return pts;
}
const lp = loop();
write('park-loop.gpx', gpx('Lumpini Morning Loop', lp));

// ---------- malformed / unsupported ----------
write('malformed.gpx', '<?xml version="1.0"?><gpx><trk><trkseg><trkpt lat="1" lon="2"><ele>3</ele></trkpt></trkseg></trk>');
write('empty-track.gpx', '<?xml version="1.0"?><gpx version="1.1"><trk><name>Empty</name><trkseg></trkseg></trk></gpx>');
write('not-activity.gpx', 'just some text, not xml');
write('route-only.gpx', `<?xml version="1.0"?><gpx version="1.1"><rte><name>Planned</name>${s
  .filter((_, i) => i % 100 === 0)
  .map((p) => `<rtept lat="${p.lat}" lon="${p.lon}"/>`)
  .join('')}</rte></gpx>`);
// A GPX document saved with a .tcx extension
write('actually-gpx.tcx', gpx('Mislabelled', s.filter((_, i) => i % 10 === 0)));

// ---------- TCX (subset of straight track, 5 s sampling, with laps & calories) ----------
const tcxPts = s.filter((_, i) => i % 5 === 0 || i === s.length - 1);
const cum = (p) => (p.lat - s[0].lat) * M_PER_DEG_LAT;
write(
  'straight-5k.tcx',
  `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
<Activities><Activity Sport="Running"><Id>${new Date(T0).toISOString()}</Id>
<Lap StartTime="${new Date(T0).toISOString()}"><TotalTimeSeconds>1666.7</TotalTimeSeconds><DistanceMeters>5000</DistanceMeters><Calories>360</Calories><MaximumHeartRateBpm><Value>171</Value></MaximumHeartRateBpm>
<Track>
${tcxPts
  .map(
    (p) =>
      `<Trackpoint><Time>${new Date(p.t).toISOString()}</Time><Position><LatitudeDegrees>${p.lat.toFixed(7)}</LatitudeDegrees><LongitudeDegrees>${p.lon.toFixed(7)}</LongitudeDegrees></Position><AltitudeMeters>${p.ele.toFixed(2)}</AltitudeMeters><DistanceMeters>${cum(p).toFixed(2)}</DistanceMeters><HeartRateBpm><Value>${p.hr}</Value></HeartRateBpm><Extensions><ns3:TPX><ns3:RunCadence>${p.cad}</ns3:RunCadence></ns3:TPX></Extensions></Trackpoint>`,
  )
  .join('\n')}
</Track></Lap></Activity></Activities></TrainingCenterDatabase>
`,
);

// ---------- FIT (same track, 5 s sampling) ----------
{
  const SC = 2 ** 31 / 180;
  const enc = new Encoder();
  const start = new Date(T0);
  enc.onMesg(Profile.MesgNum.FILE_ID, { type: 'activity', manufacturer: 'development', product: 0, timeCreated: start, serialNumber: 1234 });
  for (const p of tcxPts) {
    enc.onMesg(Profile.MesgNum.RECORD, {
      timestamp: new Date(p.t),
      positionLat: Math.round(p.lat * SC),
      positionLong: Math.round(p.lon * SC),
      altitude: p.ele,
      distance: cum(p),
      heartRate: p.hr,
      cadence: p.cad,
    });
  }
  const end = new Date(tcxPts[tcxPts.length - 1].t);
  enc.onMesg(Profile.MesgNum.LAP, { timestamp: end, startTime: start, totalElapsedTime: (end - start) / 1000, totalTimerTime: 1666.7, totalDistance: 5000 });
  enc.onMesg(Profile.MesgNum.SESSION, {
    timestamp: end, startTime: start, sport: 'running', totalElapsedTime: (end - start) / 1000, totalTimerTime: 1666.7,
    totalDistance: 5000, totalCalories: 360, totalAscent: 50, totalDescent: 50, avgHeartRate: 150, maxHeartRate: 171,
  });
  enc.onMesg(Profile.MesgNum.ACTIVITY, { timestamp: end, numSessions: 1, type: 'manual', event: 'activity', eventType: 'stop' });
  write('straight-5k.fit', enc.close());
}
console.log('fixtures written');
