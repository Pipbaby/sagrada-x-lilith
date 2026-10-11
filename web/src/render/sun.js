// Solar position for the basilica (NOAA approximation, good to a fraction of
// a degree) and the sun's colour and strength through the atmosphere.

import * as THREE from 'three';
import { LATITUDE, LONGITUDE, COMPASS } from '../building/plan.js';

const RAD = Math.PI / 180;

// Barcelona civil time: CET (UTC+1), CEST (UTC+2) from the last Sunday of
// March to the last Sunday of October.
function lastSunday(year, month) {
  const d = new Date(Date.UTC(year, month + 1, 0));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d;
}
export function barcelonaOffset(date) {
  const y = date.getUTCFullYear();
  const start = lastSunday(y, 2);
  start.setUTCHours(1);
  const end = lastSunday(y, 9);
  end.setUTCHours(1);
  return date >= start && date < end ? 2 : 1;
}

// dayOfYear 1…366, hours = local Barcelona clock time.
export function solarPosition(dayOfYear, hours, utcOffset) {
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (hours - 12) / 24);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const trueSolarMinutes = hours * 60 + eqTime + 4 * LONGITUDE - 60 * utcOffset;
  const hourAngle = (trueSolarMinutes / 4 - 180) * RAD;
  const lat = LATITUDE * RAD;
  const cosZenith = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle);
  const zenith = Math.acos(Math.min(1, Math.max(-1, cosZenith)));
  const elevation = Math.PI / 2 - zenith;
  let azimuth = Math.acos(Math.min(1, Math.max(-1, (Math.sin(lat) * Math.cos(zenith) - Math.sin(decl)) / (Math.cos(lat) * Math.sin(zenith)))));
  azimuth = hourAngle > 0 ? Math.PI + azimuth : Math.PI - azimuth; // clockwise from north
  return { elevation, azimuth };
}

// World-space unit vector pointing towards the sun.
export function sunDirection({ elevation, azimuth }, target = new THREE.Vector3()) {
  const [nx, nz] = COMPASS.north;
  const [ex, ez] = COMPASS.east;
  const h = Math.cos(elevation);
  const n = Math.cos(azimuth) * h;
  const e = Math.sin(azimuth) * h;
  return target.set(n * nx + e * ex, Math.sin(elevation), n * nz + e * ez).normalize();
}

// Direct-sun illuminance and colour after the atmosphere, plus sky radiance,
// in the renderer's units (clear-sky noon sun ≈ 10).
export function skyLight(elevation) {
  const el = Math.max(-0.1, elevation);
  const airMass = 1 / (Math.sin(Math.max(0.02, el)) + 0.50572 * Math.pow(Math.max(0.1, el / RAD + 6.07995), -1.6364));
  // Rayleigh-ish extinction per channel: low sun goes gold then red
  const tau = [0.1, 0.18, 0.38];
  const up = THREE.MathUtils.smoothstep(el, -0.05, 0.05);
  const sun = tau.map((t) => 10.5 * Math.exp(-t * airMass) * up);
  // clear sky: direct sun is ~20× the sky's radiance (100 klx vs ~5 kcd/m²)
  const skyStrength = 0.03 + 0.45 * THREE.MathUtils.smoothstep(el, -0.1, 0.6);
  const warm = 1 - THREE.MathUtils.smoothstep(el, 0.05, 0.5);
  const sky = [0.62 + 0.25 * warm, 0.74 + 0.05 * warm, 1.0 - 0.25 * warm].map((c) => c * skyStrength);
  return { sun: new THREE.Color(...sun), sky: new THREE.Color(...sky) };
}

export function dayOfYear(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  return Math.floor((date.getTime() - start) / 86400000);
}
