# Compiled CyberPi Firmware Binaries (`bin/`)

Place compiled ESP32 `.bin` files here when building locally, or let `.github/workflows/main.yml` populate `dist/bin/` automatically on GitHub Pages:

- `bootloader.bin` (offset `0x1000`)
- `partition-table.bin` (offset `0x8000`)
- `app.bin` (offset `0x10000`)
- `cyberpi_merged.bin` (offset `0x0`)

Local ESP-IDF build commands:

```bash
cd firmware
idf.py set-target esp32
idf.py build
mkdir -p ../public/bin
cp build/bootloader/bootloader.bin ../public/bin/bootloader.bin
cp build/partition_table/partition-table.bin ../public/bin/partition-table.bin
cp build/cyberpi_firmware.bin ../public/bin/app.bin
```
