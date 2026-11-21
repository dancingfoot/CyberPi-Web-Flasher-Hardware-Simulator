import React, { useState } from 'react';
import { GitBranch, Copy, Check, Download, FileCode, X } from 'lucide-react';

interface CiCdModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const FILES: Record<string, { filename: string; path: string; language: string; content: string }> = {
  workflow: {
    filename: 'main.yml',
    path: '.github/workflows/main.yml',
    language: 'yaml',
    content: `name: Build ESP-IDF Firmware & Deploy Web Flasher

on:
  push:
    branches:
      - main
      - master
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: 'pages'
  cancel-in-progress: true

jobs:
  build-firmware:
    name: Build ESP-IDF Firmware
    runs-on: ubuntu-latest
    container:
      image: espressif/idf:v5.2.1

    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4
        with:
          submodules: recursive

      - name: Configure ESP-IDF for ESP32 (CyberPi)
        working-directory: firmware
        run: |
          . $IDF_PATH/export.sh
          idf.py set-target esp32

      - name: Compile Firmware
        working-directory: firmware
        run: |
          . $IDF_PATH/export.sh
          idf.py build

      - name: Merge Binaries for Single-File Web Flashing
        working-directory: firmware
        run: |
          . $IDF_PATH/export.sh
          python -m esptool --chip esp32 merge_bin \\
            -o build/cyberpi_merged.bin \\
            --flash_mode dio \\
            --flash_freq 40m \\
            --flash_size 16MB \\
            0x1000 build/bootloader/bootloader.bin \\
            0x8000 build/partition_table/partition-table.bin \\
            0x10000 build/cyberpi_firmware.bin

      - name: Stage Firmware Binaries
        run: |
          mkdir -p output/bin
          cp firmware/build/bootloader/bootloader.bin output/bin/bootloader.bin
          cp firmware/build/partition_table/partition-table.bin output/bin/partition-table.bin
          cp firmware/build/cyberpi_firmware.bin output/bin/app.bin
          cp firmware/build/cyberpi_merged.bin output/bin/cyberpi_merged.bin

      - name: Upload Raw Firmware Artifacts
        uses: actions/upload-artifact@v4
        with:
          name: cyberpi-binaries
          path: output/bin/

  deploy-pages:
    name: Build Web App & Deploy to GitHub Pages
    needs: build-firmware
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}

    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - name: Install Web Dependencies & Build App
        run: |
          npm ci
          npm run build

      - name: Download Compiled Firmware Artifacts into dist/bin
        uses: actions/download-artifact@v4
        with:
          name: cyberpi-binaries
          path: dist/bin/

      - name: Setup GitHub Pages
        uses: actions/configure-pages@v5

      - name: Upload Pages Artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: dist/

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4`
  },
  main_cpp: {
    filename: 'main.cpp',
    path: 'firmware/main/main.cpp',
    language: 'cpp',
    content: `/**
 * Makeblock CyberPi (ESP32-WROVER-B) Sample Firmware
 * Pin mappings:
 *   - TFT LCD (ST7735 128x128): MOSI=23, SCLK=18, CS=5, DC=19, RST=21, BL=22
 *   - Joystick: Up=35, Down=39, Left=34, Right=36, Center=2
 *   - Buttons: Button A=0, Button B=32
 *   - RGB Strip (WS2812B 5 LEDs): GPIO 27
 */

#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_timer.h"

static const char *TAG = "CyberPi_App";

#define PIN_BTN_A        GPIO_NUM_0
#define PIN_BTN_B        GPIO_NUM_32
#define PIN_JOY_PRESS    GPIO_NUM_2
#define PIN_JOY_UP       GPIO_NUM_35
#define PIN_JOY_DOWN     GPIO_NUM_39
#define PIN_JOY_LEFT     GPIO_NUM_34
#define PIN_JOY_RIGHT    GPIO_NUM_36

static void configure_input_pin(gpio_num_t pin, bool enable_pullup) {
    gpio_config_t io_conf = {};
    io_conf.intr_type = GPIO_INTR_DISABLE;
    io_conf.mode = GPIO_MODE_INPUT;
    io_conf.pin_bit_mask = (1ULL << pin);
    io_conf.pull_up_en = enable_pullup ? GPIO_PULLUP_ENABLE : GPIO_PULLUP_DISABLE;
    io_conf.pull_down_en = GPIO_PULLDOWN_DISABLE;
    gpio_config(&io_conf);
}

extern "C" void app_main(void) {
    ESP_LOGI(TAG, "CyberPi Hardware Initialized (ESP32-WROVER-B)");

    configure_input_pin(PIN_BTN_A, true);
    configure_input_pin(PIN_BTN_B, true);
    configure_input_pin(PIN_JOY_PRESS, true);
    configure_input_pin(PIN_JOY_UP, false);
    configure_input_pin(PIN_JOY_DOWN, false);
    configure_input_pin(PIN_JOY_LEFT, false);
    configure_input_pin(PIN_JOY_RIGHT, false);

    uint32_t frame = 0;
    while (true) {
        bool btn_a = (gpio_get_level(PIN_BTN_A) == 0);
        bool btn_b = (gpio_get_level(PIN_BTN_B) == 0);
        bool joy_press = (gpio_get_level(PIN_JOY_PRESS) == 0);

        int joy_x = 0;
        if (gpio_get_level(PIN_JOY_LEFT) == 0) joy_x = -1;
        else if (gpio_get_level(PIN_JOY_RIGHT) == 0) joy_x = 1;

        int joy_y = 0;
        if (gpio_get_level(PIN_JOY_UP) == 0) joy_y = -1;
        else if (gpio_get_level(PIN_JOY_DOWN) == 0) joy_y = 1;

        printf("{\\"frame\\":%lu,\\"btnA\\":%d,\\"btnB\\":%d,\\"joyX\\":%d,\\"joyY\\":%d,\\"joyCenter\\":%d,\\"uptime_ms\\":%lld}\\n",
               frame++, btn_a ? 1 : 0, btn_b ? 1 : 0, joy_x, joy_y, joy_press ? 1 : 0, esp_timer_get_time() / 1000);

        vTaskDelay(pdMS_TO_TICKS(100));
    }
}`
  },
  main_cmake: {
    filename: 'main/CMakeLists.txt',
    path: 'firmware/main/CMakeLists.txt',
    language: 'cmake',
    content: `idf_component_register(
    SRCS "main.cpp"
    INCLUDE_DIRS "."
    REQUIRES driver esp_timer esp_log
)`
  },
  root_cmake: {
    filename: 'CMakeLists.txt',
    path: 'firmware/CMakeLists.txt',
    language: 'cmake',
    content: `cmake_minimum_required(VERSION 3.16)
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(cyberpi_firmware)`
  },
  sdkconfig: {
    filename: 'sdkconfig.defaults',
    path: 'firmware/sdkconfig.defaults',
    language: 'ini',
    content: `CONFIG_IDF_TARGET="esp32"
CONFIG_ESPTOOLPY_FLASHSIZE_16MB=y
CONFIG_ESPTOOLPY_FLASHMODE_DIO=y
CONFIG_ESPTOOLPY_FLASHFREQ_40M=y
CONFIG_ESP32_SPIRAM_SUPPORT=y
CONFIG_SPIRAM_BOOT_INIT=y
CONFIG_SPIRAM_USE_MALLOC=y
CONFIG_LOG_DEFAULT_LEVEL_INFO=y`
  }
};

export const CiCdModal: React.FC<CiCdModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<string>('workflow');
  const [copied, setCopied] = useState<boolean>(false);

  if (!isOpen) return null;

  const currentFile = FILES[activeTab];

  const handleCopy = () => {
    navigator.clipboard.writeText(currentFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([currentFile.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = currentFile.filename.split('/').pop() || currentFile.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl max-w-4xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="p-5 bg-zinc-950 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-950 border border-cyan-800 text-cyan-400">
              <GitBranch className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                CI/CD Workflow & ESP-IDF Repository Source Files
              </h2>
              <p className="text-xs text-zinc-400">
                Included in this repository for automated compilation on GitHub Actions & deployment to Pages
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="flex items-center gap-1 px-5 pt-3 bg-zinc-950/60 border-b border-zinc-800 overflow-x-auto">
          {Object.entries(FILES).map(([key, item]) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-2 px-3.5 py-2 text-xs font-mono font-medium rounded-t-lg transition-colors border-t border-x shrink-0 ${
                activeTab === key
                  ? 'bg-zinc-900 text-cyan-300 border-zinc-700'
                  : 'bg-transparent text-zinc-400 border-transparent hover:text-zinc-200'
              }`}
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>{item.filename}</span>
            </button>
          ))}
        </div>

        {/* Action Bar for Active File */}
        <div className="px-5 py-2.5 bg-zinc-900/90 border-b border-zinc-800 flex items-center justify-between text-xs font-mono">
          <span className="text-zinc-400">
            Path: <strong className="text-zinc-200">{currentFile.path}</strong>
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied!' : 'Copy Code'}</span>
            </button>

            <button
              type="button"
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-cyan-700 hover:bg-cyan-600 text-white transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download File</span>
            </button>
          </div>
        </div>

        {/* Code Content Window */}
        <div className="flex-1 p-5 overflow-y-auto bg-zinc-950">
          <pre className="font-mono text-xs text-zinc-300 leading-relaxed overflow-x-auto p-4 bg-zinc-900/50 rounded-xl border border-zinc-800 select-all">
            {currentFile.content}
          </pre>
        </div>

        {/* Modal Footer Instructions */}
        <div className="p-4 bg-zinc-950 border-t border-zinc-800 flex items-center justify-between text-xs text-zinc-400">
          <span>
            Push this repo to GitHub and enable <strong>Settings &gt; Pages &gt; GitHub Actions</strong> to compile into <code>bin/</code>.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
