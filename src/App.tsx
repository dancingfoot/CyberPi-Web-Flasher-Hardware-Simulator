import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CyberPiChassis } from './components/CyberPiChassis.tsx';
import { FlasherPanel } from './components/FlasherPanel.tsx';
import { SerialMonitor, LogEntry } from './components/SerialMonitor.tsx';
import { CiCdModal } from './components/CiCdModal.tsx';
import { CyberPiInputs, TelemetryPacket } from './simulator/types.ts';
import { CyberPiFlasherEngine, FlashProgress } from './flasher/flashingEngine.ts';
import { Cpu, GitBranch, Terminal, HelpCircle, Sparkles } from 'lucide-react';

export default function App() {
  const [inputs, setInputs] = useState<CyberPiInputs>({
    btnA: false,
    btnB: false,
    joyX: 0,
    joyY: 0,
    joyCenter: false
  });

  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [serialBlocked, setSerialBlocked] = useState<boolean>(false);
  const [baudRate, setBaudRate] = useState<number>(115200);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isCiCdOpen, setIsCiCdOpen] = useState<boolean>(false);
  const [hasWebSerial, setHasWebSerial] = useState<boolean>(false);

  const [flashProgress, setFlashProgress] = useState<FlashProgress>({
    stage: 'idle',
    percent: 0,
    writtenBytes: 0,
    totalBytes: 0,
    speedKBps: 0,
    message: 'Idle - Ready to flash'
  });

  // Flasher engine instance ref
  const flasherRef = useRef<CyberPiFlasherEngine | null>(null);

  const addLog = useCallback((text: string, type: 'info' | 'rx' | 'tx' | 'error' | 'success') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [
      ...prev.slice(-300), // Keep latest 300 lines for speed
      {
        id: Math.random().toString(36).substring(2, 9),
        timestamp,
        text,
        type
      }
    ]);
  }, []);

  // Initialize engine
  useEffect(() => {
    setHasWebSerial(typeof navigator !== 'undefined' && 'serial' in navigator);

    flasherRef.current = new CyberPiFlasherEngine({
      onLog: addLog,
      onProgress: (prog) => setFlashProgress(prog),
      onConnectionChange: (conn) => {
        setIsConnected(conn);
      },
      onSerialBlocked: (blocked) => {
        setSerialBlocked(blocked);
      },
      onTelemetry: (packet: TelemetryPacket) => {
        // Synchronize on-screen inputs if incoming physical telemetry arrives
        setInputs((prev) => ({
          ...prev,
          btnA: packet.btnA,
          btnB: packet.btnB,
          joyX: (packet.joyX > 0 ? 1 : packet.joyX < 0 ? -1 : 0) as -1 | 0 | 1,
          joyY: (packet.joyY > 0 ? 1 : packet.joyY < 0 ? -1 : 0) as -1 | 0 | 1,
          joyCenter: packet.joyCenter
        }));
      }
    });

    addLog('Makeblock CyberPi Web Studio loaded.', 'info');
    addLog('Target: ESP32-WROVER-B | 1.44" ST7735 TFT (128x128) | 5x WS2812B LEDs', 'info');

    return () => {
      flasherRef.current?.disconnect();
    };
  }, [addLog]);

  const handleInputChange = useCallback((newInputs: Partial<CyberPiInputs>) => {
    setInputs((prev) => ({ ...prev, ...newInputs }));
  }, []);

  const handleConnect = async (baud: number) => {
    if (!flasherRef.current) return;
    setBaudRate(baud);
    await flasherRef.current.connect(baud);
  };

  const handleDisconnect = async () => {
    if (!flasherRef.current) return;
    await flasherRef.current.disconnect();
  };

  const handleFlash = async (buffer: ArrayBuffer, offset: number, name: string) => {
    if (!flasherRef.current) return;
    await flasherRef.current.flashFirmware(buffer, offset, name);
  };

  const handleSendCommand = async (cmd: string) => {
    if (!flasherRef.current) return;
    await flasherRef.current.sendCommand(cmd);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-black">
      {/* Top Application Bar */}
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-40 px-6 py-3.5">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-600 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-900/30">
              <Cpu className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-white tracking-tight">
                  CyberPi Web Flasher & Hardware Simulator
                </h1>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800">
                  ESP32-WROVER-B
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                Compile with ESP-IDF via GitHub Actions & flash in-browser with Web Serial
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsCiCdOpen(true)}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold border border-zinc-700 transition-colors shadow-sm"
            >
              <GitBranch className="w-4 h-4 text-cyan-400" />
              <span>CI/CD & Source Files</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Grid View */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: CyberPi Hardware Simulator (5 cols) */}
        <div className="lg:col-span-5 flex flex-col items-center">
          <div className="w-full bg-zinc-900/90 border border-zinc-800 rounded-3xl p-5 shadow-2xl backdrop-blur-sm">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-cyan-400" />
                <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                  Hardware Simulator
                </h2>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">
                1.44" TFT 128x128
              </span>
            </div>

            {/* CyberPi Realistic Chassis */}
            <CyberPiChassis
              inputs={inputs}
              onInputChange={handleInputChange}
            />

            {/* Keyboard Shortcuts Hint */}
            <div className="mt-5 pt-3 border-t border-zinc-800 text-[11px] text-zinc-400">
              <span className="font-semibold text-zinc-300 block mb-1">Interactive Keyboard Controls:</span>
              <div className="grid grid-cols-2 gap-1.5 font-mono text-[10px]">
                <div className="bg-zinc-950 px-2 py-1 rounded border border-zinc-800/80">
                  <span className="text-cyan-400">Arrow Keys:</span> 5-Way Joystick
                </div>
                <div className="bg-zinc-950 px-2 py-1 rounded border border-zinc-800/80">
                  <span className="text-cyan-400">Enter / Space:</span> Joy Press
                </div>
                <div className="bg-zinc-950 px-2 py-1 rounded border border-zinc-800/80">
                  <span className="text-red-400">'A' Key:</span> Button A (GPIO 0)
                </div>
                <div className="bg-zinc-950 px-2 py-1 rounded border border-zinc-800/80">
                  <span className="text-blue-400">'B' Key:</span> Button B (GPIO 32)
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: ESP32 Flasher Panel + Live Serial Terminal (7 cols) */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          {/* Flasher Panel */}
          <FlasherPanel
            isConnected={isConnected}
            hasWebSerial={hasWebSerial}
            serialBlocked={serialBlocked}
            flashProgress={flashProgress}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
            onFlash={handleFlash}
          />

          {/* Real-time Bidirectional Serial Monitor */}
          <SerialMonitor
            logs={logs}
            isConnected={isConnected}
            baudRate={baudRate}
            onSendCommand={handleSendCommand}
            onClear={() => setLogs([])}
          />
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800/80 bg-zinc-950 px-6 py-4 text-xs text-zinc-500">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <span>
            Makeblock CyberPi (ESP32-WROVER-B, 16MB Flash, 8MB PSRAM, ST7735 LCD).
          </span>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setIsCiCdOpen(true)}
              className="text-zinc-400 hover:text-cyan-400 transition-colors"
            >
              GitHub Actions Workflow (.github/workflows/main.yml)
            </button>
            <span>•</span>
            <span>Web Serial API / ESP Web Tools</span>
          </div>
        </div>
      </footer>

      {/* CI/CD & Project Files Modal */}
      <CiCdModal
        isOpen={isCiCdOpen}
        onClose={() => setIsCiCdOpen(false)}
      />
    </div>
  );
}
