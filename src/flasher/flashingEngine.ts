import { ESPLoader, Transport } from 'esptool-js';
import { TelemetryPacket } from '../simulator/types.ts';
import { parseCyberPiTelemetry } from '../simulator/engine.ts';

export type FlashingStage =
  | 'idle'
  | 'connecting'
  | 'handshake'
  | 'erasing'
  | 'writing'
  | 'verifying'
  | 'done'
  | 'error';

export interface FlashProgress {
  stage: FlashingStage;
  percent: number;
  writtenBytes: number;
  totalBytes: number;
  speedKBps: number;
  message: string;
}

export interface FlasherCallbacks {
  onLog: (text: string, type: 'info' | 'rx' | 'tx' | 'error' | 'success') => void;
  onProgress: (progress: FlashProgress) => void;
  onConnectionChange: (connected: boolean) => void;
  onSerialBlocked?: (blocked: boolean) => void;
  onTelemetry?: (telemetry: TelemetryPacket) => void;
}

export class CyberPiFlasherEngine {
  private port: any = null;
  private reader: ReadableStreamDefaultReader<string> | null = null;
  private readPipeClosed: Promise<void> | null = null;
  private isConnected = false;
  private isFlashing = false;
  private baudRate = 115200;
  private callbacks: FlasherCallbacks;
  private boundDisconnectHandler: ((ev: Event) => void) | null = null;

  constructor(callbacks: FlasherCallbacks) {
    this.callbacks = callbacks;
  }

  public getStatus() {
    return {
      isConnected: this.isConnected,
      baudRate: this.baudRate,
      hasWebSerial: typeof navigator !== 'undefined' && 'serial' in navigator
    };
  }

  /**
   * Opens the browser's Web Serial port selection window and connects to the selected CyberPi.
   * Must be invoked directly from a user click gesture so navigator.serial.requestPort() retains user activation.
   */
  public async connect(baudRate: number = 115200): Promise<boolean> {
    this.baudRate = baudRate;

    if (typeof navigator === 'undefined' || !('serial' in navigator)) {
      this.callbacks.onLog(
        'Web Serial API is not available in this browser. Open this app in Chrome, Edge, or Opera over HTTPS.',
        'error'
      );
      return false;
    }

    try {
      this.callbacks.onLog('Opening Web Serial port selection window...', 'info');
      const selectedPort = await (navigator as any).serial.requestPort();
      this.callbacks.onSerialBlocked?.(false);

      this.port = selectedPort;
      await this.port.open({ baudRate: this.baudRate });

      this.isConnected = true;
      this.callbacks.onConnectionChange(true);
      this.callbacks.onLog(`[Connected] CyberPi serial port opened at ${this.baudRate} baud`, 'success');

      this.boundDisconnectHandler = () => {
        if (!this.isFlashing) {
          this.callbacks.onLog('USB Serial device disconnected.', 'error');
          this.cleanupPortState();
        }
      };
      this.port.addEventListener?.('disconnect', this.boundDisconnectHandler);

      this.startSerialReadLoop();
      return true;
    } catch (err: any) {
      if (err?.name === 'NotFoundError') {
        this.callbacks.onLog('Web Serial port selection cancelled (no device chosen).', 'info');
        return false;
      }
      if (err?.name === 'SecurityError') {
        this.callbacks.onSerialBlocked?.(true);
        this.callbacks.onLog(
          'Web Serial access was blocked by frame permissions. Open the app in a standalone browser tab to connect.',
          'error'
        );
        return false;
      }
      this.callbacks.onLog(`Connection failed: ${err?.message || String(err)}`, 'error');
      return false;
    }
  }

  public async disconnect(): Promise<void> {
    await this.stopSerialReadLoop();

    if (this.port) {
      if (this.boundDisconnectHandler) {
        this.port.removeEventListener?.('disconnect', this.boundDisconnectHandler);
        this.boundDisconnectHandler = null;
      }
      try {
        await this.port.close();
      } catch {
        // Port may already be closed
      }
      this.port = null;
    }

    this.cleanupPortState();
    this.callbacks.onLog('Serial port disconnected.', 'info');
  }

  private cleanupPortState() {
    this.isConnected = false;
    this.callbacks.onConnectionChange(false);
  }

  private writeQueue: Promise<void> = Promise.resolve();

  /**
   * Sends a single silent command line (e.g. bidirectional simulator state) without flooding the Serial Monitor log.
   */
  public sendRawLine(text: string): Promise<void> {
    if (!this.isConnected || !this.port || this.isFlashing || !this.port.writable) {
      return Promise.resolve();
    }
    const task = this.writeQueue.then(async () => {
      if (!this.isConnected || !this.port || this.isFlashing || !this.port.writable) return;
      const encoder = new TextEncoder();
      const writer = this.port.writable.getWriter();
      try {
        await writer.write(encoder.encode(text + '\n'));
      } catch {
        // Ignore transient write errors while disconnecting/flashing
      } finally {
        writer.releaseLock();
      }
    });
    this.writeQueue = task.catch(() => {});
    return task;
  }

  /**
   * Transmits command line data to the connected CyberPi over Web Serial.
   */
  public async sendCommand(text: string): Promise<void> {
    if (!this.isConnected || !this.port) {
      this.callbacks.onLog('Error: Not connected to any serial device.', 'error');
      return;
    }

    if (this.isFlashing) {
      this.callbacks.onLog('Cannot send serial commands while flashing is in progress.', 'error');
      return;
    }

    if (!this.port.writable) {
      this.callbacks.onLog('Serial port is not writable.', 'error');
      return;
    }

    this.callbacks.onLog(`> ${text}`, 'tx');
    const encoder = new TextEncoder();
    const writer = this.port.writable.getWriter();
    try {
      await writer.write(encoder.encode(text + '\r\n'));
    } catch (err: any) {
      this.callbacks.onLog(`Serial write failed: ${err?.message || String(err)}`, 'error');
    } finally {
      writer.releaseLock();
    }
  }

  /**
   * Executes real ESP32 firmware flashing via esptool-js over the connected Web Serial port.
   */
  public async flashFirmware(
    fileBuffer: ArrayBuffer,
    offset: number = 0x10000,
    firmwareName: string = 'Firmware'
  ): Promise<boolean> {
    if (!this.isConnected || !this.port) {
      this.callbacks.onLog('Cannot flash: No Web Serial device connected.', 'error');
      return false;
    }

    const totalBytes = fileBuffer.byteLength;
    if (totalBytes === 0) {
      this.callbacks.onLog('Cannot flash: Firmware binary is empty (0 bytes).', 'error');
      return false;
    }

    this.isFlashing = true;
    let transport: Transport | null = null;

    try {
      this.callbacks.onLog(
        `Starting ESP32 flash for ${firmwareName} (${(totalBytes / 1024).toFixed(1)} KB) at offset 0x${offset.toString(16).toUpperCase()}...`,
        'info'
      );

      // Release serial monitor reader and close port so esptool-js Transport can open it cleanly
      this.updateProgress('connecting', 2, 0, totalBytes, 0, 'Releasing serial monitor & entering bootloader...');
      await this.stopSerialReadLoop();
      try {
        await this.port.close();
      } catch {
        // Ignore if already closed
      }

      transport = new Transport(this.port, false);
      const flashBaud = this.baudRate >= 460800 ? this.baudRate : 460800;

      const loader = new ESPLoader({
        transport,
        baudrate: flashBaud,
        romBaudrate: 115200,
        terminal: {
          clean: () => {},
          writeLine: (line: string) => {
            if (line.trim()) this.callbacks.onLog(`[esptool] ${line}`, 'info');
          },
          write: (data: string) => {
            if (data.trim()) this.callbacks.onLog(`[esptool] ${data.trim()}`, 'info');
          }
        }
      });

      this.updateProgress('handshake', 8, 0, totalBytes, 0, 'Syncing ESP32 ROM bootloader (RTS/DTR reset)...');
      const chipDesc = await loader.main();
      this.callbacks.onLog(`Detected chip: ${chipDesc}`, 'success');

      const startTime = Date.now();
      this.updateProgress('writing', 15, 0, totalBytes, 0, 'Writing firmware to SPI flash...');

      await loader.writeFlash({
        fileArray: [{ data: new Uint8Array(fileBuffer), address: offset }],
        flashSize: 'keep',
        flashMode: 'keep',
        flashFreq: 'keep',
        eraseAll: false,
        compress: true,
        reportProgress: (_fileIndex: number, written: number, total: number) => {
          const elapsedSec = Math.max(0.05, (Date.now() - startTime) / 1000);
          const speedKBps = written / 1024 / elapsedSec;
          const pct = Math.min(98, Math.floor(15 + (written / Math.max(1, total)) * 83));
          this.updateProgress(
            'writing',
            pct,
            written,
            total,
            speedKBps,
            `Writing flash: ${(written / 1024).toFixed(1)} / ${(total / 1024).toFixed(1)} KB (${pct}%)`
          );
        }
      });

      this.updateProgress('verifying', 99, totalBytes, totalBytes, 0, 'Resetting CyberPi via RTS...');
      await loader.after('hard_reset');

      await transport.disconnect();
      transport = null;

      this.updateProgress('done', 100, totalBytes, totalBytes, 0, 'Flash complete! Rebooting CyberPi...');
      this.callbacks.onLog('Firmware flashed successfully. Reopening serial monitor...', 'success');

      // Reopen port for live serial monitor output
      await this.port.open({ baudRate: this.baudRate });
      this.startSerialReadLoop();

      this.updateProgress('idle', 100, totalBytes, totalBytes, 0, 'Ready');
      return true;
    } catch (err: any) {
      this.callbacks.onLog(`Flash error: ${err?.message || String(err)}`, 'error');
      this.updateProgress('error', 0, 0, totalBytes, 0, `Flash failed: ${err?.message || 'Unknown error'}`);

      if (transport) {
        try {
          await transport.disconnect();
        } catch {}
      }

      // Attempt to reopen serial monitor if port is still attached
      if (this.port && !this.port.readable) {
        try {
          await this.port.open({ baudRate: this.baudRate });
          this.startSerialReadLoop();
        } catch {
          this.cleanupPortState();
        }
      }
      return false;
    } finally {
      this.isFlashing = false;
    }
  }

  private updateProgress(
    stage: FlashingStage,
    percent: number,
    writtenBytes: number,
    totalBytes: number,
    speedKBps: number,
    message: string
  ) {
    this.callbacks.onProgress({
      stage,
      percent,
      writtenBytes,
      totalBytes,
      speedKBps,
      message
    });
  }

  private async stopSerialReadLoop() {
    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch {}
      this.reader = null;
    }
    if (this.readPipeClosed) {
      try {
        await this.readPipeClosed;
      } catch {}
      this.readPipeClosed = null;
    }
  }

  private startSerialReadLoop() {
    if (!this.port || !this.port.readable) return;

    const abortController = new AbortController();
    const textDecoder = new TextDecoderStream();
    this.readPipeClosed = this.port.readable
      .pipeTo(textDecoder.writable, { signal: abortController.signal })
      .catch(() => {});

    const reader = textDecoder.readable.getReader();
    this.reader = reader;

    (async () => {
      try {
        let buffer = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            buffer += value;
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const clean = line.trim();
              if (!clean) continue;
              this.callbacks.onLog(clean, 'rx');

              const telemetry = parseCyberPiTelemetry(clean);
              if (telemetry && this.callbacks.onTelemetry) {
                this.callbacks.onTelemetry(telemetry);
              }
            }
          }
        }
      } catch (err: any) {
        if (this.isConnected && !this.isFlashing && err?.name !== 'AbortError') {
          this.callbacks.onLog(`Serial read stream closed: ${err?.message || String(err)}`, 'info');
        }
      } finally {
        try {
          reader.releaseLock();
        } catch {}
        abortController.abort();
      }
    })();
  }
}
