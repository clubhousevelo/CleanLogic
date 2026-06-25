export const SENSOR_TYPES = {
  power: "power",
  heartRate: "heartRate",
};

export const SENSOR_TRANSPORTS = {
  bluetooth: "Bluetooth LE",
  ant: "ANT+",
  serial: "Legacy Serial",
};

export function createSensor({ id, name, type, transport }) {
  return {
    id,
    name,
    type,
    transport,
    connected: true,
    lastSeen: new Date(),
    value: null,
    battery: null,
    cadence: null,
    balance: null,
  };
}

export function parseBluetoothHeartRateMeasurement(dataView) {
  const flags = dataView.getUint8(0);
  const isUint16 = (flags & 0x01) === 0x01;
  const heartRate = isUint16 ? dataView.getUint16(1, true) : dataView.getUint8(1);
  let offset = isUint16 ? 3 : 2;
  let energyExpended = null;
  const rrIntervals = [];

  if ((flags & 0x08) === 0x08) {
    energyExpended = dataView.getUint16(offset, true);
    offset += 2;
  }

  if ((flags & 0x10) === 0x10) {
    while (offset + 1 < dataView.byteLength) {
      rrIntervals.push(dataView.getUint16(offset, true) / 1024);
      offset += 2;
    }
  }

  return { heartRate, energyExpended, rrIntervals };
}

export function parseBluetoothCyclingPowerMeasurement(dataView) {
  const flags = dataView.getUint16(0, true);
  const power = dataView.getInt16(2, true);
  let offset = 4;
  let balance = null;
  let accumulatedTorque = null;
  let cumulativeCrankRevolutions = null;
  let lastCrankEventTime = null;

  if ((flags & 0x01) === 0x01) {
    const rawBalance = dataView.getUint8(offset);
    balance = (flags & 0x02) === 0x02 ? rawBalance / 2 : rawBalance;
    offset += 1;
  }

  if ((flags & 0x04) === 0x04) {
    accumulatedTorque = dataView.getUint16(offset, true) / 32;
    offset += 2;
  }

  if ((flags & 0x20) === 0x20) {
    offset += 4;
  }

  if ((flags & 0x40) === 0x40) {
    cumulativeCrankRevolutions = dataView.getUint16(offset, true);
    lastCrankEventTime = dataView.getUint16(offset + 2, true) / 1024;
  }

  return {
    power,
    balance,
    accumulatedTorque,
    cumulativeCrankRevolutions,
    lastCrankEventTime,
  };
}

export function createSimulatedSensorValue(sensor, tick) {
  if (sensor.type === SENSOR_TYPES.heartRate) {
    return {
      value: Math.round(78 + Math.sin(tick / 14) * 8 + Math.sin(tick / 4) * 2),
      battery: 86,
    };
  }

  return {
    value: Math.round(155 + Math.sin(tick / 9) * 42 + Math.sin(tick / 3) * 8),
    cadence: Math.round(82 + Math.sin(tick / 10) * 7),
    balance: Math.round(50 + Math.sin(tick / 16) * 4),
    battery: 74,
  };
}

export function getSensorSummary(sensor) {
  if (sensor.type === SENSOR_TYPES.heartRate) {
    return sensor.value == null ? "-- bpm" : `${Math.round(sensor.value)} bpm`;
  }
  return sensor.value == null ? "-- W" : `${Math.round(sensor.value)} W`;
}
