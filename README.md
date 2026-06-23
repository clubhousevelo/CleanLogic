# PurelyFit Modern

Replay-first prototype for a clean-room replacement of the legacy PurelyCustom / PrecisionFit software.

## Current scope

- Runs locally in a browser with no build step.
- Replays sample dashboard and crank torque data copied from the release package.
- Renders live metrics, power trend, left/right polar plots, sessions, customers, and settings.
- Uses canvas charts and throttled rendering so telemetry updates do not force a full UI redraw for every sample.
- Displays power as a rolling 3-second average while preserving the current raw power in the sublabel.
- Allows exactly one active power source and one active heart-rate source.
- Searches for Bluetooth LE power meters and heart-rate sensors through the browser Bluetooth chooser.
- Stages or applies a fixed target wattage to compatible Bluetooth FTMS resistance units.

## Run

```sh
python3 -m http.server 5173
```

Then open:

```text
http://127.0.0.1:5173
```

## Architecture direction

The replacement should keep data acquisition separate from rendering:

- `ReplaySource`: reads CSV/log fixtures for development and testing.
- `WindowsSerialSource`: talks to the bike over COM ports.
- `MacSerialSource`: talks to the same USB serial device through `/dev/tty.*` or `/dev/cu.*`.
- `BluetoothSensorSource`: subscribes to BLE Heart Rate and Cycling Power notifications.
- `BluetoothResistanceController`: requests FTMS control and writes fixed target power commands with command timeouts.
- `AntSensorSource`: reads ANT+ HR and bicycle power profiles through a USB ANT stick.
- `TelemetryStore`: persists customers, sessions, and per-sample telemetry to SQLite.
- `DashboardRenderer`: updates canvas charts on animation frames, not on every serial packet.
- `PowerAverager`: maintains a time-based rolling 3-second display window and resets when the active power source changes.

This allows Windows hardware support to arrive first while keeping Mac compatibility practical.

## Next implementation step

Build a desktop wrapper around this core UI. Electron is the quickest cross-platform route because serial, Bluetooth LE, and native USB bridge support can be handled on Windows and Mac. A later native rewrite can keep the same data model and protocol parser.

## Sensor protocol notes

- BLE Heart Rate Service: service `0x180D`, measurement characteristic `0x2A37`.
- BLE Cycling Power Service: service `0x1818`, measurement characteristic `0x2A63`.
- The BLE Power and BLE HR buttons request devices that advertise those services, subscribe to notifications, and keep replay updates from overwriting live Bluetooth readings.
- BLE Fitness Machine Service: service `0x1826`, control point characteristic `0x2AD9`. Fixed power uses the FTMS Set Target Power procedure and waits for the control-point response before sending another command.
- ANT+ heart-rate and power meters need an ANT USB stick. The browser cannot talk ANT+ directly, so the desktop wrapper should expose ANT+ readings to the UI through a small local bridge.
- The legacy `HeartRate SerialPort=COM8` path was likely for a separate receiver/dongle that translated HR data into serial bytes. Modern HR straps usually advertise BLE and/or ANT+, so serial HR can become an optional compatibility source instead of the main path.
- Power source selection is exclusive: serial bike power, BLE power meter, or ANT+ power meter. Heart-rate source selection is also exclusive: serial HR receiver, BLE HR strap, or ANT+ HR strap.
