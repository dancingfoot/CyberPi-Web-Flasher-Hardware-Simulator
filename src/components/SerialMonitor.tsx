import React, { useState, useRef, useEffect } from 'react';
import { Terminal, Send, Trash2, ArrowDownCircle, CheckSquare, Square } from 'lucide-react';

export interface LogEntry {
  id: string;
  timestamp: string;
  text: string;
  type: 'info' | 'rx' | 'tx' | 'error' | 'success';
}

interface SerialMonitorProps {
  logs: LogEntry[];
  isConnected: boolean;
  baudRate: number;
  onSendCommand: (cmd: string) => void;
  onClear: () => void;
}

export const SerialMonitor: React.FC<SerialMonitorProps> = ({
  logs,
  isConnected,
  baudRate,
  onSendCommand,
  onClear
}) => {
  const [inputVal, setInputVal] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [showTimestamps, setShowTimestamps] = useState(true);
  const terminalContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && terminalContainerRef.current) {
      terminalContainerRef.current.scrollTop = terminalContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputVal.trim()) return;
    onSendCommand(inputVal);
    setInputVal('');
  };

  const quickCommands = [
    { label: 'help', cmd: 'help' },
    { label: 'status', cmd: 'status' },
    { label: 'RGB Wave', cmd: 'led 0 255 200' },
    { label: 'Beep', cmd: 'beep 1200 150' },
    { label: 'Reboot', cmd: 'reboot' }
  ];

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-2xl flex flex-col h-[250px] shadow-xl overflow-hidden">
      {/* Terminal Header */}
      <div className="px-4 py-2 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-mono font-bold text-zinc-200">
            Serial Terminal ({baudRate} baud)
          </span>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">
            {logs.length} lines
          </span>
        </div>

        <div className="flex items-center gap-3 text-xs text-zinc-400">
          <button
            type="button"
            onClick={() => setAutoScroll(!autoScroll)}
            className="flex items-center gap-1 hover:text-white transition-colors"
            title="Toggle autoscroll"
          >
            {autoScroll ? <CheckSquare className="w-3.5 h-3.5 text-cyan-400" /> : <Square className="w-3.5 h-3.5" />}
            <span>Auto-scroll</span>
          </button>

          <button
            type="button"
            onClick={onClear}
            className="flex items-center gap-1 hover:text-rose-400 transition-colors"
            title="Clear terminal buffer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear</span>
          </button>
        </div>
      </div>

      {/* Terminal Log Output Window */}
      <div
        ref={terminalContainerRef}
        className="flex-1 p-3 overflow-y-auto font-mono text-[11px] leading-relaxed space-y-1 select-text"
      >
        {logs.length === 0 ? (
          <div className="text-zinc-600 italic py-6 text-center">
            [Serial output will appear here once connected to CyberPi]
          </div>
        ) : (
          logs.map((log) => {
            let textColor = 'text-zinc-300';
            if (log.type === 'error') textColor = 'text-rose-400 font-semibold';
            else if (log.type === 'success') textColor = 'text-emerald-400 font-semibold';
            else if (log.type === 'tx') textColor = 'text-cyan-400';
            else if (log.type === 'info') textColor = 'text-amber-300';

            return (
              <div key={log.id} className="flex items-start gap-2 break-all">
                {showTimestamps && (
                  <span className="text-zinc-600 select-none shrink-0">
                    [{log.timestamp}]
                  </span>
                )}
                <span className={textColor}>{log.text}</span>
              </div>
            );
          })
        )}
      </div>

      {/* Quick Command Chips */}
      <div className="px-3 py-1.5 bg-zinc-900/60 border-t border-zinc-800/80 flex items-center gap-1.5 overflow-x-auto text-[11px]">
        <span className="text-zinc-500 font-mono text-[10px] uppercase">Quick:</span>
        {quickCommands.map((q) => (
          <button
            key={q.cmd}
            type="button"
            disabled={!isConnected}
            onClick={() => onSendCommand(q.cmd)}
            className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-cyan-900 hover:text-cyan-200 text-zinc-300 font-mono disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            {q.label}
          </button>
        ))}
      </div>

      {/* Terminal Input Form */}
      <form onSubmit={handleSubmit} className="p-2.5 bg-zinc-900 border-t border-zinc-800 flex gap-2">
        <input
          type="text"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          placeholder={isConnected ? 'Type command (e.g., status, led 255 0 0) and press Enter...' : 'Connect CyberPi to send commands...'}
          disabled={!isConnected}
          className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-200 font-mono focus:outline-none focus:border-cyan-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!isConnected || !inputVal.trim()}
          className="px-3.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
        >
          <Send className="w-3.5 h-3.5" />
          Send
        </button>
      </form>
    </div>
  );
};
