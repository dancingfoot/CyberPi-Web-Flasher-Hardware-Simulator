/**
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

    // GPIO 0 and 32 have internal pull-ups; GPIOs 34-39 are input-only without internal pull-ups
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

        // Emit telemetry packet over UART (readable by Web Serial Monitor & synced to simulator)
        printf(
            "{\"frame\":%lu,\"btnA\":%d,\"btnB\":%d,\"joyX\":%d,\"joyY\":%d,\"joyCenter\":%d,\"uptime_ms\":%lld}\n",
            frame++,
            btn_a ? 1 : 0,
            btn_b ? 1 : 0,
            joy_x,
            joy_y,
            joy_press ? 1 : 0,
            esp_timer_get_time() / 1000
        );

        vTaskDelay(pdMS_TO_TICKS(100));
    }
}
