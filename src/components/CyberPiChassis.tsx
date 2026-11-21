import React, { useEffect, useRef, useState, useCallback } from 'react';
import { CyberPiInputs, DisplayMode, BallPhysicsState } from '../simulator/types.ts';
import { updateBallPhysics, calculateLedHues, formatTelemetryPacket } from '../simulator/engine.ts';
import { Volume2, Sparkles, Monitor, Gamepad2, Compass, Radio } from 'lucide-react';

interface CyberPiChassisProps {
  inputs: CyberPiInputs;
  onInputChange: (newInputs: Partial<CyberPiInputs>) => void;
  onEmitTelemetry?: (packetJson: string) => void;
}

export const CyberPiChassis: React.FC<CyberPiChassisProps> = ({
  inputs,
  onInputChange,
  onEmitTelemetry
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('dashboard');
  const [tick, setTick] = useState(0);

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

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when user is typing in terminal or input fields
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

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
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

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

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
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
      ctx.fillStyle = '#080c14';
      ctx.fillRect(0, 0, 128, 128);

      if (displayMode === 'dashboard') {
        // --- 1. CyberOS System Diagnostics ---
        // Header
        ctx.fillStyle = '#0284c7';
        ctx.fillRect(0, 0, 128, 15);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 8px monospace';
        ctx.fillText('CyberOS v1.0.4', 4, 11);

        // Battery level icon
        ctx.strokeStyle = '#22c55e';
        ctx.strokeRect(108, 4, 14, 7);
        ctx.fillStyle = '#22c55e';
        ctx.fillRect(110, 6, 9, 3);
        ctx.fillRect(122, 6, 2, 3);

        // Hardware details
        ctx.fillStyle = '#94a3b8';
        ctx.font = '7px monospace';
        ctx.fillText('SoC: ESP32-WROVER-B', 4, 27);
        ctx.fillText('ROM: 16MB | RAM: 8MB', 4, 37);

        // Telemetry readouts
        ctx.fillStyle = '#38bdf8';
        ctx.fillText(`JOY: [X:${inputs.joyX} Y:${inputs.joyY}]`, 4, 49);
        ctx.fillText(`CENTER: ${inputs.joyCenter ? 'PRESSED' : 'RELEASED'}`, 4, 59);

        // Buttons status
        ctx.fillStyle = inputs.btnA ? '#ef4444' : '#475569';
        ctx.fillRect(4, 65, 29, 12);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(`A:${inputs.btnA ? 'ON' : '0'}`, 8, 74);

        ctx.fillStyle = inputs.btnB ? '#3b82f6' : '#475569';
        ctx.fillRect(36, 65, 29, 12);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(`B:${inputs.btnB ? 'ON' : '0'}`, 40, 74);

        // Joystick Visual Grid Crosshair
        ctx.strokeStyle = '#1e293b';
        ctx.strokeRect(70, 65, 52, 48);
        ctx.beginPath();
        ctx.moveTo(96, 65); ctx.lineTo(96, 113);
        ctx.moveTo(70, 89); ctx.lineTo(122, 89);
        ctx.stroke();

        // Crosshair cursor
        const joyDotX = 96 + inputs.joyX * 18;
        const joyDotY = 89 + inputs.joyY * 18;
        ctx.fillStyle = inputs.joyCenter ? '#10b981' : '#38bdf8';
        ctx.beginPath();
        ctx.arc(joyDotX, joyDotY, 3.5, 0, Math.PI * 2);
        ctx.fill();

        // Footer status bar
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 117, 128, 11);
        ctx.fillStyle = '#22c55e';
        ctx.fillText('• UART 115200 OK', 4, 125);

      } else if (displayMode === 'bouncing_ball') {
        // --- 2. Retro Arcade Bouncing Ball ---
        ballRef.current = updateBallPhysics(ballRef.current, inputs, { width: 128, height: 128 });
        const b = ballRef.current;

        // Background grid
        ctx.strokeStyle = '#131b2e';
        ctx.lineWidth = 1;
        for (let x = 0; x < 128; x += 16) {
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 128); ctx.stroke();
        }
        for (let y = 0; y < 128; y += 16) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(128, y); ctx.stroke();
        }

        // Ball glow & body
        ctx.shadowBlur = 8;
        ctx.shadowColor = b.color;
        ctx.fillStyle = b.color;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // HUD instruction
        ctx.fillStyle = '#ffffff';
        ctx.font = '7px monospace';
        ctx.fillText(`Pos: [${Math.round(b.x)}, ${Math.round(b.y)}]`, 4, 10);
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('Move: Joystick | Color: A/B', 4, 122);

      } else if (displayMode === 'imu_horizon') {
        // --- 3. 6-Axis IMU Artificial Horizon ---
        ctx.save();
        ctx.translate(64, 64);
        const rollAngle = inputs.joyX * 0.45;
        const pitchOffset = inputs.joyY * 26;
        ctx.rotate(rollAngle);

        // Sky & Ground
        ctx.fillStyle = '#0284c7';
        ctx.fillRect(-70, -70 + pitchOffset, 140, 70);
        ctx.fillStyle = '#78350f';
        ctx.fillRect(-70, 0 + pitchOffset, 140, 70);

        // Horizon line
        ctx.strokeStyle = '#f8fafc';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-60, pitchOffset);
        ctx.lineTo(60, pitchOffset);
        ctx.stroke();
        ctx.restore();

        // Center reticle
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(48, 64); ctx.lineTo(60, 64);
        ctx.moveTo(68, 64); ctx.lineTo(80, 64);
        ctx.arc(64, 64, 3, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = '7px monospace';
        ctx.fillText('6-Axis IMU (MPU6050)', 4, 10);
        ctx.fillText(`Roll: ${(inputs.joyX * 25).toFixed(1)}°`, 4, 114);
        ctx.fillText(`Pitch: ${(inputs.joyY * 18).toFixed(1)}°`, 4, 123);

      } else if (displayMode === 'rgb_rainbow') {
        // --- 4. RGB Light Spectrum Wave ---
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
        ctx.fillText('5-Channel WS2812B Wave', 14, 118);

      } else if (displayMode === 'terminal_stream') {
        // --- 5. Terminal Matrix Stream ---
        ctx.fillStyle = '#10b981';
        ctx.font = '7px monospace';
        for (let line = 0; line < 11; line++) {
          const charCode = (frameCounter + line * 7) % 64 + 65;
          const hex = ((frameCounter * 13 + line * 37) & 0xff).toString(16).padStart(2, '0');
          ctx.fillText(`[0x${hex}] CH_${line}: ${String.fromCharCode(charCode)} OK`, 4, 14 + line * 10);
        }
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

  return (
    <div className="flex flex-col items-center">
      {/* Physical CyberPi Chassis Bezel */}
      <div className="relative bg-gradient-to-b from-zinc-800 via-zinc-900 to-black p-4 rounded-2xl border-4 border-zinc-700/80 shadow-2xl shadow-cyan-950/20 max-w-[310px] w-full select-none">
        {/* Top Header: Speaker Grill & Logo */}
        <div className="flex justify-between items-center mb-2 px-1">
          <div className="flex gap-1 items-center bg-zinc-950/80 px-2 py-0.5 rounded-md border border-zinc-800">
            <Volume2 className="w-3 h-3 text-zinc-500" />
            <div className="flex gap-0.5">
              <span className="w-1 h-2.5 bg-zinc-700 rounded-full inline-block"></span>
              <span className="w-1 h-2.5 bg-zinc-700 rounded-full inline-block"></span>
              <span className="w-1 h-2.5 bg-zinc-700 rounded-full inline-block"></span>
              <span className="w-1 h-2.5 bg-zinc-700 rounded-full inline-block"></span>
            </div>
          </div>
          <span className="text-[10px] font-mono tracking-widest text-zinc-400 font-bold uppercase">
            Makeblock
          </span>
          <div className="w-2 h-2 rounded-full bg-cyan-500/80 shadow-[0_0_8px_#06b6d4]"></div>
        </div>

        {/* 1.44-inch ST7735 128x128 Display Screen */}
        <div className="relative mx-auto bg-black p-2 rounded-xl border-2 border-zinc-700 shadow-inner overflow-hidden flex justify-center items-center">
          <canvas
            ref={canvasRef}
            width={128}
            height={128}
            className="w-[156px] h-[156px] rounded border border-zinc-800"
            style={{ imageRendering: 'pixelated' }}
            aria-label="Makeblock CyberPi 128x128 Color TFT Display"
          />
          {/* Subtle screen glass glare effect */}
          <div className="absolute inset-x-2 top-2 h-12 bg-gradient-to-b from-white/10 to-transparent pointer-events-none rounded-t"></div>
        </div>

        {/* 5-Addressable RGB LEDs (WS2812B Strip) */}
        <div className="flex justify-between items-center bg-zinc-950 px-3.5 py-1.5 my-2.5 rounded-xl border border-zinc-800">
          {ledHues.map((hue, idx) => (
            <div
              key={idx}
              className="w-3 h-3 rounded-full transition-all duration-75"
              style={{
                backgroundColor: `hsl(${hue}, 95%, 55%)`,
                boxShadow: `0 0 8px hsl(${hue}, 95%, 55%)`
              }}
              title={`RGB LED #${idx + 1}`}
            />
          ))}
        </div>

        {/* Controls Section: 5-way Joystick + Buttons A & B */}
        <div className="flex justify-between items-center px-2 mt-2">
          {/* 5-Way Joystick Assembly */}
          <div className="flex flex-col items-center">
            {/* Up */}
            <button
              type="button"
              onMouseDown={() => onInputChange({ joyY: -1 })}
              onMouseUp={() => onInputChange({ joyY: 0 })}
              onMouseLeave={() => onInputChange({ joyY: 0 })}
              className={`w-8 h-8 rounded-t-lg bg-zinc-800 border border-zinc-600 flex items-center justify-center text-xs text-zinc-300 active:bg-cyan-500 active:text-black transition-all ${
                inputs.joyY === -1 ? 'bg-cyan-500 text-black shadow-lg shadow-cyan-500/50' : ''
              }`}
              title="Joystick Up (ArrowUp)"
              aria-label="Joystick Up"
            >
              ▲
            </button>

            {/* Middle Row: Left, Center, Right */}
            <div className="flex gap-0.5">
              <button
                type="button"
                onMouseDown={() => onInputChange({ joyX: -1 })}
                onMouseUp={() => onInputChange({ joyX: 0 })}
                onMouseLeave={() => onInputChange({ joyX: 0 })}
                className={`w-8 h-8 rounded-l-lg bg-zinc-800 border border-zinc-600 flex items-center justify-center text-xs text-zinc-300 active:bg-cyan-500 active:text-black transition-all ${
                  inputs.joyX === -1 ? 'bg-cyan-500 text-black shadow-lg shadow-cyan-500/50' : ''
                }`}
                title="Joystick Left (ArrowLeft)"
                aria-label="Joystick Left"
              >
                ◀
              </button>

              <button
                type="button"
                onMouseDown={() => onInputChange({ joyCenter: true })}
                onMouseUp={() => onInputChange({ joyCenter: false })}
                onMouseLeave={() => onInputChange({ joyCenter: false })}
                className={`w-8 h-8 rounded-full bg-zinc-700 border-2 border-zinc-500 flex items-center justify-center text-xs font-bold text-white active:bg-emerald-500 active:text-black transition-all ${
                  inputs.joyCenter ? 'bg-emerald-500 text-black shadow-lg shadow-emerald-500/50 scale-90' : ''
                }`}
                title="Joystick Center Press (Enter / Space)"
                aria-label="Joystick Center Button"
              >
                ●
              </button>

              <button
                type="button"
                onMouseDown={() => onInputChange({ joyX: 1 })}
                onMouseUp={() => onInputChange({ joyX: 0 })}
                onMouseLeave={() => onInputChange({ joyX: 0 })}
                className={`w-8 h-8 rounded-r-lg bg-zinc-800 border border-zinc-600 flex items-center justify-center text-xs text-zinc-300 active:bg-cyan-500 active:text-black transition-all ${
                  inputs.joyX === 1 ? 'bg-cyan-500 text-black shadow-lg shadow-cyan-500/50' : ''
                }`}
                title="Joystick Right (ArrowRight)"
                aria-label="Joystick Right"
              >
                ▶
              </button>
            </div>

            {/* Down */}
            <button
              type="button"
              onMouseDown={() => onInputChange({ joyY: 1 })}
              onMouseUp={() => onInputChange({ joyY: 0 })}
              onMouseLeave={() => onInputChange({ joyY: 0 })}
              className={`w-8 h-8 rounded-b-lg bg-zinc-800 border border-zinc-600 flex items-center justify-center text-xs text-zinc-300 active:bg-cyan-500 active:text-black transition-all ${
                inputs.joyY === 1 ? 'bg-cyan-500 text-black shadow-lg shadow-cyan-500/50' : ''
              }`}
              title="Joystick Down (ArrowDown)"
              aria-label="Joystick Down"
            >
              ▼
            </button>
          </div>

          {/* Action Buttons A & B */}
          <div className="flex gap-3 items-center">
            {/* Button A (Red) */}
            <div className="flex flex-col items-center">
              <button
                type="button"
                onMouseDown={() => onInputChange({ btnA: true })}
                onMouseUp={() => onInputChange({ btnA: false })}
                onMouseLeave={() => onInputChange({ btnA: false })}
                className={`w-11 h-11 rounded-full bg-red-600 border-2 border-red-400 text-white font-bold text-sm shadow-md flex items-center justify-center active:scale-90 transition-transform ${
                  inputs.btnA ? 'scale-90 brightness-125 ring-2 ring-red-400' : ''
                }`}
                title="Button A ('A' key)"
                aria-label="Button A"
              >
                A
              </button>
              <span className="text-[9px] text-zinc-400 mt-1 font-mono">GPIO 0</span>
            </div>

            {/* Button B (Blue) */}
            <div className="flex flex-col items-center">
              <button
                type="button"
                onMouseDown={() => onInputChange({ btnB: true })}
                onMouseUp={() => onInputChange({ btnB: false })}
                onMouseLeave={() => onInputChange({ btnB: false })}
                className={`w-11 h-11 rounded-full bg-blue-600 border-2 border-blue-400 text-white font-bold text-sm shadow-md flex items-center justify-center active:scale-90 transition-transform ${
                  inputs.btnB ? 'scale-90 brightness-125 ring-2 ring-blue-400' : ''
                }`}
                title="Button B ('B' key)"
                aria-label="Button B"
              >
                B
              </button>
              <span className="text-[9px] text-zinc-400 mt-1 font-mono">GPIO 32</span>
            </div>
          </div>
        </div>

        {/* Footer Brand */}
        <div className="text-center mt-4">
          <span className="text-[11px] font-bold text-zinc-300 tracking-wider">
            CyberPi
          </span>
          <span className="text-[9px] text-zinc-500 ml-1.5 font-mono">ESP32-WROVER-B</span>
        </div>
      </div>

      {/* Simulator Mode Selector */}
      <div className="mt-4 w-full max-w-[340px]">
        <label htmlFor="sim-mode" className="text-xs font-semibold text-zinc-400 mb-1.5 block">
          Simulator TFT Screen Firmware:
        </label>
        <div className="grid grid-cols-2 gap-1.5 text-xs">
          <button
            type="button"
            onClick={() => setDisplayMode('dashboard')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-left transition-colors ${
              displayMode === 'dashboard'
                ? 'bg-cyan-950/70 border-cyan-500 text-cyan-200'
                : 'bg-zinc-800/80 border-zinc-700 text-zinc-300 hover:bg-zinc-700'
            }`}
          >
            <Monitor className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Diagnostics</span>
          </button>

          <button
            type="button"
            onClick={() => setDisplayMode('bouncing_ball')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-left transition-colors ${
              displayMode === 'bouncing_ball'
                ? 'bg-cyan-950/70 border-cyan-500 text-cyan-200'
                : 'bg-zinc-800/80 border-zinc-700 text-zinc-300 hover:bg-zinc-700'
            }`}
          >
            <Gamepad2 className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Arcade Ball</span>
          </button>

          <button
            type="button"
            onClick={() => setDisplayMode('imu_horizon')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-left transition-colors ${
              displayMode === 'imu_horizon'
                ? 'bg-cyan-950/70 border-cyan-500 text-cyan-200'
                : 'bg-zinc-800/80 border-zinc-700 text-zinc-300 hover:bg-zinc-700'
            }`}
          >
            <Compass className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">6-Axis IMU</span>
          </button>

          <button
            type="button"
            onClick={() => setDisplayMode('rgb_rainbow')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-left transition-colors ${
              displayMode === 'rgb_rainbow'
                ? 'bg-cyan-950/70 border-cyan-500 text-cyan-200'
                : 'bg-zinc-800/80 border-zinc-700 text-zinc-300 hover:bg-zinc-700'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">RGB Wave</span>
          </button>
        </div>
      </div>
    </div>
  );
};
