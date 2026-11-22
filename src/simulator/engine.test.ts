import test from 'node:test';
import assert from 'node:assert/strict';
import {
  updateBallPhysics,
  calculateLedHues,
  formatTelemetryPacket,
  parseCyberPiTelemetry,
  validateFirmwareOffset
} from './engine.ts';

test('ball physics stays bounded inside 128x128 screen', () => {
  const ball = {
    x: 126,
    y: 64,
    vx: 4,
    vy: 0,
    radius: 4,
    color: '#ffff00'
  };
  const inputs = { btnA: false, btnB: false, joyX: 0 as const, joyY: 0 as const, joyCenter: false };
  const updated = updateBallPhysics(ball, inputs, { width: 128, height: 128 });

  // Ball should bounce back when hitting boundary
  assert.ok(updated.x <= 128 - ball.radius, `x should not exceed right boundary, was ${updated.x}`);
  assert.ok(updated.vx < 0, 'horizontal velocity should invert upon collision');
});

test('ball color changes on button presses', () => {
  const ball = { x: 50, y: 50, vx: 1, vy: 1, radius: 4, color: '#ffff00' };
  
  const stateA = updateBallPhysics(ball, { btnA: true, btnB: false, joyX: 0, joyY: 0, joyCenter: false });
  assert.equal(stateA.color, '#ef4444');

  const stateB = updateBallPhysics(ball, { btnA: false, btnB: true, joyX: 0, joyY: 0, joyCenter: false });
  assert.equal(stateB.color, '#3b82f6');

  const stateBoth = updateBallPhysics(ball, { btnA: true, btnB: true, joyX: 0, joyY: 0, joyCenter: false });
  assert.equal(stateBoth.color, '#ec4899');
});

test('LED hue generator produces correct number of angles', () => {
  const hues = calculateLedHues(10, 5);
  assert.equal(hues.length, 5);
  hues.forEach(hue => {
    assert.ok(hue >= 0 && hue < 360, `Hue should be valid degree 0..360, got ${hue}`);
  });
});

test('telemetry packet formatting and parsing roundtrip', () => {
  const inputs = { btnA: true, btnB: false, joyX: 1 as const, joyY: -1 as const, joyCenter: false };
  const rawJson = formatTelemetryPacket(42, inputs, 1500);

  const parsed = parseCyberPiTelemetry(rawJson);
  assert.ok(parsed !== null, 'Telemetry parser should parse valid JSON');
  assert.equal(parsed?.frame, 42);
  assert.equal(parsed?.btnA, true);
  assert.equal(parsed?.btnB, false);
  assert.equal(parsed?.joyX, 1);
  assert.equal(parsed?.joyY, -1);
  assert.equal(parsed?.uptime_ms, 1500);

  const parsedWithSync = parseCyberPiTelemetry(
    '{"frame":7,"btnA":1,"btnB":0,"joyX":0,"joyY":-1,"joyCenter":1,"btnHome":1,"page":2,"uptime_ms":2500}'
  );
  assert.equal(parsedWithSync?.btnA, true);
  assert.equal(parsedWithSync?.joyCenter, true);
  assert.equal(parsedWithSync?.btnHome, true);
  assert.equal(parsedWithSync?.page, 2);
});

test('telemetry parser rejects invalid line inputs safely', () => {
  assert.equal(parseCyberPiTelemetry(''), null);
  assert.equal(parseCyberPiTelemetry('Booting ESP-IDF v5.2...'), null);
  assert.equal(parseCyberPiTelemetry('{incomplete json:'), null);
});

test('firmware offset validator identifies standard partitions', () => {
  const bootloader = validateFirmwareOffset('0x1000');
  assert.equal(bootloader.valid, true);
  assert.equal(bootloader.offset, 0x1000);
  assert.ok(bootloader.label.includes('Bootloader'));

  const partitionTable = validateFirmwareOffset(0x8000);
  assert.equal(partitionTable.valid, true);
  assert.equal(partitionTable.offset, 0x8000);

  const app = validateFirmwareOffset('0x10000');
  assert.equal(app.valid, true);
  assert.equal(app.offset, 0x10000);

  const invalid = validateFirmwareOffset('not_a_hex');
  assert.equal(invalid.valid, false);
});
