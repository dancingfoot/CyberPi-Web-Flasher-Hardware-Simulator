export type DisplayMode = 'dashboard' | 'bouncing_ball' | 'imu_horizon' | 'rgb_rainbow' | 'terminal_stream';

export interface CyberPiInputs {
  btnA: boolean;
  btnB: boolean;
  joyX: -1 | 0 | 1;
  joyY: -1 | 0 | 1;
  joyCenter: boolean;
}

export interface TelemetryPacket {
  frame: number;
  btnA: boolean;
  btnB: boolean;
  joyX: number;
  joyY: number;
  joyCenter: boolean;
  uptime_ms: number;
  cpu_temp?: number;
  free_heap?: number;
}

export interface BallPhysicsState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
}

export interface FirmwarePreset {
  id: string;
  name: string;
  description: string;
  version: string;
  targetOffset: number;
  sizeBytes: number;
  filename: string;
}
