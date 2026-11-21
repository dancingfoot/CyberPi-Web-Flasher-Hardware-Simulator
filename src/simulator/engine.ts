import { BallPhysicsState, CyberPiInputs, TelemetryPacket } from './types.ts';

/**
 * Updates 2D ball physics inside the 128x128 CyberPi display viewport.
 * Joystick inputs impart acceleration; A and B buttons alter ball dynamics / color.
 */
export function updateBallPhysics(
  ball: BallPhysicsState,
  inputs: CyberPiInputs,
  bounds: { width: number; height: number } = { width: 128, height: 128 }
): BallPhysicsState {
  const joyInfluenceX = inputs.joyX * 0.8;
  const joyInfluenceY = inputs.joyY * 0.8;

  let vx = ball.vx + joyInfluenceX;
  let vy = ball.vy + joyInfluenceY;

  // Clamp velocity to prevent clipping
  const maxVel = 5;
  vx = Math.max(-maxVel, Math.min(maxVel, vx));
  vy = Math.max(-maxVel, Math.min(maxVel, vy));

  let x = ball.x + vx;
  let y = ball.y + vy;
  const r = ball.radius;

  // Bounce against boundaries
  if (x - r < 0) {
    x = r;
    vx = -vx * 0.9;
  } else if (x + r > bounds.width) {
    x = bounds.width - r;
    vx = -vx * 0.9;
  }

  if (y - r < 0) {
    y = r;
    vy = -vy * 0.9;
  } else if (y + r > bounds.height) {
    y = bounds.height - r;
    vy = -vy * 0.9;
  }

  // Determine color based on buttons
  let color = ball.color;
  if (inputs.btnA && inputs.btnB) {
    color = '#ec4899'; // Pink when both pressed
  } else if (inputs.btnA) {
    color = '#ef4444'; // Red
  } else if (inputs.btnB) {
    color = '#3b82f6'; // Blue
  } else if (inputs.joyCenter) {
    color = '#10b981'; // Green on center click
  }

  return {
    x,
    y,
    vx,
    vy,
    radius: r,
    color
  };
}

/**
 * Calculates RGB hue angles for the 5-LED strip (WS2812B) on CyberPi bottom.
 */
export function calculateLedHues(tick: number, count: number = 5): number[] {
  const hues: number[] = [];
  for (let i = 0; i < count; i++) {
    hues.push((tick * 3 + i * 45) % 360);
  }
  return hues;
}

/**
 * Serializes CyberPi telemetry state into standard JSON UART packet.
 */
export function formatTelemetryPacket(
  frame: number,
  inputs: CyberPiInputs,
  uptimeMs: number
): string {
  const packet: TelemetryPacket = {
    frame,
    btnA: inputs.btnA,
    btnB: inputs.btnB,
    joyX: inputs.joyX,
    joyY: inputs.joyY,
    joyCenter: inputs.joyCenter,
    uptime_ms: uptimeMs,
    cpu_temp: 42.5 + Math.sin(frame * 0.05) * 2.5,
    free_heap: 4194304 - (frame * 128) % 65536
  };
  return JSON.stringify(packet);
}

/**
 * Robust UART telemetry parser for incoming serial line buffer.
 */
export function parseCyberPiTelemetry(rawLine: string): TelemetryPacket | null {
  const trimmed = rawLine.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed.frame === 'number' && typeof parsed.uptime_ms === 'number') {
      return {
        frame: parsed.frame,
        btnA: Boolean(parsed.btnA),
        btnB: Boolean(parsed.btnB),
        joyX: Number(parsed.joyX) || 0,
        joyY: Number(parsed.joyY) || 0,
        joyCenter: Boolean(parsed.joyCenter),
        uptime_ms: parsed.uptime_ms,
        cpu_temp: parsed.cpu_temp,
        free_heap: parsed.free_heap
      };
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Validates ESP32 flash partition offset.
 * Standard ESP32 bootloader: 0x1000
 * Partition table: 0x8000
 * App partition: 0x10000 or 0x20000
 * Single merged binary: 0x0
 */
export function validateFirmwareOffset(offsetHexOrDec: string | number): {
  valid: boolean;
  offset: number;
  label: string;
} {
  let val: number;
  if (typeof offsetHexOrDec === 'number') {
    val = offsetHexOrDec;
  } else {
    const clean = offsetHexOrDec.trim().toLowerCase();
    val = clean.startsWith('0x') ? parseInt(clean, 16) : parseInt(clean, 10);
  }

  if (isNaN(val) || val < 0 || val > 0x1000000) {
    return { valid: false, offset: 0, label: 'Invalid offset' };
  }

  // Recognized standard offsets
  if (val === 0x0) return { valid: true, offset: 0x0, label: 'Merged Full Image (0x0)' };
  if (val === 0x1000) return { valid: true, offset: 0x1000, label: 'Bootloader (0x1000)' };
  if (val === 0x8000) return { valid: true, offset: 0x8000, label: 'Partition Table (0x8000)' };
  if (val === 0x10000) return { valid: true, offset: 0x10000, label: 'App Partition (0x10000)' };

  return { valid: true, offset: val, label: `Custom Offset (0x${val.toString(16)})` };
}
