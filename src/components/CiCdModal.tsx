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
            --flash_size 8MB \\
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
 * Makeblock CyberPi (ESP32-WROVER-B) Sample Firmware (Pure ESP-IDF v5.2.1)
 *
 * Verified CyberPi Hardware Mapping:
 *   - I2C Bus (I2C_NUM_1, 400 kHz): SDA=GPIO 19, SCL=GPIO 18
 *   - AW9523B #1 (0x5B): 5x Onboard RGB LEDs (15 PWM channels REG_DIM00..0E)
 *   - AW9523B #2 (0x58): Digital Inputs (active-low) & LCD Control Outputs
 *       Inputs:  JOY_LEFT=P0.0, JOY_UP=P0.1, JOY_RIGHT=P0.2, JOY_CENTER=P0.3,
 *                JOY_DOWN=P0.4, BTN_B=P0.5, BTN_A=P0.6, BTN_HOME=P1.0
 *       Outputs: LCD_DC=P1.4, LCD_RST=P1.5, LCD_BL=P1.7
 *   - TFT LCD (ST7735 128x128, SPI2_HOST @ 20 MHz):
 *       MOSI=GPIO 2, CLK=GPIO 4, CS=GPIO 12 (X_OFFSET=3, Y_OFFSET=2)
 */

#include <stdio.h>
#include <string.h>
#include <math.h>
#include <fcntl.h>
#include <unistd.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"
#include "driver/i2c.h"
#include "driver/spi_master.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_timer.h"

static const char *TAG = "CyberPi_App";

// -----------------------------------------------------------------------------
// I2C & AW9523B Expander Definitions
// -----------------------------------------------------------------------------
#define CYBERPI_I2C_PORT        I2C_NUM_1
#define CYBERPI_I2C_SDA         GPIO_NUM_19
#define CYBERPI_I2C_SCL         GPIO_NUM_18
#define CYBERPI_I2C_FREQ_HZ     400000

#define AW_ADDR_LEDS            0x5B
#define AW_ADDR_IO              0x58

#define AW_REG_INPUT_P0         0x00
#define AW_REG_INPUT_P1         0x01
#define AW_REG_OUTPUT_P0        0x02
#define AW_REG_OUTPUT_P1        0x03
#define AW_REG_CONFIG_P0        0x04
#define AW_REG_CONFIG_P1        0x05
#define AW_REG_CTRL             0x11
#define AW_REG_WORK_MODE_P0     0x12
#define AW_REG_WORK_MODE_P1     0x13
#define AW_REG_DIM00            0x20
#define AW_REG_SWRST            0x7F

typedef enum {
    AW_P0_0 = 0, AW_P0_1, AW_P0_2, AW_P0_3, AW_P0_4, AW_P0_5, AW_P0_6, AW_P0_7,
    AW_P1_0 = 8, AW_P1_1, AW_P1_2, AW_P1_3, AW_P1_4, AW_P1_5, AW_P1_6, AW_P1_7
} aw_pin_t;

// Controls on AW9523B (0x58)
#define JOY_LEFT_PIN            AW_P0_0
#define JOY_UP_PIN              AW_P0_1
#define JOY_RIGHT_PIN           AW_P0_2
#define JOY_CENTER_PIN          AW_P0_3
#define JOY_DOWN_PIN            AW_P0_4
#define BTN_B_PIN               AW_P0_5
#define BTN_A_PIN               AW_P0_6
#define BTN_HOME_PIN            AW_P1_0

// LCD Control Signals on AW9523B (0x58)
#define LCD_DC_PIN              AW_P1_4
#define LCD_RST_PIN             AW_P1_5
#define LCD_BL_PIN              AW_P1_7

// -----------------------------------------------------------------------------
// ST7735 128x128 SPI LCD Definitions
// -----------------------------------------------------------------------------
#define LCD_SPI_HOST            SPI2_HOST
#define LCD_PIN_MOSI            GPIO_NUM_2
#define LCD_PIN_MISO            GPIO_NUM_26
#define LCD_PIN_CLK             GPIO_NUM_4
#define LCD_PIN_CS              GPIO_NUM_12
#define LCD_SPI_CLOCK_HZ        (20 * 1000 * 1000)

#define LCD_WIDTH               128
#define LCD_HEIGHT              128
#define LCD_XSTART              3
#define LCD_YSTART              2

#define ST7735_SWRESET          0x01
#define ST7735_SLPOUT           0x11
#define ST7735_NORON            0x13
#define ST7735_INVOFF           0x20
#define ST7735_DISPON           0x29
#define ST7735_CASET            0x2A
#define ST7735_RASET            0x2B
#define ST7735_RAMWR            0x2C
#define ST7735_MADCTL           0x36
#define ST7735_COLMOD           0x3A
#define ST7735_FRMCTR1          0xB1
#define ST7735_FRMCTR2          0xB2
#define ST7735_FRMCTR3          0xB3
#define ST7735_INVCTR           0xB4
#define ST7735_PWCTR1           0xC0
#define ST7735_PWCTR2           0xC1
#define ST7735_PWCTR3           0xC2
#define ST7735_PWCTR4           0xC3
#define ST7735_PWCTR5           0xC4
#define ST7735_VMCTR1           0xC5
#define ST7735_GMCTRP1          0xE0
#define ST7735_GMCTRN1          0xE1

static uint8_t s_aw_out_p0 = 0x00;
static uint8_t s_aw_out_p1 = 0x00;
static uint8_t s_aw_cfg_p0 = 0xFF; // 1 = input, 0 = output
static uint8_t s_aw_cfg_p1 = 0xFF;
static uint8_t s_dc_cached = 0xFF;

static spi_device_handle_t s_lcd_spi = NULL;
static uint16_t *s_fb = NULL; // 128x128 RGB565 (byte-swapped for ST7735 SPI)

// -----------------------------------------------------------------------------
// I2C & AW9523B Drivers
// -----------------------------------------------------------------------------
static esp_err_t i2c_write_reg(uint8_t addr, uint8_t reg, uint8_t val) {
    uint8_t buf[2] = {reg, val};
    return i2c_master_write_to_device(CYBERPI_I2C_PORT, addr, buf, sizeof(buf), pdMS_TO_TICKS(100));
}

static esp_err_t i2c_write_block(uint8_t addr, uint8_t reg, const uint8_t *data, size_t len) {
    uint8_t buf[32];
    if (len + 1 > sizeof(buf)) return ESP_ERR_INVALID_ARG;
    buf[0] = reg;
    memcpy(&buf[1], data, len);
    return i2c_master_write_to_device(CYBERPI_I2C_PORT, addr, buf, len + 1, pdMS_TO_TICKS(100));
}

static uint8_t i2c_read_reg(uint8_t addr, uint8_t reg) {
    uint8_t val = 0xFF;
    i2c_master_write_read_device(CYBERPI_I2C_PORT, addr, &reg, 1, &val, 1, pdMS_TO_TICKS(50));
    return val;
}

static void cyberpi_i2c_init(void) {
    i2c_config_t conf = {};
    conf.mode = I2C_MODE_MASTER;
    conf.sda_io_num = CYBERPI_I2C_SDA;
    conf.scl_io_num = CYBERPI_I2C_SCL;
    conf.sda_pullup_en = GPIO_PULLUP_ENABLE;
    conf.scl_pullup_en = GPIO_PULLUP_ENABLE;
    conf.master.clk_speed = CYBERPI_I2C_FREQ_HZ;
    conf.clk_flags = 0;

    ESP_ERROR_CHECK(i2c_param_config(CYBERPI_I2C_PORT, &conf));
    ESP_ERROR_CHECK(i2c_driver_install(CYBERPI_I2C_PORT, conf.mode, 0, 0, 0));
}

static void aw_pin_mode_output(aw_pin_t pin, bool is_output) {
    uint8_t bit = (uint8_t)(pin & 0x07);
    if (pin < 8) {
        if (is_output) s_aw_cfg_p0 &= (uint8_t)~(1U << bit);
        else           s_aw_cfg_p0 |= (uint8_t)(1U << bit);
        i2c_write_reg(AW_ADDR_IO, AW_REG_CONFIG_P0, s_aw_cfg_p0);
    } else {
        if (is_output) s_aw_cfg_p1 &= (uint8_t)~(1U << bit);
        else           s_aw_cfg_p1 |= (uint8_t)(1U << bit);
        i2c_write_reg(AW_ADDR_IO, AW_REG_CONFIG_P1, s_aw_cfg_p1);
    }
}

static void aw_digital_write(aw_pin_t pin, uint8_t level) {
    uint8_t bit = (uint8_t)(pin & 0x07);
    if (pin < 8) {
        if (level) s_aw_out_p0 |= (uint8_t)(1U << bit);
        else       s_aw_out_p0 &= (uint8_t)~(1U << bit);
        i2c_write_reg(AW_ADDR_IO, AW_REG_OUTPUT_P0, s_aw_out_p0);
    } else {
        if (level) s_aw_out_p1 |= (uint8_t)(1U << bit);
        else       s_aw_out_p1 &= (uint8_t)~(1U << bit);
        i2c_write_reg(AW_ADDR_IO, AW_REG_OUTPUT_P1, s_aw_out_p1);
    }
}

static void aw_init_chips(void) {
    // Initialize AW9523B #1 (0x5B) for 5x RGB LED PWM dimming
    i2c_write_reg(AW_ADDR_LEDS, AW_REG_SWRST, 0x00);
    vTaskDelay(pdMS_TO_TICKS(15));
    i2c_write_reg(AW_ADDR_LEDS, AW_REG_WORK_MODE_P0, 0x00); // LED mode
    i2c_write_reg(AW_ADDR_LEDS, AW_REG_WORK_MODE_P1, 0x00); // LED mode
    i2c_write_reg(AW_ADDR_LEDS, AW_REG_CTRL, 0x00);         // Imax/1

    uint8_t zeros[15] = {0};
    i2c_write_block(AW_ADDR_LEDS, AW_REG_DIM00, zeros, sizeof(zeros));

    // Initialize AW9523B #2 (0x58) for Controls (P0.0..6, P1.0) & LCD Control (P1.4, P1.5, P1.7)
    i2c_write_reg(AW_ADDR_IO, AW_REG_SWRST, 0x00);
    vTaskDelay(pdMS_TO_TICKS(15));

    s_aw_cfg_p0 = 0xFF; // All Port 0 pins as inputs (Joystick + Btn A/B)
    s_aw_cfg_p1 = 0xFF; // Port 1 starts as input, LCD pins switched to output below
    s_aw_out_p0 = 0x00;
    s_aw_out_p1 = 0x00;

    i2c_write_reg(AW_ADDR_IO, AW_REG_CONFIG_P0, s_aw_cfg_p0);
    i2c_write_reg(AW_ADDR_IO, AW_REG_CONFIG_P1, s_aw_cfg_p1);
    i2c_write_reg(AW_ADDR_IO, AW_REG_WORK_MODE_P0, 0xFF); // GPIO mode
    i2c_write_reg(AW_ADDR_IO, AW_REG_WORK_MODE_P1, 0xF9); // GPIO mode on P1_0, P1_3..P1_7
    i2c_write_reg(AW_ADDR_IO, AW_REG_CTRL, 0x00);

    // Configure LCD control pins as outputs
    aw_pin_mode_output(AW_P1_3, true);
    aw_pin_mode_output(LCD_DC_PIN, true);
    aw_pin_mode_output(LCD_RST_PIN, true);
    aw_pin_mode_output(LCD_BL_PIN, true);
    aw_digital_write(LCD_BL_PIN, 0);
}

static void cyberpi_set_leds(const uint8_t rgb[15]) {
    i2c_write_block(AW_ADDR_LEDS, AW_REG_DIM00, rgb, 15);
}

// -----------------------------------------------------------------------------
// ST7735 128x128 SPI Display Driver
// -----------------------------------------------------------------------------
static void lcd_set_dc(uint8_t level) {
    if (s_dc_cached != level) {
        s_dc_cached = level;
        aw_digital_write(LCD_DC_PIN, level);
    }
}

static void lcd_send_cmd(uint8_t cmd) {
    lcd_set_dc(0);
    spi_transaction_t t = {};
    t.length = 8;
    t.tx_buffer = &cmd;
    spi_device_polling_transmit(s_lcd_spi, &t);
}

static void lcd_send_data(const uint8_t *data, size_t len) {
    if (len == 0) return;
    lcd_set_dc(1);
    const size_t max_chunk = 16384;
    size_t offset = 0;
    while (offset < len) {
        size_t chunk = len - offset;
        if (chunk > max_chunk) chunk = max_chunk;
        spi_transaction_t t = {};
        t.length = chunk * 8;
        t.tx_buffer = data + offset;
        spi_device_polling_transmit(s_lcd_spi, &t);
        offset += chunk;
    }
}

static void lcd_cmd_with_data(uint8_t cmd, const uint8_t *data, size_t len, uint16_t delay_ms) {
    lcd_send_cmd(cmd);
    if (data && len > 0) {
        lcd_send_data(data, len);
    }
    if (delay_ms > 0) {
        vTaskDelay(pdMS_TO_TICKS(delay_ms));
    }
}

static void lcd_init(void) {
    s_fb = (uint16_t *)heap_caps_malloc(LCD_WIDTH * LCD_HEIGHT * sizeof(uint16_t), MALLOC_CAP_DMA);
    if (!s_fb) {
        ESP_LOGE(TAG, "Failed to allocate DMA framebuffer");
        return;
    }
    memset(s_fb, 0, LCD_WIDTH * LCD_HEIGHT * sizeof(uint16_t));

    // Hardware reset pulse via AW9523B P1.5
    aw_digital_write(LCD_RST_PIN, 0);
    vTaskDelay(pdMS_TO_TICKS(100));
    aw_digital_write(LCD_RST_PIN, 1);
    vTaskDelay(pdMS_TO_TICKS(100));

    spi_bus_config_t buscfg = {};
    buscfg.mosi_io_num = LCD_PIN_MOSI;
    buscfg.miso_io_num = LCD_PIN_MISO;
    buscfg.sclk_io_num = LCD_PIN_CLK;
    buscfg.quadwp_io_num = -1;
    buscfg.quadhd_io_num = -1;
    buscfg.max_transfer_sz = LCD_WIDTH * LCD_HEIGHT * 2 + 64;
    ESP_ERROR_CHECK(spi_bus_initialize(LCD_SPI_HOST, &buscfg, SPI_DMA_CH_AUTO));

    spi_device_interface_config_t devcfg = {};
    devcfg.clock_speed_hz = LCD_SPI_CLOCK_HZ;
    devcfg.mode = 0;
    devcfg.spics_io_num = LCD_PIN_CS;
    devcfg.queue_size = 4;
    ESP_ERROR_CHECK(spi_bus_add_device(LCD_SPI_HOST, &devcfg, &s_lcd_spi));

    // Official Makeblock CyberPi ST7735 initialization sequence
    static const uint8_t frm1[]  = {0x01, 0x2C, 0x2D};
    static const uint8_t frm3[]  = {0x01, 0x2C, 0x2D, 0x01, 0x2C, 0x2D};
    static const uint8_t inv[]   = {0x07};
    static const uint8_t pw1[]   = {0xA2, 0x02, 0x84};
    static const uint8_t pw2[]   = {0xC5};
    static const uint8_t pw3[]   = {0x0A, 0x00};
    static const uint8_t pw4[]   = {0x8A, 0x2A};
    static const uint8_t pw5[]   = {0x8A, 0xEE};
    static const uint8_t vm1[]   = {0x0E};
    static const uint8_t mad[]   = {0xA8};
    static const uint8_t col[]   = {0x05};
    static const uint8_t caset[] = {0x00, LCD_XSTART, 0x00, LCD_XSTART + LCD_WIDTH - 1};
    static const uint8_t raset[] = {0x00, LCD_YSTART, 0x00, LCD_YSTART + LCD_HEIGHT - 1};
    static const uint8_t gm_p[]  = {0x02, 0x1C, 0x07, 0x12, 0x37, 0x32, 0x29, 0x2D, 0x29, 0x25, 0x2B, 0x39, 0x00, 0x01, 0x03, 0x10};
    static const uint8_t gm_n[]  = {0x03, 0x1D, 0x07, 0x06, 0x2E, 0x2C, 0x29, 0x2D, 0x2E, 0x2E, 0x37, 0x3F, 0x00, 0x00, 0x02, 0x10};

    lcd_cmd_with_data(ST7735_SWRESET, NULL, 0, 120);
    lcd_cmd_with_data(ST7735_SLPOUT,  NULL, 0, 120);
    lcd_cmd_with_data(ST7735_FRMCTR1, frm1, sizeof(frm1), 0);
    lcd_cmd_with_data(ST7735_FRMCTR2, frm1, sizeof(frm1), 0);
    lcd_cmd_with_data(ST7735_FRMCTR3, frm3, sizeof(frm3), 0);
    lcd_cmd_with_data(ST7735_INVCTR,  inv,  sizeof(inv),  0);
    lcd_cmd_with_data(ST7735_PWCTR1,  pw1,  sizeof(pw1),  0);
    lcd_cmd_with_data(ST7735_PWCTR2,  pw2,  sizeof(pw2),  0);
    lcd_cmd_with_data(ST7735_PWCTR3,  pw3,  sizeof(pw3),  0);
    lcd_cmd_with_data(ST7735_PWCTR4,  pw4,  sizeof(pw4),  0);
    lcd_cmd_with_data(ST7735_PWCTR5,  pw5,  sizeof(pw5),  0);
    lcd_cmd_with_data(ST7735_VMCTR1,  vm1,  sizeof(vm1),  0);
    lcd_cmd_with_data(ST7735_INVOFF,  NULL, 0, 0);
    lcd_cmd_with_data(ST7735_MADCTL,  mad,  sizeof(mad),  0);
    lcd_cmd_with_data(ST7735_COLMOD,  col,  sizeof(col),  0);
    lcd_cmd_with_data(ST7735_CASET,   caset, sizeof(caset), 0);
    lcd_cmd_with_data(ST7735_RASET,   raset, sizeof(raset), 0);
    lcd_cmd_with_data(ST7735_GMCTRP1, gm_p, sizeof(gm_p), 0);
    lcd_cmd_with_data(ST7735_GMCTRN1, gm_n, sizeof(gm_n), 0);
    lcd_cmd_with_data(ST7735_NORON,   NULL, 0, 20);
    lcd_cmd_with_data(ST7735_DISPON,  NULL, 0, 100);

    // Turn LCD Backlight ON (AW9523B P1.7 = 1)
    aw_digital_write(LCD_BL_PIN, 1);
}

static void lcd_flush(void) {
    if (!s_fb || !s_lcd_spi) return;
    static const uint8_t caset[4] = {0x00, LCD_XSTART, 0x00, LCD_XSTART + LCD_WIDTH - 1};
    static const uint8_t raset[4] = {0x00, LCD_YSTART, 0x00, LCD_YSTART + LCD_HEIGHT - 1};
    lcd_cmd_with_data(ST7735_CASET, caset, 4, 0);
    lcd_cmd_with_data(ST7735_RASET, raset, 4, 0);
    lcd_send_cmd(ST7735_RAMWR);
    lcd_send_data((const uint8_t *)s_fb, LCD_WIDTH * LCD_HEIGHT * sizeof(uint16_t));
}

// -----------------------------------------------------------------------------
// Framebuffer 2D Graphics & Compact 5x7 Font
// -----------------------------------------------------------------------------
static inline uint16_t rgb565(uint8_t r, uint8_t g, uint8_t b) {
    uint16_t c = (uint16_t)(((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3));
    return (uint16_t)((c >> 8) | (c << 8)); // Byte-swapped for big-endian ST7735 SPI
}

static void fb_clear(uint16_t color) {
    for (int i = 0; i < LCD_WIDTH * LCD_HEIGHT; i++) {
        s_fb[i] = color;
    }
}

static inline void fb_pixel(int x, int y, uint16_t color) {
    if ((unsigned)x < LCD_WIDTH && (unsigned)y < LCD_HEIGHT) {
        s_fb[y * LCD_WIDTH + x] = color;
    }
}

static void fb_fill_rect(int x, int y, int w, int h, uint16_t color) {
    if (x < 0) { w += x; x = 0; }
    if (y < 0) { h += y; y = 0; }
    if (x + w > LCD_WIDTH)  w = LCD_WIDTH - x;
    if (y + h > LCD_HEIGHT) h = LCD_HEIGHT - y;
    if (w <= 0 || h <= 0) return;
    for (int yy = y; yy < y + h; yy++) {
        uint16_t *row = &s_fb[yy * LCD_WIDTH + x];
        for (int xx = 0; xx < w; xx++) {
            row[xx] = color;
        }
    }
}

static void fb_draw_rect(int x, int y, int w, int h, uint16_t color) {
    fb_fill_rect(x, y, w, 1, color);
    fb_fill_rect(x, y + h - 1, w, 1, color);
    fb_fill_rect(x, y, 1, h, color);
    fb_fill_rect(x + w - 1, y, 1, h, color);
}

typedef struct { char ch; uint8_t col[5]; } glyph5x7_t;
static const glyph5x7_t FONT_5X7[] = {
    {' ', {0x00,0x00,0x00,0x00,0x00}},
    {'-', {0x08,0x08,0x08,0x08,0x08}},
    {'.', {0x00,0x60,0x60,0x00,0x00}},
    {':', {0x00,0x36,0x36,0x00,0x00}},
    {'/', {0x20,0x10,0x08,0x04,0x02}},
    {'0', {0x3E,0x51,0x49,0x45,0x3E}},
    {'1', {0x00,0x42,0x7F,0x40,0x00}},
    {'2', {0x42,0x61,0x51,0x49,0x46}},
    {'3', {0x21,0x41,0x45,0x4B,0x31}},
    {'4', {0x18,0x14,0x12,0x7F,0x10}},
    {'5', {0x27,0x45,0x45,0x45,0x39}},
    {'6', {0x3C,0x4A,0x49,0x49,0x30}},
    {'7', {0x01,0x71,0x09,0x05,0x03}},
    {'8', {0x36,0x49,0x49,0x49,0x36}},
    {'9', {0x06,0x49,0x49,0x29,0x1E}},
    {'A', {0x7E,0x11,0x11,0x11,0x7E}},
    {'B', {0x7F,0x49,0x49,0x49,0x36}},
    {'C', {0x3E,0x41,0x41,0x41,0x22}},
    {'D', {0x7F,0x41,0x41,0x22,0x1C}},
    {'E', {0x7F,0x49,0x49,0x49,0x41}},
    {'F', {0x7F,0x09,0x09,0x09,0x01}},
    {'G', {0x3E,0x41,0x49,0x49,0x7A}},
    {'H', {0x7F,0x08,0x08,0x08,0x7F}},
    {'I', {0x00,0x41,0x7F,0x41,0x00}},
    {'J', {0x20,0x40,0x41,0x3F,0x01}},
    {'K', {0x7F,0x08,0x14,0x22,0x41}},
    {'L', {0x7F,0x40,0x40,0x40,0x40}},
    {'M', {0x7F,0x02,0x0C,0x02,0x7F}},
    {'N', {0x7F,0x04,0x08,0x10,0x7F}},
    {'O', {0x3E,0x41,0x41,0x41,0x3E}},
    {'P', {0x7F,0x09,0x09,0x09,0x06}},
    {'Q', {0x3E,0x41,0x51,0x21,0x5E}},
    {'R', {0x7F,0x09,0x19,0x29,0x46}},
    {'S', {0x46,0x49,0x49,0x49,0x31}},
    {'T', {0x01,0x01,0x7F,0x01,0x01}},
    {'U', {0x3F,0x40,0x40,0x40,0x3F}},
    {'V', {0x1F,0x20,0x40,0x20,0x1F}},
    {'W', {0x3F,0x40,0x38,0x40,0x3F}},
    {'X', {0x63,0x14,0x08,0x14,0x63}},
    {'Y', {0x07,0x08,0x70,0x08,0x07}},
    {'Z', {0x61,0x51,0x49,0x45,0x43}},
};

static const uint8_t *find_glyph(char c) {
    if (c >= 'a' && c <= 'z') c = (char)(c - 'a' + 'A');
    for (size_t i = 0; i < sizeof(FONT_5X7) / sizeof(FONT_5X7[0]); i++) {
        if (FONT_5X7[i].ch == c) return FONT_5X7[i].col;
    }
    return FONT_5X7[0].col;
}

static void fb_draw_text(int x, int y, const char *str, uint16_t color, int scale) {
    int cx = x;
    while (*str) {
        const uint8_t *cols = find_glyph(*str++);
        for (int i = 0; i < 5; i++) {
            uint8_t bits = cols[i];
            for (int j = 0; j < 7; j++) {
                if (bits & (1U << j)) {
                    if (scale <= 1) fb_pixel(cx + i, y + j, color);
                    else            fb_fill_rect(cx + i * scale, y + j * scale, scale, scale, color);
                }
            }
        }
        cx += 6 * scale;
    }
}

// -----------------------------------------------------------------------------
// Screen Renderer (3 Interactive Modes toggled via HOME button)
// -----------------------------------------------------------------------------
static void render_ui(int page, uint32_t tick, bool btn_a, bool btn_b, bool btn_home,
                      int joy_x, int joy_y, bool joy_c) {
    const uint16_t C_BG      = rgb565(6, 9, 16);
    const uint16_t C_HDR     = rgb565(14, 22, 38);
    const uint16_t C_BORDER  = rgb565(34, 52, 82);
    const uint16_t C_WHITE   = rgb565(240, 245, 255);
    const uint16_t C_MUTED   = rgb565(120, 138, 165);
    const uint16_t C_CYAN    = rgb565(34, 211, 238);
    const uint16_t C_AMBER   = rgb565(251, 191, 36);
    const uint16_t C_EMERALD = rgb565(52, 211, 153);

    fb_clear(C_BG);

    // Header Bar
    fb_fill_rect(0, 0, LCD_WIDTH, 18, C_HDR);
    fb_fill_rect(0, 18, LCD_WIDTH, 1, C_BORDER);
    fb_draw_text(5, 5, "CYBERPI OS", C_CYAN, 1);

    char mode_tag[16];
    snprintf(mode_tag, sizeof(mode_tag), "M%d", page + 1);
    fb_draw_text(108, 5, mode_tag, C_MUTED, 1);

    if (page == 0) {
        // Page 0: Segmented 5-Column EQ Spectrum (matches reference photo!)
        const uint16_t col_top[5] = {
            rgb565(130, 190, 255), // Light Blue
            rgb565(150, 155, 255), // Periwinkle
            rgb565(215, 130, 255), // Orchid Purple
            rgb565(255, 95, 160),  // Hot Pink
            rgb565(255, 115, 45),  // Orange Red
        };
        const uint16_t col_bot[5] = {
            rgb565(100, 115, 255),
            rgb565(155, 95, 255),
            rgb565(235, 70, 210),
            rgb565(255, 50, 90),
            rgb565(255, 65, 20),
        };

        float boost = (btn_a ? 0.30f : 0.0f) + (btn_b ? 0.25f : 0.0f) + (joy_c ? 0.35f : 0.0f);
        for (int c = 0; c < 5; c++) {
            float phase = (float)tick * 0.28f + (float)c * 0.95f + (float)joy_x * 0.6f;
            float norm = 0.42f + 0.34f * sinf(phase) + 0.16f * cosf(phase * 1.7f) + boost;
            if (joy_y < 0) norm += 0.18f;
            if (joy_y > 0) norm -= 0.14f;
            if (norm < 0.12f) norm = 0.12f;
            if (norm > 1.0f)  norm = 1.0f;

            int total_segs = 18;
            int active_segs = (int)(norm * total_segs);
            int bx = 13 + c * 22;
            for (int s = 0; s < active_segs; s++) {
                int sy = 102 - s * 4;
                // Highlight white shimmer toward top of bar
                uint16_t seg_color = (s >= active_segs - 2) ? C_WHITE : (s > total_segs / 2 ? col_top[c] : col_bot[c]);
                fb_fill_rect(bx, sy, 14, 3, seg_color);
            }
        }
    } else if (page == 1) {
        // Page 1: Interactive Input Tester
        fb_draw_text(6, 24, "INPUT DIAGNOSTIC", C_WHITE, 1);

        // Crosshair box on left
        fb_draw_rect(10, 42, 54, 54, C_BORDER);
        fb_fill_rect(36, 46, 2, 46, rgb565(25, 38, 60));
        fb_fill_rect(14, 68, 46, 2, rgb565(25, 38, 60));
        int kx = 37 + joy_x * 16;
        int ky = 69 + joy_y * 16;
        fb_fill_rect(kx - 5, ky - 5, 10, 10, joy_c ? C_EMERALD : C_CYAN);

        // Buttons on right
        fb_fill_rect(76, 42, 42, 22, btn_b ? C_AMBER : C_HDR);
        fb_draw_rect(76, 42, 42, 22, btn_b ? C_WHITE : C_BORDER);
        fb_draw_text(83, 49, "BTN B", btn_b ? C_BG : C_WHITE, 1);

        fb_fill_rect(76, 70, 42, 22, btn_a ? C_CYAN : C_HDR);
        fb_draw_rect(76, 70, 42, 22, btn_a ? C_WHITE : C_BORDER);
        fb_draw_text(83, 77, "BTN A", btn_a ? C_BG : C_WHITE, 1);
    } else {
        // Page 2: Hardware Summary
        fb_draw_text(6, 26, "ESP32-WROVER-B", C_CYAN, 1);
        fb_draw_text(6, 40, "FLASH 8MB DIO", C_WHITE, 1);
        fb_draw_text(6, 52, "PSRAM 8MB SPI", C_WHITE, 1);
        fb_draw_text(6, 64, "I2C 0X58 0X5B", C_EMERALD, 1);
        fb_draw_text(6, 76, "ST7735 128X128", C_AMBER, 1);
        fb_draw_text(6, 92, "PRESS HOME NEXT", C_MUTED, 1);
    }

    // Bottom Live Telemetry Footer
    fb_fill_rect(0, 110, LCD_WIDTH, 18, C_HDR);
    fb_fill_rect(0, 109, LCD_WIDTH, 1, C_BORDER);

    char joy_str[32];
    snprintf(joy_str, sizeof(joy_str), "X:%d Y:%d", joy_x, joy_y);
    fb_draw_text(5, 115, joy_str, (joy_x || joy_y || joy_c) ? C_CYAN : C_MUTED, 1);

    fb_fill_rect(80, 113, 14, 11, btn_a ? C_CYAN : rgb565(22, 32, 48));
    fb_draw_text(84, 115, "A", btn_a ? C_BG : C_MUTED, 1);

    fb_fill_rect(97, 113, 14, 11, btn_b ? C_AMBER : rgb565(22, 32, 48));
    fb_draw_text(101, 115, "B", btn_b ? C_BG : C_MUTED, 1);

    if (btn_home) {
        fb_fill_rect(114, 113, 10, 11, C_EMERALD);
    }
}

static void update_rgb_leds(uint32_t tick, bool btn_a, bool btn_b, bool joy_c) {
    uint8_t rgb[15];
    for (int i = 0; i < 5; i++) {
        if (btn_a) {
            rgb[i * 3 + 0] = 0; rgb[i * 3 + 1] = 85; rgb[i * 3 + 2] = 100;
        } else if (btn_b) {
            rgb[i * 3 + 0] = 100; rgb[i * 3 + 1] = 60; rgb[i * 3 + 2] = 0;
        } else if (joy_c) {
            rgb[i * 3 + 0] = 20; rgb[i * 3 + 1] = 100; rgb[i * 3 + 2] = 55;
        } else {
            // Smooth CyberPi blue-purple-pink-red-orange wave
            float phase = (float)tick * 0.14f + (float)i * 0.7f;
            float r = (sinf(phase) * 0.5f + 0.5f) * 75.0f;
            float g = (sinf(phase + 2.1f) * 0.5f + 0.5f) * 35.0f;
            float b = (sinf(phase + 4.2f) * 0.5f + 0.5f) * 85.0f;
            rgb[i * 3 + 0] = (uint8_t)r;
            rgb[i * 3 + 1] = (uint8_t)g;
            rgb[i * 3 + 2] = (uint8_t)b;
        }
    }
    cyberpi_set_leds(rgb);
}

// -----------------------------------------------------------------------------
// Main Entry Point
// -----------------------------------------------------------------------------
extern "C" void app_main(void) {
    ESP_LOGI(TAG, "Initializing CyberPi Hardware (I2C + AW9523B + ST7735)...");

    cyberpi_i2c_init();
    uint8_t id_leds = i2c_read_reg(AW_ADDR_LEDS, 0x10);
    uint8_t id_io   = i2c_read_reg(AW_ADDR_IO,   0x10);
    ESP_LOGI(TAG, "AW9523B IDs -> 0x5B=0x%02X, 0x58=0x%02X (expected 0x23)", id_leds, id_io);

    aw_init_chips();
    lcd_init();

    // Allow non-blocking reads on STDIN_FILENO for serial commands
    int flags = fcntl(STDIN_FILENO, F_GETFL, 0);
    if (flags >= 0) {
        fcntl(STDIN_FILENO, F_SETFL, flags | O_NONBLOCK);
    }

    ESP_LOGI(TAG, "CyberPi Display, RGB LEDs & AW9523B Controls Ready!");

    uint32_t frame = 0;
    uint32_t tick = 0;
    int page = 0;
    bool prev_home = false;

    // Virtual simulator overrides received over Web Serial ("SIM:a,b,x,y,c")
    bool sim_btn_a = false;
    bool sim_btn_b = false;
    int sim_joy_x = 0;
    int sim_joy_y = 0;
    bool sim_joy_c = false;
    int64_t sim_last_ms = 0;

    bool last_hw_a = false;
    bool last_hw_b = false;
    int last_hw_x = 0;
    int last_hw_y = 0;
    bool last_hw_c = false;
    bool last_hw_home = false;
    int last_page = -1;

    char cmd_buf[64];
    size_t cmd_len = 0;

    while (true) {
        int64_t now_ms = esp_timer_get_time() / 1000;

        // Read active-low expander inputs in 2 fast I2C byte reads
        uint8_t p0 = i2c_read_reg(AW_ADDR_IO, AW_REG_INPUT_P0);
        uint8_t p1 = i2c_read_reg(AW_ADDR_IO, AW_REG_INPUT_P1);

        bool joy_left   = ((p0 >> 0) & 0x01) == 0;
        bool joy_up     = ((p0 >> 1) & 0x01) == 0;
        bool joy_right  = ((p0 >> 2) & 0x01) == 0;
        bool joy_center = ((p0 >> 3) & 0x01) == 0;
        bool joy_down   = ((p0 >> 4) & 0x01) == 0;
        bool btn_b      = ((p0 >> 5) & 0x01) == 0;
        bool btn_a      = ((p0 >> 6) & 0x01) == 0;
        bool btn_home   = ((p1 >> 0) & 0x01) == 0;

        int joy_x = joy_right ? 1 : (joy_left ? -1 : 0);
        int joy_y = joy_down  ? 1 : (joy_up   ? -1 : 0);

        // Edge detect physical HOME button to cycle screen modes
        if (btn_home && !prev_home) {
            page = (page + 1) % 3;
        }
        prev_home = btn_home;

        // Handle incoming UART commands (SIM, MODE, help, status, reboot)
        char rx = 0;
        while (read(STDIN_FILENO, &rx, 1) == 1) {
            if (rx == '\\n' || rx == '\\r') {
                if (cmd_len > 0) {
                    cmd_buf[cmd_len] = '\\0';
                    int sa = 0, sb = 0, sx = 0, sy = 0, sc = 0, mode_val = 0;
                    if (sscanf(cmd_buf, "SIM:%d,%d,%d,%d,%d", &sa, &sb, &sx, &sy, &sc) == 5) {
                        sim_btn_a = (sa != 0);
                        sim_btn_b = (sb != 0);
                        sim_joy_x = (sx > 0) ? 1 : ((sx < 0) ? -1 : 0);
                        sim_joy_y = (sy > 0) ? 1 : ((sy < 0) ? -1 : 0);
                        sim_joy_c = (sc != 0);
                        sim_last_ms = now_ms;
                    } else if (sscanf(cmd_buf, "MODE:%d", &mode_val) == 1) {
                        if (mode_val >= 0 && mode_val < 3) {
                            page = mode_val;
                        }
                    } else if (strcmp(cmd_buf, "reboot") == 0) {
                        esp_restart();
                    } else if (strcmp(cmd_buf, "mode") == 0) {
                        page = (page + 1) % 3;
                    } else if (strcmp(cmd_buf, "status") == 0) {
                        printf("{\\"status\\":\\"ok\\",\\"page\\":%d,\\"uptime_ms\\":%lld}\\n", page, (long long)now_ms);
                    } else if (strcmp(cmd_buf, "help") == 0) {
                        printf("{\\"info\\":\\"commands: help, status, mode, MODE:0..2, SIM:a,b,x,y,c, reboot\\"}\\n");
                    }
                    cmd_len = 0;
                }
            } else if (cmd_len + 1 < sizeof(cmd_buf)) {
                cmd_buf[cmd_len++] = rx;
            }
        }

        // Auto-clear virtual override if browser disconnects without sending release
        if ((sim_btn_a || sim_btn_b || sim_joy_x != 0 || sim_joy_y != 0 || sim_joy_c) &&
            (now_ms - sim_last_ms > 30000)) {
            sim_btn_a = sim_btn_b = sim_joy_c = false;
            sim_joy_x = sim_joy_y = 0;
        }

        // Effective visual state on physical screen & RGB LEDs combines physical + virtual inputs
        bool eff_btn_a = btn_a || sim_btn_a;
        bool eff_btn_b = btn_b || sim_btn_b;
        int  eff_joy_x = (joy_x != 0) ? joy_x : sim_joy_x;
        int  eff_joy_y = (joy_y != 0) ? joy_y : sim_joy_y;
        bool eff_joy_c = joy_center || sim_joy_c;

        // Update physical ST7735 TFT & 5x RGB LEDs at 20 Hz
        render_ui(page, tick, eff_btn_a, eff_btn_b, btn_home, eff_joy_x, eff_joy_y, eff_joy_c);
        lcd_flush();
        update_rgb_leds(tick, eff_btn_a, eff_btn_b, eff_joy_c);

        // Emit Web Serial JSON telemetry immediately on hardware input change or at 10 Hz heartbeat
        bool hw_changed = (btn_a != last_hw_a) || (btn_b != last_hw_b) ||
                          (joy_x != last_hw_x) || (joy_y != last_hw_y) ||
                          (joy_center != last_hw_c) || (btn_home != last_hw_home) ||
                          (page != last_page);
        if (hw_changed || (tick % 2) == 0) {
            last_hw_a = btn_a;
            last_hw_b = btn_b;
            last_hw_x = joy_x;
            last_hw_y = joy_y;
            last_hw_c = joy_center;
            last_hw_home = btn_home;
            last_page = page;
            printf(
                "{\\"frame\\":%lu,\\"btnA\\":%d,\\"btnB\\":%d,\\"joyX\\":%d,\\"joyY\\":%d,\\"joyCenter\\":%d,\\"btnHome\\":%d,\\"page\\":%d,\\"uptime_ms\\":%lld}\\n",
                (unsigned long)frame++,
                btn_a ? 1 : 0,
                btn_b ? 1 : 0,
                joy_x,
                joy_y,
                joy_center ? 1 : 0,
                btn_home ? 1 : 0,
                page,
                (long long)now_ms
            );
        }

        tick++;
        vTaskDelay(pdMS_TO_TICKS(50));
    }
}
`
  },
  main_cmake: {
    filename: 'main/CMakeLists.txt',
    path: 'firmware/main/CMakeLists.txt',
    language: 'cmake',
    content: `idf_component_register(
    SRCS "main.cpp"
    INCLUDE_DIRS "."
    REQUIRES driver esp_timer log
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
CONFIG_ESPTOOLPY_FLASHSIZE_8MB=y
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
