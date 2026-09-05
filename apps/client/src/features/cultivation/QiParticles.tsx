import { useEffect, useRef } from 'react';
import { MAX_QI_PARTICLES } from '../../config';

interface Mote {
  x: number;
  y: number;
  r: number;
  drift: number;
  speed: number;
  alpha: number;
}

/**
 * Ambient 灵气 drifting upward behind the cultivator.
 *
 * Canvas rather than DOM nodes so sixty motes cost one composite layer. Under
 * `prefers-reduced-motion` the field is painted once and left still.
 */
export function QiParticles({ tone = 'day' }: { tone?: 'day' | 'night' }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    const count = reduced ? 26 : coarse ? Math.round(MAX_QI_PARTICLES * 0.6) : MAX_QI_PARTICLES;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const ink = tone === 'night' ? '201, 160, 99' : '59, 95, 107';

    let width = 0;
    let height = 0;
    let motes: Mote[] = [];

    const seed = (mote: Mote): Mote => ({
      ...mote,
      x: Math.random() * width,
      y: height + Math.random() * height * 0.5,
    });

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      motes = Array.from({ length: count }, () =>
        seed({
          x: 0,
          y: 0,
          r: 0.8 + Math.random() * 1.9,
          drift: (Math.random() - 0.5) * 0.22,
          speed: 0.12 + Math.random() * 0.34,
          alpha: 0.16 + Math.random() * 0.4,
        }),
      );
      if (reduced) {
        motes = motes.map((m) => ({ ...m, y: Math.random() * height }));
      }
    };

    const paint = () => {
      context.clearRect(0, 0, width, height);
      for (const mote of motes) {
        context.beginPath();
        context.arc(mote.x, mote.y, mote.r, 0, Math.PI * 2);
        context.fillStyle = `rgba(${ink}, ${mote.alpha})`;
        context.fill();
      }
    };

    resize();
    paint();

    if (reduced) {
      window.addEventListener('resize', resize);
      return () => window.removeEventListener('resize', resize);
    }

    let frame = 0;
    const step = () => {
      for (const mote of motes) {
        mote.y -= mote.speed;
        mote.x += mote.drift;
        if (mote.y < -6) {
          mote.y = height + 6;
          mote.x = Math.random() * width;
        }
      }
      paint();
      frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    window.addEventListener('resize', resize);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
    };
  }, [tone]);

  return <canvas ref={canvasRef} className="cultivation__particles" aria-hidden="true" />;
}
