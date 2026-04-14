import { useEffect, useRef } from 'react';
import { useAppContext } from '../store/AppContext';

// ─── Particle system that reacts to mouse position ────────────────────────

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  opacity: number;
  pulsePhase: number;
  pulseSpeed: number;
}

const DARK_PARTICLE_COLOR  = '0,229,255';
const LIGHT_PARTICLE_COLOR = '0,100,200';
const DARK_GRID_COLOR      = 'rgba(0,229,255,0.04)';
const LIGHT_GRID_COLOR     = 'rgba(0,80,180,0.05)';
const DARK_LINE_COLOR      = 'rgba(0,229,255,';
const LIGHT_LINE_COLOR     = 'rgba(0,80,180,';
const PARTICLE_COUNT       = 80;
const CONNECTION_DISTANCE  = 120;
const MOUSE_RADIUS         = 180;
const MOUSE_STRENGTH       = 0.012;
const DAMPING              = 0.92;
const MAX_SPEED            = 0.8;
const GRID_SIZE            = 48;

export default function AnimatedBackground() {
  const { state } = useAppContext();
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const mouseRef   = useRef({ x: -9999, y: -9999 });
  const rafRef     = useRef<number>(0);
  const isDark     = state.theme === 'dark';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let particles: Particle[] = [];

    function initParticles() {
      particles = Array.from({ length: PARTICLE_COUNT }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        radius: 1 + Math.random() * 1.5,
        opacity: 0.2 + Math.random() * 0.5,
        pulsePhase: Math.random() * Math.PI * 2,
        pulseSpeed: 0.01 + Math.random() * 0.02,
      }));
    }

    function resize() {
      w = canvas!.width  = window.innerWidth;
      h = canvas!.height = window.innerHeight;
      initParticles();
    }

    function onMouseMove(e: MouseEvent) {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    }

    function drawGrid() {
      ctx!.strokeStyle = isDark ? DARK_GRID_COLOR : LIGHT_GRID_COLOR;
      ctx!.lineWidth = 0.5;
      ctx!.beginPath();
      for (let x = 0; x <= w; x += GRID_SIZE) {
        ctx!.moveTo(x, 0);
        ctx!.lineTo(x, h);
      }
      for (let y = 0; y <= h; y += GRID_SIZE) {
        ctx!.moveTo(0, y);
        ctx!.lineTo(w, y);
      }
      ctx!.stroke();
    }

    function frame() {
      ctx!.clearRect(0, 0, w, h);

      // Background fill
      ctx!.fillStyle = isDark ? '#050a14' : '#eef2f7';
      ctx!.fillRect(0, 0, w, h);

      drawGrid();

      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;
      const pc = isDark ? DARK_PARTICLE_COLOR : LIGHT_PARTICLE_COLOR;
      const lc = isDark ? DARK_LINE_COLOR     : LIGHT_LINE_COLOR;

      // Update + draw particles
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        // Mouse attraction
        const dx = mx - p.x;
        const dy = my - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < MOUSE_RADIUS && dist > 0) {
          const force = (1 - dist / MOUSE_RADIUS) * MOUSE_STRENGTH;
          p.vx += (dx / dist) * force;
          p.vy += (dy / dist) * force;
        }

        // Damping
        p.vx *= DAMPING;
        p.vy *= DAMPING;

        // Speed cap
        const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        if (speed > MAX_SPEED) {
          p.vx = (p.vx / speed) * MAX_SPEED;
          p.vy = (p.vy / speed) * MAX_SPEED;
        }

        // Move
        p.x += p.vx;
        p.y += p.vy;

        // Wrap edges
        if (p.x < 0)  p.x += w;
        if (p.x > w)  p.x -= w;
        if (p.y < 0)  p.y += h;
        if (p.y > h)  p.y -= h;

        // Pulse opacity
        p.pulsePhase += p.pulseSpeed;
        const pulsed = p.opacity * (0.7 + 0.3 * Math.sin(p.pulsePhase));

        // Draw particle
        const glowRadius = p.radius * 4;
        const grad = ctx!.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowRadius);
        grad.addColorStop(0, `rgba(${pc},${pulsed})`);
        grad.addColorStop(0.4, `rgba(${pc},${pulsed * 0.3})`);
        grad.addColorStop(1, `rgba(${pc},0)`);

        ctx!.beginPath();
        ctx!.arc(p.x, p.y, glowRadius, 0, Math.PI * 2);
        ctx!.fillStyle = grad;
        ctx!.fill();

        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(${pc},${pulsed})`;
        ctx!.fill();
      }

      // Draw connections between nearby particles
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const pi = particles[i];
          const pj = particles[j];
          const dx = pi.x - pj.x;
          const dy = pi.y - pj.y;
          const d  = Math.sqrt(dx * dx + dy * dy);
          if (d < CONNECTION_DISTANCE) {
            const alpha = (1 - d / CONNECTION_DISTANCE) * 0.18;
            ctx!.strokeStyle = `${lc}${alpha})`;
            ctx!.lineWidth = 0.6;
            ctx!.beginPath();
            ctx!.moveTo(pi.x, pi.y);
            ctx!.lineTo(pj.x, pj.y);
            ctx!.stroke();
          }
        }
      }

      rafRef.current = requestAnimationFrame(frame);
    }

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', onMouseMove);
    rafRef.current = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMouseMove);
    };
  }, [isDark]);

  return (
    <canvas
      ref={canvasRef}
      className="animated-bg"
      aria-hidden="true"
    />
  );
}
