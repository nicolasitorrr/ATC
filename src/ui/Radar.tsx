import { useEffect, useRef } from 'react';
import { findRunway } from '../sim/airports';
import type { Aircraft, Sim } from '../sim/engine';
import { DEG, project } from '../sim/geo';

interface Props {
  sim: Sim;
  selected: string | null;
  onSelect: (callsign: string | null) => void;
}

interface View {
  /** pixels per nautical mile; 0 until the first layout */
  scale: number;
  cx: number;
  cy: number;
}

const COLORS = {
  bg: '#0a1215',
  ring: '#15262c',
  boundary: '#2a4a55',
  fix: '#4f7482',
  runway: '#d8e2e6',
  ils: '#2f6f80',
  active: '#7cfc9a',
  pending: '#8fa3ad',
  handed: '#4d626c',
  selected: '#5ad1ff',
  warning: '#ffd24a',
  conflict: '#ff4d4d',
  emergency: '#ff9a3c',
};

function colorOf(a: Aircraft): string {
  if (a.conflict) return COLORS.conflict;
  if (a.emergency) return COLORS.emergency;
  if (a.warning) return COLORS.warning;
  if (a.status === 'active') return COLORS.active;
  return a.status === 'pending' ? COLORS.pending : COLORS.handed;
}

export function Radar({ sim, selected, onSelect }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef<View>({ scale: 0, cx: 0, cy: 0 });
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const g = canvas.getContext('2d')!;
    let frame = 0;

    const draw = () => {
      frame = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const v = view.current;
      if (!v.scale) v.scale = Math.min(w, h) / (2 * (sim.airport.radiusNm + 4));
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const sx = (x: number) => w / 2 + (x - v.cx) * v.scale;
      const sy = (y: number) => h / 2 - (y - v.cy) * v.scale;
      const ap = sim.airport;

      g.fillStyle = COLORS.bg;
      g.fillRect(0, 0, w, h);

      // range rings and sector boundary
      g.lineWidth = 1;
      g.strokeStyle = COLORS.ring;
      for (let r = 10; r < ap.radiusNm; r += 10) {
        g.beginPath();
        g.arc(sx(0), sy(0), r * v.scale, 0, Math.PI * 2);
        g.stroke();
      }
      g.strokeStyle = COLORS.boundary;
      g.setLineDash([6, 6]);
      g.beginPath();
      g.arc(sx(0), sy(0), ap.radiusNm * v.scale, 0, Math.PI * 2);
      g.stroke();

      // final approach course with 5 NM ticks
      const arr = findRunway(ap, ap.arrivalRunway)!;
      const far = project(arr.thrX, arr.thrY, arr.heading + 180, 18);
      g.strokeStyle = COLORS.ils;
      g.beginPath();
      g.moveTo(sx(arr.thrX), sy(arr.thrY));
      g.lineTo(sx(far.x), sy(far.y));
      g.stroke();
      g.setLineDash([]);
      for (let d = 5; d <= 15; d += 5) {
        const p = project(arr.thrX, arr.thrY, arr.heading + 180, d);
        const a = project(p.x, p.y, arr.heading + 90, 0.6);
        const b = project(p.x, p.y, arr.heading - 90, 0.6);
        g.beginPath();
        g.moveTo(sx(a.x), sy(a.y));
        g.lineTo(sx(b.x), sy(b.y));
        g.stroke();
      }

      // runways
      g.strokeStyle = COLORS.runway;
      g.lineWidth = 3;
      for (const r of ap.runways) {
        const end = project(r.thrX, r.thrY, r.heading, r.lengthNm);
        g.beginPath();
        g.moveTo(sx(r.thrX), sy(r.thrY));
        g.lineTo(sx(end.x), sy(end.y));
        g.stroke();
      }
      g.lineWidth = 1;

      // fixes
      g.font = '10px ui-monospace, Consolas, monospace';
      g.fillStyle = COLORS.fix;
      g.strokeStyle = COLORS.fix;
      for (const f of ap.fixes) {
        const x = sx(f.x);
        const y = sy(f.y);
        g.beginPath();
        if (f.kind === 'vor') g.rect(x - 3, y - 3, 6, 6);
        else {
          g.moveTo(x, y - 4);
          g.lineTo(x + 4, y + 3);
          g.lineTo(x - 4, y + 3);
          g.closePath();
        }
        g.stroke();
        g.fillText(f.name, x + 6, y + 3);
      }

      // aircraft
      g.font = '11px ui-monospace, Consolas, monospace';
      for (const a of sim.aircraft) {
        const isSelected = a.callsign === selectedRef.current;
        const color = colorOf(a);
        const x = sx(a.x);
        const y = sy(a.y);
        g.fillStyle = color;
        g.strokeStyle = color;

        g.globalAlpha = 0.45;
        for (const p of a.history) g.fillRect(sx(p.x) - 1, sy(p.y) - 1, 2, 2);
        g.globalAlpha = 1;

        // one-minute leader along the ground track
        const lead = (a.gs / 60) * v.scale;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.sin(a.track * DEG) * lead, y - Math.cos(a.track * DEG) * lead);
        g.stroke();
        g.fillRect(x - 3, y - 3, 6, 6);

        if (isSelected) {
          g.strokeStyle = COLORS.selected;
          g.beginPath();
          g.arc(x, y, 11, 0, Math.PI * 2);
          g.stroke();
        }

        const fl = String(Math.round(a.alt / 100)).padStart(3, '0');
        const tgt = String(Math.round(a.tgtAlt / 100)).padStart(3, '0');
        const trend = Math.abs(a.tgtAlt - a.alt) < 100 ? '=' : a.tgtAlt > a.alt ? '↑' : '↓';
        const info = a.kind === 'departure' ? (a.exitFix ?? '') : a.ilsRunway ? `ILS${a.established ? '*' : ''}` : 'ARR';
        g.fillStyle = isSelected ? COLORS.selected : color;
        g.fillText(a.callsign + (a.emergency ? ' EMG' : ''), x + 12, y - 16);
        g.fillText(`${fl}${trend}${tgt} ${String(Math.round(a.gs / 10)).padStart(2, '0')}`, x + 12, y - 5);
        g.fillText(`${a.type} ${info}`, x + 12, y + 6);
      }
    };
    frame = requestAnimationFrame(draw);

    // pan, zoom and select
    let drag: { x: number; y: number; moved: boolean } | null = null;
    const onDown = (e: PointerEvent) => {
      drag = { x: e.clientX, y: e.clientY, moved: false };
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (!drag.moved) return;
      view.current.cx -= dx / view.current.scale;
      view.current.cy += dy / view.current.scale;
      drag.x = e.clientX;
      drag.y = e.clientY;
    };
    const onUp = (e: PointerEvent) => {
      const wasClick = drag && !drag.moved;
      drag = null;
      if (!wasClick) return;
      const rect = canvas.getBoundingClientRect();
      const v = view.current;
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      let best: Aircraft | null = null;
      let bestD = 20;
      for (const a of sim.aircraft) {
        const d = Math.hypot(rect.width / 2 + (a.x - v.cx) * v.scale - px, rect.height / 2 - (a.y - v.cy) * v.scale - py);
        if (d < bestD) {
          best = a;
          bestD = d;
        }
      }
      onSelect(best ? best.callsign : null);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = view.current;
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left - rect.width / 2;
      const py = e.clientY - rect.top - rect.height / 2;
      const next = Math.min(80, Math.max(3, v.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      // keep the point under the cursor fixed
      v.cx += px / v.scale - px / next;
      v.cy -= py / v.scale - py / next;
      v.scale = next;
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      cancelAnimationFrame(frame);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [sim, onSelect]);

  return <canvas ref={canvasRef} className="radar" />;
}
