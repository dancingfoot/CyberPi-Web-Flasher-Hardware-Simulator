import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { CyberPiChassis } from './components/CyberPiChassis.tsx';
import { FlasherPanel } from './components/FlasherPanel.tsx';
import { SerialMonitor, LogEntry } from './components/SerialMonitor.tsx';
import { CiCdModal } from './components/CiCdModal.tsx';
import { CyberPiInputs, DisplayMode, TelemetryPacket } from './simulator/types.ts';
import { CyberPiFlasherEngine, FlashProgress } from './flasher/flashingEngine.ts';
import { Cpu, GitBranch, FileText, ArrowLeftRight } from 'lucide-react';

const IDLE_INPUTS: CyberPiInputs = {
  btnA: false,
  btnB: false,
  joyX: 0,
  joyY: 0,
  joyCenter: false
};

const HW_PAGE_TO_MODE: Record<number, DisplayMode> = {
  0: 'spectrum_eq',
  1: 'dashboard',
  2: 'rgb_rainbow'
};

function modeToHwPage(mode: DisplayMode): number {
  if (mode === 'spectrum_eq') return 0;
  if (mode === 'dashboard') return 1;
  return 2;
}

export default function App() {
  const [hwInputs, setHwInputs] = useState<CyberPiInputs>(IDLE_INPUTS);
  const [virtualInputs, setVirtualInputs] = useState<CyberPiInputs>(IDLE_INPUTS);
  const [hwHomePressed, setHwHomePressed] = useState<boolean>(false);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('spectrum_eq');
  const lastHwPageRef = useRef<number | null>(null);

  const inputs = useMemo<CyberPiInputs>(
    () => ({
      btnA: hwInputs.btnA || virtualInputs.btnA,
      btnB: hwInputs.btnB || virtualInputs.btnB,
      joyX: (virtualInputs.joyX !== 0 ? virtualInputs.joyX : hwInputs.joyX) as -1 | 0 | 1,
      joyY: (virtualInputs.joyY !== 0 ? virtualInputs.joyY : hwInputs.joyY) as -1 | 0 | 1,
      joyCenter: hwInputs.joyCenter || virtualInputs.joyCenter
    }),
    [hwInputs, virtualInputs]
  );

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
        if (!conn) {
          setHwInputs(IDLE_INPUTS);
          setHwHomePressed(false);
          lastHwPageRef.current = null;
        }
      },
      onSerialBlocked: (blocked) => {
        setSerialBlocked(blocked);
      },
      onTelemetry: (packet: TelemetryPacket) => {
        // Synchronize physical hardware state -> simulator without overwriting active virtual input
        setHwInputs({
          btnA: packet.btnA,
          btnB: packet.btnB,
          joyX: (packet.joyX > 0 ? 1 : packet.joyX < 0 ? -1 : 0) as -1 | 0 | 1,
          joyY: (packet.joyY > 0 ? 1 : packet.joyY < 0 ? -1 : 0) as -1 | 0 | 1,
          joyCenter: packet.joyCenter
        });
        if (packet.btnHome !== undefined) {
          setHwHomePressed(packet.btnHome);
        }
        if (typeof packet.page === 'number' && packet.page !== lastHwPageRef.current) {
          lastHwPageRef.current = packet.page;
          const mapped = HW_PAGE_TO_MODE[packet.page];
          if (mapped) setDisplayMode(mapped);
        }
      }
    });

    addLog('Makeblock CyberPi Web Studio loaded.', 'info');
    addLog('Target: ESP32-WROVER-B | 1.44" ST7735 TFT (128x128) | 5x AW9523B RGB LEDs', 'info');

    return () => {
      flasherRef.current?.disconnect();
    };
  }, [addLog]);

  // Transmit virtual simulator button/joystick state -> physical CyberPi over Web Serial
  useEffect(() => {
    if (!isConnected || !flasherRef.current) return;
    const cmd = `SIM:${virtualInputs.btnA ? 1 : 0},${virtualInputs.btnB ? 1 : 0},${virtualInputs.joyX},${virtualInputs.joyY},${virtualInputs.joyCenter ? 1 : 0}`;
    flasherRef.current.sendRawLine(cmd);
  }, [isConnected, virtualInputs]);

  const handleInputChange = useCallback((newInputs: Partial<CyberPiInputs>) => {
    setVirtualInputs((prev) => ({ ...prev, ...newInputs }));
  }, []);

  const handleDisplayModeChange = useCallback(
    (nextMode: DisplayMode) => {
      setDisplayMode(nextMode);
      if (isConnected && flasherRef.current) {
        const hwPage = modeToHwPage(nextMode);
        lastHwPageRef.current = hwPage;
        flasherRef.current.sendRawLine(`MODE:${hwPage}`);
      }
    },
    [isConnected]
  );

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
      <header className="border-b border-zinc-800 bg-zinc-950/90 backdrop-blur-md sticky top-0 z-40 px-6 py-3.5">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-600 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-900/30 shrink-0">
              <Cpu className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold text-white tracking-tight">
                CyberPi Web Flasher &amp; Hardware Simulator
              </h1>
              <p className="text-xs text-zinc-400">
                ESP32-WROVER-B · Compile with ESP-IDF via GitHub Actions &amp; flash over Web Serial
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <a
              href="cyberpi-capabilities-guide.pdf"
              download="CyberPi_Capabilities_Guide.pdf"
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-cyan-950/70 hover:bg-cyan-900/80 text-cyan-200 text-xs font-semibold border border-cyan-700/70 transition-colors shadow-sm whitespace-nowrap shrink-0"
            >
              <FileText className="w-4 h-4 text-cyan-400" />
              <span>Capabilities PDF</span>
            </a>

            <button
              type="button"
              onClick={() => setIsCiCdOpen(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold border border-zinc-700 transition-colors shadow-sm whitespace-nowrap shrink-0 cursor-pointer"
            >
              <GitBranch className="w-4 h-4 text-cyan-400" />
              <span>CI/CD &amp; Source Files</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Grid View */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: CyberPi Hardware Simulator (6 cols for full landscape fidelity) */}
        <div className="lg:col-span-6 flex flex-col items-center">
          <div className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl p-5 shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4 pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-white tracking-tight">
                  Hardware Simulator
                </h2>
                {isConnected && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-700/70 text-[10px] font-mono text-emerald-300">
                    <ArrowLeftRight className="w-3 h-3" />
                    2-Way Sync
                  </span>
                )}
              </div>
              <span className="text-xs font-mono text-zinc-400">
                1.44" ST7735 128×128 · 5-Way Joystick · Buttons A/B · Home
              </span>
            </div>

            {/* CyberPi Reference Hardware Stage */}
            <CyberPiChassis
              inputs={inputs}
              onInputChange={handleInputChange}
              displayMode={displayMode}
              onDisplayModeChange={handleDisplayModeChange}
              externalHomePressed={hwHomePressed}
            />

            {/* Keyboard & Click Hint */}
            <div className="mt-4 pt-3 border-t border-zinc-800 text-[11px] text-zinc-400">
              <span className="font-semibold text-zinc-300 block mb-1.5">
                Click controls directly on the CyberPi chassis or use keyboard shortcuts:
              </span>
              <div className="grid grid-cols-2 gap-1.5 font-mono text-[10px]">
                <div className="bg-zinc-950 px-2.5 py-1.5 rounded border border-zinc-800/80">
                  <span className="text-cyan-400">Arrow Keys:</span> 5-Way Joystick
                </div>
                <div className="bg-zinc-950 px-2.5 py-1.5 rounded border border-zinc-800/80">
                  <span className="text-emerald-400">Enter / Space:</span> Joy Press
                </div>
                <div className="bg-zinc-950 px-2.5 py-1.5 rounded border border-zinc-800/80">
                  <span className="text-rose-400">'A' Key:</span> Triangle Btn A (AW P0.6)
                </div>
                <div className="bg-zinc-950 px-2.5 py-1.5 rounded border border-zinc-800/80">
                  <span className="text-blue-400">'B' Key:</span> Square Btn B (AW P0.5)
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: ESP32 Flasher Panel + Live Serial Terminal (6 cols) */}
        <div className="lg:col-span-6 flex flex-col gap-6">
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
            Makeblock CyberPi (ESP32-WROVER-B, 8MB Flash, 8MB PSRAM, ST7735 LCD).
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
