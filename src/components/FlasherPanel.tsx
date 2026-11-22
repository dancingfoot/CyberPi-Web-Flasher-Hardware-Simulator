import React, { useState } from 'react';
import { FlashProgress } from '../flasher/flashingEngine.ts';
import { FirmwarePreset } from '../simulator/types.ts';
import { validateFirmwareOffset } from '../simulator/engine.ts';
import { Zap, Usb, AlertTriangle, Layers, ExternalLink, Download } from 'lucide-react';

interface FlasherPanelProps {
  isConnected: boolean;
  hasWebSerial: boolean;
  serialBlocked: boolean;
  flashProgress: FlashProgress;
  onConnect: (baud: number) => Promise<void>;
  onDisconnect: () => Promise<void>;
  onFlash: (buffer: ArrayBuffer, offset: number, name: string) => Promise<void>;
}

const PRESET_FIRMWARES: FirmwarePreset[] = [
  {
    id: 'ci-app',
    name: 'Compiled App Binary (app.bin)',
    description: 'ESP-IDF v5.2.1 C++ app with 2-way simulator sync, ST7735 LCD & AW9523B RGB (317 KB)',
    version: 'v5.2.1',
    targetOffset: 0x10000,
    sizeBytes: 324128,
    filename: 'bin/app.bin'
  },
  {
    id: 'ci-merged',
    name: 'Merged Full Image (cyberpi_merged.bin)',
    description: 'Bootloader + partition table + 2-way sync CyberPi LCD/RGB app (381 KB) in bin/cyberpi_merged.bin',
    version: 'v5.2.1',
    targetOffset: 0x0,
    sizeBytes: 389664,
    filename: 'bin/cyberpi_merged.bin'
  },
  {
    id: 'ci-bootloader',
    name: 'ESP-IDF Bootloader (bootloader.bin)',
    description: 'Second-stage ESP32 bootloader (27 KB, DIO 40MHz 8MB) in bin/bootloader.bin',
    version: 'v5.2.1',
    targetOffset: 0x1000,
    sizeBytes: 26720,
    filename: 'bin/bootloader.bin'
  }
];

export const FlasherPanel: React.FC<FlasherPanelProps> = ({
  isConnected,
  hasWebSerial,
  serialBlocked,
  flashProgress,
  onConnect,
  onDisconnect,
  onFlash
}) => {
  const [baudRate, setBaudRate] = useState<number>(115200);
  const [selectedPresetId, setSelectedPresetId] = useState<string>('ci-merged');
  const [useCustomFile, setUseCustomFile] = useState<boolean>(false);
  const [customFile, setCustomFile] = useState<File | null>(null);
  const [customOffsetHex, setCustomOffsetHex] = useState<string>('0x10000');
  const [presetError, setPresetError] = useState<string | null>(null);
  const [isFetchingPreset, setIsFetchingPreset] = useState<boolean>(false);

  const offsetValidation = validateFirmwareOffset(customOffsetHex);
  const isFlashing =
    flashProgress.stage !== 'idle' &&
    flashProgress.stage !== 'done' &&
    flashProgress.stage !== 'error';

  const handleStartFlash = async () => {
    setPresetError(null);

    if (useCustomFile) {
      if (!customFile) return;
      const buffer = await customFile.arrayBuffer();
      await onFlash(buffer, offsetValidation.offset, customFile.name);
      return;
    }

    const preset = PRESET_FIRMWARES.find((p) => p.id === selectedPresetId);
    if (!preset) return;

    try {
      setIsFetchingPreset(true);
      const response = await fetch(preset.filename);
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok || contentType.includes('text/html')) {
        setPresetError(
          `Compiled binary "${preset.filename}" is not present on this server yet. Deploy via GitHub Actions or switch to "Upload .bin" to flash a local firmware file.`
        );
        return;
      }

      const buffer = await response.arrayBuffer();
      if (buffer.byteLength === 0) {
        setPresetError(`Fetched binary "${preset.filename}" is empty.`);
        return;
      }
      await onFlash(buffer, preset.targetOffset, preset.name);
    } catch (err: any) {
      setPresetError(`Failed to load "${preset.filename}": ${err?.message || String(err)}`);
    } finally {
      setIsFetchingPreset(false);
    }
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 shadow-xl">
      {/* Title & Connection Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-zinc-800">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Zap className="w-5 h-5 text-cyan-400" />
            ESP32 Web Flasher
          </h2>
          <p className="text-xs text-zinc-400">
            Connect via the browser Web Serial window to flash ESP-IDF firmware over USB-C
          </p>
        </div>

        {/* Status Badge */}
        <div className="flex items-center gap-2">
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              isConnected
                ? 'bg-emerald-400 shadow-[0_0_8px_#10b981]'
                : 'bg-rose-500'
            }`}
          />
          <span className="text-xs font-mono font-medium text-zinc-300">
            {isConnected ? 'CyberPi Connected' : 'Disconnected'}
          </span>
        </div>
      </div>

      {/* Connection Action Bar */}
      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        {!isConnected ? (
          <button
            type="button"
            onClick={() => onConnect(baudRate)}
            className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold rounded-xl shadow-lg shadow-cyan-900/30 transition-colors cursor-pointer"
          >
            <Usb className="w-4 h-4" />
            Connect CyberPi (USB-C)
          </button>
        ) : (
          <button
            type="button"
            onClick={onDisconnect}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-rose-950 hover:text-rose-400 text-zinc-300 text-sm font-medium rounded-xl border border-zinc-700 transition-colors cursor-pointer"
          >
            Disconnect Port
          </button>
        )}

        <div className="ml-auto flex items-center gap-2 text-xs text-zinc-400">
          <label htmlFor="baud-rate" className="font-mono">Baud:</label>
          <select
            id="baud-rate"
            value={baudRate}
            disabled={isConnected}
            onChange={(e) => setBaudRate(Number(e.target.value))}
            className="bg-zinc-950 border border-zinc-700 text-zinc-200 text-xs rounded-lg px-2 py-1.5 font-mono focus:outline-none focus:border-cyan-500"
          >
            <option value={115200}>115,200 (Standard)</option>
            <option value={460800}>460,800 (High-Speed Flash)</option>
            <option value={921600}>921,600 (Fastest)</option>
          </select>
        </div>
      </div>

      {!hasWebSerial && (
        <div className="mt-3 p-2.5 bg-amber-950/40 border border-amber-800/60 rounded-xl flex items-start gap-2 text-xs text-amber-300">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
          <span>
            Web Serial API is not available in this browser. Please open this page in Google Chrome, Microsoft Edge, or Opera over HTTPS to open the serial port window.
          </span>
        </div>
      )}

      {serialBlocked && typeof window !== 'undefined' && (
        <div className="mt-3 p-2.5 bg-amber-950/40 border border-amber-800/60 rounded-xl flex items-center justify-between gap-3 text-xs text-amber-200">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
            <span>
              Web Serial is blocked inside this embedded frame. Open the app in a standalone tab to select your CyberPi USB port.
            </span>
          </div>
          <a
            href={window.location.href}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-semibold transition-colors"
          >
            <span>Open Tab</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      )}

      {/* Firmware Selection Section */}
      <div className="mt-5 pt-4 border-t border-zinc-800">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
            Select Firmware Target
          </span>
          <div className="flex bg-zinc-950 p-0.5 rounded-lg border border-zinc-800 text-xs">
            <button
              type="button"
              onClick={() => {
                setUseCustomFile(false);
                setPresetError(null);
              }}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                !useCustomFile ? 'bg-cyan-600 text-white' : 'text-zinc-400 hover:text-white'
              }`}
            >
              CI Artifacts
            </button>
            <button
              type="button"
              onClick={() => {
                setUseCustomFile(true);
                setPresetError(null);
              }}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                useCustomFile ? 'bg-cyan-600 text-white' : 'text-zinc-400 hover:text-white'
              }`}
            >
              Upload .bin
            </button>
          </div>
        </div>

        {!useCustomFile ? (
          <div className="space-y-2">
            {PRESET_FIRMWARES.map((preset) => (
              <label
                key={preset.id}
                className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                  selectedPresetId === preset.id
                    ? 'bg-cyan-950/40 border-cyan-500/80 shadow-md shadow-cyan-950/30'
                    : 'bg-zinc-950/50 border-zinc-800 hover:border-zinc-700'
                }`}
              >
                <input
                  type="radio"
                  name="preset-fw"
                  checked={selectedPresetId === preset.id}
                  onChange={() => {
                    setSelectedPresetId(preset.id);
                    setPresetError(null);
                  }}
                  className="mt-1 text-cyan-500 focus:ring-cyan-500"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-white truncate">{preset.name}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-cyan-300">
                        Offset 0x{preset.targetOffset.toString(16).toUpperCase()}
                      </span>
                      <a
                        href={preset.filename}
                        download={preset.filename.split('/').pop()}
                        onClick={(e) => e.stopPropagation()}
                        title={`Download ${preset.filename.split('/').pop()}`}
                        aria-label={`Download ${preset.filename.split('/').pop()}`}
                        className="p-1 rounded bg-zinc-800 hover:bg-cyan-700 text-zinc-300 hover:text-white transition-colors"
                      >
                        <Download className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                  <p className="text-xs text-zinc-400 mt-0.5">{preset.description}</p>
                </div>
              </label>
            ))}

            {presetError && (
              <div className="p-2.5 bg-rose-950/50 border border-rose-800/70 rounded-xl text-xs text-rose-200">
                {presetError}
              </div>
            )}
          </div>
        ) : (
          <div className="p-3.5 bg-zinc-950/70 border border-zinc-800 rounded-xl space-y-3">
            <div>
              <label htmlFor="custom-bin-input" className="text-xs text-zinc-300 block mb-1.5 font-medium">
                Firmware Binary (.bin)
              </label>
              <input
                id="custom-bin-input"
                type="file"
                accept=".bin"
                onChange={(e) => setCustomFile(e.target.files?.[0] || null)}
                className="block w-full text-xs text-zinc-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-zinc-800 file:text-zinc-200 hover:file:bg-zinc-700 cursor-pointer"
              />
            </div>

            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label htmlFor="flash-offset-input" className="text-xs text-zinc-400 block mb-1">
                  Flash Target Address Offset
                </label>
                <input
                  id="flash-offset-input"
                  type="text"
                  value={customOffsetHex}
                  onChange={(e) => setCustomOffsetHex(e.target.value)}
                  placeholder="0x10000"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div className="pt-5">
                <span
                  className={`text-[11px] font-mono px-2 py-1 rounded ${
                    offsetValidation.valid
                      ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800'
                      : 'bg-rose-950/80 text-rose-300 border border-rose-800'
                  }`}
                >
                  {offsetValidation.label}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Flashing Progress Bar & Controls */}
      <div className="mt-5 pt-4 border-t border-zinc-800">
        <button
          type="button"
          disabled={
            !isConnected ||
            isFlashing ||
            isFetchingPreset ||
            (useCustomFile && (!customFile || !offsetValidation.valid))
          }
          onClick={handleStartFlash}
          className={`w-full py-2.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 shadow-lg transition-all ${
            !isConnected || isFlashing || isFetchingPreset
              ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
              : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-950/50 cursor-pointer'
          }`}
        >
          <Zap className="w-4 h-4" />
          {isFlashing
            ? 'Flashing ESP32 Flash Memory...'
            : isFetchingPreset
              ? 'Loading Firmware Binary...'
              : 'Flash Firmware to CyberPi'}
        </button>

        {/* Progress Display */}
        <div className="mt-3">
          <div className="flex justify-between items-center text-xs mb-1.5">
            <span className="font-mono text-zinc-300">{flashProgress.message}</span>
            <span className="font-mono font-bold text-cyan-400">{flashProgress.percent}%</span>
          </div>

          <div className="w-full h-2.5 bg-zinc-950 rounded-full overflow-hidden border border-zinc-800">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-150 ease-out"
              style={{ width: `${flashProgress.percent}%` }}
            />
          </div>

          <div className="flex justify-between items-center text-[10px] text-zinc-400 font-mono mt-1">
            <span>
              {flashProgress.writtenBytes > 0
                ? `${(flashProgress.writtenBytes / 1024).toFixed(1)} / ${(flashProgress.totalBytes / 1024).toFixed(1)} KB`
                : 'Flash Size: 8MB DIO'}
            </span>
            {flashProgress.speedKBps > 0 && (
              <span>Rate: {flashProgress.speedKBps.toFixed(1)} KB/s</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
