import React, { useEffect, useRef, useState, useMemo } from 'react';
import { CyberPiInputs, DisplayMode, BallPhysicsState } from '../simulator/types.ts';
import { updateBallPhysics, calculateLedHues, formatTelemetryPacket } from '../simulator/engine.ts';
import { Monitor, Gamepad2, Compass, BarChart3, Radio, Home } from 'lucide-react';

interface CyberPiChassisProps {
  inputs: CyberPiInputs;
  onInputChange: (newInputs: Partial<CyberPiInputs>) => void;
  onEmitTelemetry?: (packetJson: string) => void;
  displayMode?: DisplayMode;
  onDisplayModeChange?: (mode: DisplayMode) => void;
  externalHomePressed?: boolean;
}

const MODE_ORDER: DisplayMode[] = [
  'spectrum_eq',
  'dashboard',
  'bouncing_ball',
  'imu_horizon',
  'rgb_rainbow'
];

export const CyberPiChassis: React.FC<CyberPiChassisProps> = ({
  inputs,
  onInputChange,
  onEmitTelemetry,
  displayMode: controlledDisplayMode,
  onDisplayModeChange,
  externalHomePressed
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [internalDisplayMode, setInternalDisplayMode] = useState<DisplayMode>('spectrum_eq');
  const displayMode = controlledDisplayMode ?? internalDisplayMode;
  const setDisplayMode = (next: DisplayMode | ((prev: DisplayMode) => DisplayMode)) => {
    const resolved = typeof next === 'function' ? next(displayMode) : next;
    setInternalDisplayMode(resolved);
    onDisplayModeChange?.(resolved);
  };

  const [tick, setTick] = useState(0);
  const [homePressed, setHomePressed] = useState(false);

  // Peak hold state for spectrum EQ mode
  const eqPeaksRef = useRef<number[]>([0.74, 0.58, 0.48, 0.62, 0.78]);

  // Ball physics state for bouncing ball demo
  const ballRef = useRef<BallPhysicsState>({
    x: 64,
    y: 64,
    vx: 2.2,
    vy: 1.8,
    radius: 4,
    color: '#facc15'
  });

  // Calculate 5-LED RGB strip hues
  const ledHues = calculateLedHues(tick, 5);

  const cycleDisplayMode = () => {
    setHomePressed(true);
    const idx = MODE_ORDER.indexOf(displayMode);
    setDisplayMode(MODE_ORDER[(idx + 1) % MODE_ORDER.length]);
    window.setTimeout(() => setHomePressed(false), 180);
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;

      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          onInputChange({ joyY: -1 });
          break;
        case 'ArrowDown':
          e.preventDefault();
          onInputChange({ joyY: 1 });
          break;
        case 'ArrowLeft':
          e.preventDefault();
          onInputChange({ joyX: -1 });
          break;
        case 'ArrowRight':
          e.preventDefault();
          onInputChange({ joyX: 1 });
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          onInputChange({ joyCenter: true });
          break;
        case 'a':
        case 'A':
          onInputChange({ btnA: true });
          break;
        case 'b':
        case 'B':
          onInputChange({ btnB: true });
          break;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;

      switch (e.key) {
        case 'ArrowUp':
        case 'ArrowDown':
          onInputChange({ joyY: 0 });
          break;
        case 'ArrowLeft':
        case 'ArrowRight':
          onInputChange({ joyX: 0 });
          break;
        case 'Enter':
        case ' ':
          onInputChange({ joyCenter: false });
          break;
        case 'a':
        case 'A':
          onInputChange({ btnA: false });
          break;
        case 'b':
        case 'B':
          onInputChange({ btnB: false });
          break;
      }
    };

    const handleBlur = () => {
      onInputChange({ btnA: false, btnB: false, joyX: 0, joyY: 0, joyCenter: false });
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [onInputChange]);

  // Main 128x128 ST7735 TFT Canvas Render Loop
  useEffect(() => {
    let animId: number;
    let frameCounter = 0;

    const render = () => {
      frameCounter++;
      setTick(frameCounter);

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Base Display background
      ctx.fillStyle = '#060910';
      ctx.fillRect(0, 0, 128, 128);

      if (displayMode === 'spectrum_eq') {
        // --- 1. Signature 5-Column Segmented EQ Visualizer ---
        const baseHeights = [0.68, 0.56, 0.46, 0.58, 0.72];
        const barColors = [
          ['#93c5fd', '#60a5fa'],
          ['#a5b4fc', '#818cf8'],
          ['#f0abfc', '#c084fc'],
          ['#fb7185', '#f43f5e'],
          ['#fb923c', '#f97316']
        ];

        const maxSegments = 26;
        const barWidth = 14;
        const startX = 13;
        const gapX = 22;
        const bottomY = 117;

        for (let i = 0; i < 5; i++) {
          const phase = frameCounter * 0.09 + i * 1.15;
          const wave = Math.sin(phase) * 0.12 + Math.cos(phase * 0.6) * 0.06;
          const tiltBias = inputs.joyX * ((i - 2) * 0.12);
          const heightScale = -inputs.joyY * 0.18;
          const buttonBoost = (inputs.btnA ? 0.18 : 0) + (inputs.btnB ? 0.14 : 0);

          const rawLevel = Math.max(
            0.14,
            Math.min(1.0, baseHeights[i] + wave + tiltBias + heightScale + buttonBoost)
          );

          if (inputs.joyCenter) {
            eqPeaksRef.current[i] = 0.25;
          } else if (rawLevel > eqPeaksRef.current[i]) {
            eqPeaksRef.current[i] = rawLevel;
          } else {
            eqPeaksRef.current[i] = Math.max(rawLevel, eqPeaksRef.current[i] - 0.008);
          }

          const activeSegments = Math.max(2, Math.round(rawLevel * maxSegments));
          const x = startX + i * gapX;
          const [topCol, botCol] = barColors[i];

          for (let s = 0; s < activeSegments; s++) {
            const y = bottomY - s * 3 - 2;
            ctx.fillStyle = s > activeSegments * 0.65 ? topCol : botCol;
            ctx.fillRect(x, y, barWidth, 2);
          }

          const peakSeg = Math.min(maxSegments, Math.round(eqPeaksRef.current[i] * maxSegments));
          const peakY = bottomY - peakSeg * 3 - 2;
          ctx.fillStyle = '#f8fafc';
          ctx.fillRect(x, peakY, barWidth, 1);
        }

        ctx.fillStyle = '#64748b';
        ctx.font = '7px monospace';
        ctx.fillText('CyberOS EQ', 6, 12);
        if (inputs.btnA) {
          ctx.fillStyle = '#ef4444';
          ctx.fillRect(82, 5, 16, 10);
          ctx.fillStyle = '#ffffff';
          ctx.fillText('A', 87, 13);
        }
        if (inputs.btnB) {
          ctx.fillStyle = '#3b82f6';
          ctx.fillRect(102, 5, 16, 10);
          ctx.fillStyle = '#ffffff';
          ctx.fillText('B', 107, 13);
        }
      } else if (displayMode === 'dashboard') {
        // --- 2. CyberOS System Diagnostics ---
        ctx.fillStyle = '#0284c7';
        ctx.fillRect(0, 0, 128, 15);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 8px monospace';
        ctx.fillText('CyberOS v1.0.4', 4, 11);

        ctx.strokeStyle = '#22c55e';
        ctx.strokeRect(108, 4, 14, 7);
        ctx.fillStyle = '#22c55e';
        ctx.fillRect(110, 6, 9, 3);
        ctx.fillRect(122, 6, 2, 3);

        ctx.fillStyle = '#94a3b8';
        ctx.font = '7px monospace';
        ctx.fillText('SoC: ESP32-WROVER-B', 4, 27);
        ctx.fillText('ROM: 8MB | RAM: 8MB', 4, 37);

        ctx.fillStyle = '#38bdf8';
        ctx.fillText(`JOY: [X:${inputs.joyX} Y:${inputs.joyY}]`, 4, 49);
        ctx.fillText(`CENTER: ${inputs.joyCenter ? 'PRESSED' : 'RELEASED'}`, 4, 59);

        ctx.fillStyle = inputs.btnA ? '#ef4444' : '#475569';
        ctx.fillRect(4, 65, 29, 12);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(`A:${inputs.btnA ? 'ON' : '0'}`, 8, 74);

        ctx.fillStyle = inputs.btnB ? '#3b82f6' : '#475569';
        ctx.fillRect(36, 65, 29, 12);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(`B:${inputs.btnB ? 'ON' : '0'}`, 40, 74);

        ctx.strokeStyle = '#1e293b';
        ctx.strokeRect(70, 65, 52, 48);
        ctx.beginPath();
        ctx.moveTo(96, 65);
        ctx.lineTo(96, 113);
        ctx.moveTo(70, 89);
        ctx.lineTo(122, 89);
        ctx.stroke();

        const joyDotX = 96 + inputs.joyX * 18;
        const joyDotY = 89 + inputs.joyY * 18;
        ctx.fillStyle = inputs.joyCenter ? '#10b981' : '#38bdf8';
        ctx.beginPath();
        ctx.arc(joyDotX, joyDotY, 3.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 117, 128, 11);
        ctx.fillStyle = '#22c55e';
        ctx.fillText('UART 115200 OK', 4, 125);
      } else if (displayMode === 'bouncing_ball') {
        // --- 3. Retro Arcade Bouncing Ball ---
        ballRef.current = updateBallPhysics(ballRef.current, inputs, { width: 128, height: 128 });
        const b = ballRef.current;

        ctx.strokeStyle = '#131b2e';
        ctx.lineWidth = 1;
        for (let x = 0; x < 128; x += 16) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, 128);
          ctx.stroke();
        }
        for (let y = 0; y < 128; y += 16) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(128, y);
          ctx.stroke();
        }

        ctx.shadowBlur = 8;
        ctx.shadowColor = b.color;
        ctx.fillStyle = b.color;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.fillStyle = '#ffffff';
        ctx.font = '7px monospace';
        ctx.fillText(`Pos: [${Math.round(b.x)}, ${Math.round(b.y)}]`, 4, 10);
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('Move: Joystick | Color: A/B', 4, 122);
      } else if (displayMode === 'imu_horizon') {
        // --- 4. 6-Axis IMU Artificial Horizon ---
        ctx.save();
        ctx.translate(64, 64);
        const rollAngle = inputs.joyX * 0.45;
        const pitchOffset = inputs.joyY * 26;
        ctx.rotate(rollAngle);

        ctx.fillStyle = '#0284c7';
        ctx.fillRect(-70, -70 + pitchOffset, 140, 70);
        ctx.fillStyle = '#78350f';
        ctx.fillRect(-70, 0 + pitchOffset, 140, 70);

        ctx.strokeStyle = '#f8fafc';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-60, pitchOffset);
        ctx.lineTo(60, pitchOffset);
        ctx.stroke();
        ctx.restore();

        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(48, 64);
        ctx.lineTo(60, 64);
        ctx.moveTo(68, 64);
        ctx.lineTo(80, 64);
        ctx.arc(64, 64, 3, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = '7px monospace';
        ctx.fillText('6-Axis IMU (MPU6050)', 4, 10);
        ctx.fillText(`Roll: ${(inputs.joyX * 25).toFixed(1)} deg`, 4, 114);
        ctx.fillText(`Pitch: ${(inputs.joyY * 18).toFixed(1)} deg`, 4, 123);
      } else if (displayMode === 'rgb_rainbow') {
        // --- 5. RGB Light Spectrum Wave ---
        for (let x = 0; x < 128; x += 4) {
          const wave = Math.sin((x + frameCounter * 3) * 0.08) * 35;
          const hue = (x * 2.8 + frameCounter * 4) % 360;
          ctx.fillStyle = `hsl(${hue}, 95%, 60%)`;
          ctx.fillRect(x, 64 + wave - 12, 3, 24);
        }

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 8px monospace';
        ctx.fillText('CyberPi NeoPixels', 20, 20);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '7px monospace';
        ctx.fillText('5-Ch AW9523B LED Wave', 14, 118);
      }

      // Periodically emit telemetry JSON
      if (frameCounter % 30 === 0 && onEmitTelemetry) {
        const rawJson = formatTelemetryPacket(frameCounter, inputs, frameCounter * 33);
        onEmitTelemetry(rawJson);
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [displayMode, inputs, onEmitTelemetry]);

  const ledGradient = useMemo(() => {
    const stops = ledHues.map((hue, idx) => {
      const pct = Math.round((idx / Math.max(1, ledHues.length - 1)) * 100);
      return `hsl(${hue}, 95%, 56%) ${pct}%`;
    });
    return `linear-gradient(90deg, ${stops.join(', ')})`;
  }, [ledHues]);

  return (
    <div className="w-full flex flex-col items-center">
      {/* Horizontal Smoked-Polycarbonate CyberPi Chassis (Styled in Dark UI Aesthetic, Reshaped to Real CyberPi Form) */}
      <div className="relative w-full max-w-[560px] rounded-[20px] bg-gradient-to-b from-zinc-800/95 via-zinc-900 to-zinc-950 p-3 sm:p-4 pb-6 border-2 border-zinc-600/75 shadow-2xl shadow-cyan-950/30 select-none overflow-hidden">
        {/* Top Acrylic Rim Highlight */}
        <div className="absolute inset-x-4 top-0.5 h-[1px] bg-gradient-to-r from-transparent via-white/30 to-transparent pointer-events-none" />

        {/* Subtle Smoked-Shell PCB Trace & SMD Micro-Artwork Layer */}
        <svg
          className="absolute inset-0 w-full h-full opacity-20 pointer-events-none"
          viewBox="0 0 560 230"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <g stroke="#94a3b8" strokeWidth="1" fill="none">
            <path d="M18 28 H95 L110 42 H140" />
            <path d="M18 36 H88 L102 50 H135" />
            <path d="M22 182 H118 L130 168" />
            <path d="M325 32 H395 L410 46 H470" />
            <path d="M325 186 H445 L460 172 H495" />
            <path d="M415 110 H475" />
            <path d="M415 120 H475" />
          </g>
          <g fill="#cbd5e1">
            <rect x="24" y="20" width="6" height="4" rx="1" />
            <rect x="34" y="20" width="6" height="4" rx="1" />
            <rect x="44" y="20" width="10" height="5" rx="1" />
            <rect x="336" y="24" width="8" height="4" rx="1" />
            <rect x="348" y="24" width="8" height="4" rx="1" />
            <rect x="415" y="24" width="12" height="6" rx="1" />
            <rect x="415" y="182" width="14" height="5" rx="1" />
            <circle cx="132" cy="24" r="3" />
            <circle cx="468" cy="26" r="3" />
          </g>
        </svg>

        {/* Top Silkscreen Metadata Row */}
        <div className="relative z-10 flex items-center justify-between px-1 mb-2">
          <span className="text-[9px] font-mono tracking-widest text-zinc-400 uppercase">
            Makeblock · CyberPi
          </span>
          <span className="text-[9px] font-mono text-zinc-500">
            ESP32-WROVER-B
          </span>
        </div>

        {/* Main Horizontal Hardware Deck: [Joystick Dish] [128x128 TFT Screen] [Square B / Triangle A] [Home + USB-C + Pins] */}
        <div className="relative z-10 flex items-center gap-1.5 sm:gap-3.5">
          {/* 1. LEFT: Circular Recessed 5-Way Joystick Dish */}
          <div className="w-[21%] max-w-[122px] shrink-0 flex flex-col items-center">
            <div className="relative w-full aspect-square rounded-full bg-gradient-to-br from-zinc-700/75 via-zinc-900 to-zinc-950 border-2 border-zinc-500/65 shadow-[inset_0_5px_14px_rgba(0,0,0,0.85)] flex items-center justify-center">
              {/* Up Hitbox */}
              <button
                type="button"
                onPointerDown={() => onInputChange({ joyY: -1 })}
                onPointerUp={() => onInputChange({ joyY: 0 })}
                onPointerLeave={() => onInputChange({ joyY: 0 })}
                onPointerCancel={() => onInputChange({ joyY: 0 })}
                title="Joystick Up (ArrowUp)"
                aria-label="Joystick Up"
                className={`absolute top-0.5 left-[28%] w-[44%] h-[28%] rounded-t-full flex items-start justify-center pt-0.5 text-[7px] sm:text-[9px] transition-colors cursor-pointer z-20 ${
                  inputs.joyY === -1 ? 'text-cyan-400' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                ▲
              </button>

              {/* Down Hitbox */}
              <button
                type="button"
                onPointerDown={() => onInputChange({ joyY: 1 })}
                onPointerUp={() => onInputChange({ joyY: 0 })}
                onPointerLeave={() => onInputChange({ joyY: 0 })}
                onPointerCancel={() => onInputChange({ joyY: 0 })}
                title="Joystick Down (ArrowDown)"
                aria-label="Joystick Down"
                className={`absolute bottom-0.5 left-[28%] w-[44%] h-[28%] rounded-b-full flex items-end justify-center pb-0.5 text-[7px] sm:text-[9px] transition-colors cursor-pointer z-20 ${
                  inputs.joyY === 1 ? 'text-cyan-400' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                ▼
              </button>

              {/* Left Hitbox */}
              <button
                type="button"
                onPointerDown={() => onInputChange({ joyX: -1 })}
                onPointerUp={() => onInputChange({ joyX: 0 })}
                onPointerLeave={() => onInputChange({ joyX: 0 })}
                onPointerCancel={() => onInputChange({ joyX: 0 })}
                title="Joystick Left (ArrowLeft)"
                aria-label="Joystick Left"
                className={`absolute left-0.5 top-[28%] w-[28%] h-[44%] rounded-l-full flex items-center justify-start pl-0.5 sm:pl-1 text-[7px] sm:text-[9px] transition-colors cursor-pointer z-20 ${
                  inputs.joyX === -1 ? 'text-cyan-400' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                ◀
              </button>

              {/* Right Hitbox */}
              <button
                type="button"
                onPointerDown={() => onInputChange({ joyX: 1 })}
                onPointerUp={() => onInputChange({ joyX: 0 })}
                onPointerLeave={() => onInputChange({ joyX: 0 })}
                onPointerCancel={() => onInputChange({ joyX: 0 })}
                title="Joystick Right (ArrowRight)"
                aria-label="Joystick Right"
                className={`absolute right-0.5 top-[28%] w-[28%] h-[44%] rounded-r-full flex items-center justify-end pr-0.5 sm:pr-1 text-[7px] sm:text-[9px] transition-colors cursor-pointer z-20 ${
                  inputs.joyX === 1 ? 'text-cyan-400' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                ▶
              </button>

              {/* Matte Light-Grey / Off-White Circular Thumbstick Cap */}
              <button
                type="button"
                onPointerDown={() => onInputChange({ joyCenter: true })}
                onPointerUp={() => onInputChange({ joyCenter: false })}
                onPointerLeave={() => onInputChange({ joyCenter: false })}
                onPointerCancel={() => onInputChange({ joyCenter: false })}
                title="Joystick Center Press (Enter / Space)"
                aria-label="Joystick Center Button"
                style={{
                  transform: `translate(${inputs.joyX * 16}%, ${inputs.joyY * 16}%) scale(${
                    inputs.joyCenter ? 0.9 : 1
                  })`
                }}
                className={`relative z-10 w-[56%] h-[56%] rounded-full bg-gradient-to-b from-zinc-100 via-zinc-200 to-zinc-400 border border-white/80 shadow-[0_4px_10px_rgba(0,0,0,0.7),inset_0_2px_3px_rgba(255,255,255,0.9)] transition-transform duration-75 cursor-pointer flex items-center justify-center ${
                  inputs.joyCenter
                    ? 'ring-2 ring-emerald-400 shadow-[0_0_14px_rgba(16,185,129,0.7)]'
                    : inputs.joyX !== 0 || inputs.joyY !== 0
                      ? 'ring-2 ring-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.65)]'
                      : ''
                }`}
              >
                <span className="w-[62%] h-[62%] rounded-full border border-zinc-300/60 bg-gradient-to-br from-white/50 to-transparent pointer-events-none" />
              </button>
            </div>
          </div>

          {/* 2. CENTER-LEFT: 1.44-inch 128x128 Color TFT Display + Vertical Divider Pipe */}
          <div className="flex-1 min-w-0 flex items-center justify-center gap-1.5 sm:gap-2">
            <div className="relative w-full max-w-[184px] bg-black p-1 sm:p-2 rounded-lg sm:rounded-xl border-2 border-zinc-600/80 shadow-[inset_0_2px_10px_rgba(0,0,0,0.95)] overflow-hidden">
              <canvas
                ref={canvasRef}
                width={128}
                height={128}
                className="w-full aspect-square block rounded-[3px] border border-zinc-800/80"
                style={{ imageRendering: 'pixelated' }}
                aria-label="Makeblock CyberPi 128x128 Color TFT Display"
              />
              <div className="absolute inset-x-2 top-2 h-10 bg-gradient-to-b from-white/10 to-transparent pointer-events-none rounded-t" />
            </div>

            {/* Translucent Acrylic Divider Rib */}
            <div
              className="hidden sm:block w-1.5 h-32 rounded-full bg-gradient-to-b from-zinc-500/35 via-amber-300/20 to-zinc-700/35 border border-zinc-600/50 shrink-0"
              aria-hidden="true"
            />
          </div>

          {/* 3. CENTER-RIGHT: Stacked Square Button B (Top) & Triangle Button A (Bottom) */}
          <div className="w-[14%] max-w-[74px] shrink-0 flex flex-col items-center justify-center gap-1.5 sm:gap-3">
            {/* Button B: Rounded Square Keycap */}
            <div className="p-0.5 sm:p-1 rounded-lg sm:rounded-xl bg-zinc-800/80 border border-zinc-600/70 shadow-inner">
              <button
                type="button"
                onPointerDown={() => onInputChange({ btnB: true })}
                onPointerUp={() => onInputChange({ btnB: false })}
                onPointerLeave={() => onInputChange({ btnB: false })}
                onPointerCancel={() => onInputChange({ btnB: false })}
                title="Button B — Square ('B' key / AW9523B P0.5)"
                aria-label="Button B"
                className={`w-7 h-7 sm:w-11 sm:h-11 rounded-md sm:rounded-lg bg-gradient-to-b from-zinc-100 via-zinc-200 to-zinc-300 border border-white/85 text-zinc-700 font-bold text-xs shadow-[0_3px_6px_rgba(0,0,0,0.6),inset_0_1px_2px_rgba(255,255,255,0.95)] flex items-center justify-center transition-transform duration-75 cursor-pointer ${
                  inputs.btnB ? 'scale-90 ring-2 ring-blue-400 brightness-105' : 'hover:brightness-105'
                }`}
              >
                <span className="font-mono text-[9px] sm:text-[11px] font-bold text-zinc-600">B</span>
              </button>
            </div>

            {/* Button A: Rounded Right-Triangle Keycap */}
            <div className="p-0.5 sm:p-1 rounded-lg sm:rounded-xl bg-zinc-800/80 border border-zinc-600/70 shadow-inner">
              <button
                type="button"
                onPointerDown={() => onInputChange({ btnA: true })}
                onPointerUp={() => onInputChange({ btnA: false })}
                onPointerLeave={() => onInputChange({ btnA: false })}
                onPointerCancel={() => onInputChange({ btnA: false })}
                title="Button A — Triangle ('A' key / AW9523B P0.6)"
                aria-label="Button A"
                className={`relative w-7 h-7 sm:w-11 sm:h-11 flex items-center justify-center transition-transform duration-75 cursor-pointer ${
                  inputs.btnA ? 'scale-90 drop-shadow-[0_0_8px_rgba(244,63,94,0.85)]' : 'hover:brightness-105'
                }`}
              >
                <svg viewBox="0 0 48 48" className="w-full h-full drop-shadow-[0_3px_5px_rgba(0,0,0,0.65)]">
                  <defs>
                    <linearGradient id="cyberpi-tri-btn" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f4f4f5" />
                      <stop offset="55%" stopColor="#e4e4e7" />
                      <stop offset="100%" stopColor="#cbd5e1" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M10 8 C10 4.5, 13.5 3, 16.5 4.8 L41 19.5 C44 21.3, 44 26.7, 41 28.5 L16.5 43.2 C13.5 45, 10 43.5, 10 40 Z"
                    fill="url(#cyberpi-tri-btn)"
                    stroke={inputs.btnA ? '#fb7185' : '#ffffff'}
                    strokeWidth={inputs.btnA ? '2.6' : '1.4'}
                  />
                </svg>
                <span className="absolute left-[38%] font-mono text-[9px] sm:text-[11px] font-bold text-zinc-600 pointer-events-none">
                  A
                </span>
              </button>
            </div>
          </div>

          {/* 4. FAR-RIGHT: HOME Button, USB-C Port & mBot2 Expansion Header (S2/S1/M2/M1) */}
          <div className="w-[17%] max-w-[82px] shrink-0 flex items-stretch gap-1 sm:gap-1.5 self-stretch py-0.5">
            {/* Home + USB-C Column */}
            <div className="flex-1 flex flex-col items-center justify-between py-0.5 sm:py-1 border-l border-zinc-800/90 pl-1 sm:pl-1.5">
              {/* HOME Tactile Button */}
              <div className="flex flex-col items-center gap-0.5 sm:gap-1">
                <button
                  type="button"
                  onClick={cycleDisplayMode}
                  title="HOME Button — Switch TFT Mode"
                  aria-label="Home Button Switch Display Mode"
                  className={`w-4 h-4 sm:w-6 sm:h-6 rounded-full bg-gradient-to-b from-zinc-200 to-zinc-400 border border-white/75 shadow-md flex items-center justify-center transition-transform duration-100 cursor-pointer ${
                    homePressed || externalHomePressed ? 'scale-90 ring-2 ring-amber-400' : 'hover:ring-1 hover:ring-amber-300/70'
                  }`}
                >
                  <span className="w-1.5 h-1.5 sm:w-2.5 sm:h-2.5 rounded-full border border-zinc-500/60 bg-zinc-100/60" />
                </button>
                <span className="text-[5.5px] sm:text-[7px] font-mono tracking-wider text-zinc-400">HOME</span>
              </div>

              {/* Silver Metallic USB-C Port Silhouette */}
              <div className="flex flex-col items-center gap-0.5 sm:gap-1">
                <span className="text-[5.5px] sm:text-[7px] font-mono tracking-wider text-zinc-400">USB</span>
                <div
                  className="w-5 h-6 sm:w-7 sm:h-8 rounded bg-gradient-to-b from-zinc-300 via-zinc-400 to-zinc-500 border border-zinc-200/70 shadow-inner flex items-center justify-center"
                  title="USB-C Serial & Flash Port"
                >
                  <div className="w-3 h-1 sm:w-4 sm:h-1.5 rounded-full bg-zinc-900 border border-zinc-700" />
                </div>
              </div>
            </div>

            {/* Rightmost Expansion Rail (S2 / S1 / M2 / M1) */}
            <div
              className="w-3.5 sm:w-5 bg-zinc-950 border border-zinc-700/80 rounded-r-md sm:rounded-r-lg py-1 sm:py-1.5 flex flex-col justify-between items-center text-[5px] sm:text-[6.5px] font-mono text-zinc-400 shrink-0"
              aria-hidden="true"
            >
              <div className="flex flex-col items-center gap-0.5">
                <span className="w-2 h-1.5 sm:w-2.5 sm:h-2 rounded-[2px] bg-zinc-200 border border-zinc-400 block" />
                <span>S2</span>
              </div>
              <div className="flex flex-col items-center gap-0.5">
                <span className="w-2 h-1.5 sm:w-2.5 sm:h-2 rounded-[2px] bg-zinc-200 border border-zinc-400 block" />
                <span>S1</span>
              </div>
              <div className="flex flex-col items-center gap-0.5">
                <span className="w-2 h-1.5 sm:w-2.5 sm:h-2 rounded-[2px] bg-zinc-200 border border-zinc-400 block" />
                <span>M2</span>
              </div>
              <div className="flex flex-col items-center gap-0.5">
                <span className="w-2 h-1.5 sm:w-2.5 sm:h-2 rounded-[2px] bg-zinc-200 border border-zinc-400 block" />
                <span>M1</span>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Continuous 5-LED WS2812B Diffuser Light Bar */}
        <div className="absolute inset-x-5 bottom-1.5 h-2 rounded-full bg-zinc-950/90 border border-zinc-700/70 overflow-hidden">
          <div
            className="w-full h-full opacity-95"
            style={{
              background: ledGradient,
              boxShadow: '0 0 12px rgba(56, 189, 248, 0.35)'
            }}
          />
        </div>
        {/* Subtle Diffused Upward Light Pipe Glow Along Lower Rim */}
        <div
          className="absolute inset-x-8 bottom-0 h-5 pointer-events-none blur-md opacity-35"
          style={{ background: ledGradient }}
          aria-hidden="true"
        />
      </div>

      {/* Live Hardware State Strip (Tabular Numerals, Dual-Coded Text) */}
      <div className="mt-3.5 w-full grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono tabular-nums">
        <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800/90">
          <span className="text-zinc-400">JOY</span>
          <span className={inputs.joyX !== 0 || inputs.joyY !== 0 ? 'text-cyan-400 font-semibold' : 'text-zinc-300'}>
            X:{inputs.joyX} Y:{inputs.joyY}
          </span>
        </div>

        <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800/90">
          <span className="text-zinc-400">CTR</span>
          <span className={inputs.joyCenter ? 'text-emerald-400 font-semibold' : 'text-zinc-400'}>
            {inputs.joyCenter ? 'PRESSED' : 'IDLE'}
          </span>
        </div>

        <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800/90">
          <span className="text-zinc-400">BTN A</span>
          <span className={inputs.btnA ? 'text-rose-400 font-semibold' : 'text-zinc-400'}>
            {inputs.btnA ? 'ACTIVE' : 'AW P0.6'}
          </span>
        </div>

        <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800/90">
          <span className="text-zinc-400">BTN B</span>
          <span className={inputs.btnB ? 'text-blue-400 font-semibold' : 'text-zinc-400'}>
            {inputs.btnB ? 'ACTIVE' : 'AW P0.5'}
          </span>
        </div>
      </div>

      {/* 5-Channel AW9523B RGB LED Monitor + Home Switch */}
      <div className="mt-2.5 w-full flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-zinc-950/90 border border-zinc-800/80">
        <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-400">
          <span className="whitespace-nowrap">5× RGB (0x5B)</span>
          <div className="flex items-center gap-1.5">
            {ledHues.map((hue, idx) => (
              <span
                key={idx}
                className="w-2.5 h-2.5 rounded-full inline-block"
                style={{
                  backgroundColor: `hsl(${hue}, 95%, 56%)`,
                  boxShadow: `0 0 6px hsl(${hue}, 95%, 56%)`
                }}
                title={`AW9523B RGB LED #${idx + 1}`}
              />
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={cycleDisplayMode}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-[11px] font-medium border border-zinc-700/80 transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <Home className="w-3 h-3 text-amber-400" />
          <span>Cycle Home</span>
        </button>
      </div>

      {/* Simulator Screen Firmware Mode Selector */}
      <div className="mt-4 w-full">
        <span className="text-xs font-semibold text-zinc-300 mb-2 block">
          Simulator TFT Screen Firmware
        </span>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-xs">
          <button
            type="button"
            onClick={() => setDisplayMode('spectrum_eq')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-left transition-colors whitespace-nowrap cursor-pointer ${
              displayMode === 'spectrum_eq'
                ? 'bg-cyan-950/80 border-cyan-500 text-cyan-200 font-semibold'
                : 'bg-zinc-950/70 border-zinc-800 text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">EQ Spectrum</span>
          </button>

          <button
            type="button"
            onClick={() => setDisplayMode('dashboard')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-left transition-colors whitespace-nowrap cursor-pointer ${
              displayMode === 'dashboard'
                ? 'bg-cyan-950/80 border-cyan-500 text-cyan-200 font-semibold'
                : 'bg-zinc-950/70 border-zinc-800 text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            <Monitor className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Diagnostics</span>
          </button>

          <button
            type="button"
            onClick={() => setDisplayMode('bouncing_ball')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-left transition-colors whitespace-nowrap cursor-pointer ${
              displayMode === 'bouncing_ball'
                ? 'bg-cyan-950/80 border-cyan-500 text-cyan-200 font-semibold'
                : 'bg-zinc-950/70 border-zinc-800 text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            <Gamepad2 className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Arcade Ball</span>
          </button>

          <button
            type="button"
            onClick={() => setDisplayMode('imu_horizon')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-left transition-colors whitespace-nowrap cursor-pointer ${
              displayMode === 'imu_horizon'
                ? 'bg-cyan-950/80 border-cyan-500 text-cyan-200 font-semibold'
                : 'bg-zinc-950/70 border-zinc-800 text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            <Compass className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">6-Axis IMU</span>
          </button>

          <button
            type="button"
            onClick={() => setDisplayMode('rgb_rainbow')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-left transition-colors whitespace-nowrap cursor-pointer col-span-2 sm:col-span-2 ${
              displayMode === 'rgb_rainbow'
                ? 'bg-cyan-950/80 border-cyan-500 text-cyan-200 font-semibold'
                : 'bg-zinc-950/70 border-zinc-800 text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            <Radio className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">RGB NeoPixel Wave</span>
          </button>
        </div>
      </div>
    </div>
  );
};
