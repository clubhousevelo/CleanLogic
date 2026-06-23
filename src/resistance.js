const FTMS_SERVICE = 0x1826;
const FTMS_CONTROL_POINT = 0x2ad9;
const FTMS_STATUS = 0x2ada;

const OPCODES = {
  requestControl: 0x00,
  reset: 0x01,
  setTargetPower: 0x05,
  startOrResume: 0x07,
  stopOrPause: 0x08,
  responseCode: 0x80,
};

const RESULT_CODES = {
  0x01: "success",
  0x02: "not supported",
  0x03: "invalid parameter",
  0x04: "operation failed",
  0x05: "control not permitted",
};

const WRITE_TIMEOUT_MS = 2500;

export function createResistanceController() {
  const supported = typeof navigator !== "undefined" && Boolean(navigator.bluetooth);
  return {
    supported,
    device: null,
    server: null,
    controlPoint: null,
    statusCharacteristic: null,
    connected: false,
    busy: false,
    targetPower: 150,
    activePower: null,
    status: supported ? "Disconnected" : "Web Bluetooth unavailable",
    lastError: null,
    queue: Promise.resolve(),
    pendingResponse: null,
    onStatus: null,
  };
}

export async function connectResistanceUnit(controller) {
  if (!controller.supported) {
    throw new Error("Web Bluetooth is not available in this browser.");
  }

  setControllerStatus(controller, "Selecting resistance unit");
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [FTMS_SERVICE] }],
    optionalServices: [FTMS_SERVICE],
  });

  device.addEventListener("gattserverdisconnected", () => {
    controller.connected = false;
    controller.server = null;
    controller.controlPoint = null;
    controller.statusCharacteristic = null;
    controller.pendingResponse = null;
    setControllerStatus(controller, "Disconnected");
  });

  setControllerStatus(controller, "Connecting");
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(FTMS_SERVICE);
  const controlPoint = await service.getCharacteristic(FTMS_CONTROL_POINT);
  let statusCharacteristic = null;

  try {
    statusCharacteristic = await service.getCharacteristic(FTMS_STATUS);
    await statusCharacteristic.startNotifications();
    statusCharacteristic.addEventListener("characteristicvaluechanged", (event) => {
      setControllerStatus(controller, parseFitnessMachineStatus(event.target.value));
    });
  } catch {
    statusCharacteristic = null;
  }

  await controlPoint.startNotifications();
  controlPoint.addEventListener("characteristicvaluechanged", (event) => {
    handleControlPointResponse(controller, event.target.value);
  });

  Object.assign(controller, {
    device,
    server,
    controlPoint,
    statusCharacteristic,
    connected: true,
    lastError: null,
  });

  await enqueueCommand(controller, "request control", () => writeCommand(controller, new Uint8Array([
    OPCODES.requestControl,
  ]), OPCODES.requestControl));
  await enqueueCommand(controller, "start", () => writeCommand(controller, new Uint8Array([
    OPCODES.startOrResume,
  ]), OPCODES.startOrResume));

  setControllerStatus(controller, `Connected to ${device.name || "resistance unit"}`);
}

export async function setFixedResistancePower(controller, watts) {
  const targetPower = clampPower(watts);
  controller.targetPower = targetPower;

  if (!controller.connected || !controller.controlPoint) {
    setControllerStatus(controller, `Target staged at ${targetPower} W`);
    return;
  }

  const payload = new Uint8Array(3);
  payload[0] = OPCODES.setTargetPower;
  new DataView(payload.buffer).setInt16(1, targetPower, true);

  await enqueueCommand(controller, `set ${targetPower} W`, () => writeCommand(
    controller,
    payload,
    OPCODES.setTargetPower,
  ));

  controller.activePower = targetPower;
  setControllerStatus(controller, `Holding ${targetPower} W`);
}

export async function releaseResistanceControl(controller) {
  if (!controller.connected || !controller.controlPoint) {
    controller.activePower = null;
    setControllerStatus(controller, "Disconnected");
    return;
  }

  await enqueueCommand(controller, "stop", () => writeCommand(controller, new Uint8Array([
    OPCODES.stopOrPause,
    0x01,
  ]), OPCODES.stopOrPause));

  controller.activePower = null;
  setControllerStatus(controller, "Control released");
}

export function disconnectResistanceUnit(controller) {
  controller.activePower = null;
  controller.pendingResponse = null;
  if (controller.device?.gatt?.connected) {
    controller.device.gatt.disconnect();
  } else {
    controller.connected = false;
    setControllerStatus(controller, "Disconnected");
  }
}

export function clampPower(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(1200, Math.max(0, Math.round(number)));
}

function enqueueCommand(controller, label, task) {
  controller.queue = controller.queue
    .catch(() => undefined)
    .then(async () => {
      controller.busy = true;
      setControllerStatus(controller, `${capitalize(label)}...`);
      try {
        const result = await task();
        controller.lastError = null;
        return result;
      } catch (error) {
        controller.lastError = error.message;
        setControllerStatus(controller, `${capitalize(label)} failed: ${error.message}`);
        throw error;
      } finally {
        controller.busy = false;
      }
    });
  return controller.queue;
}

async function writeCommand(controller, payload, expectedOpcode) {
  if (!controller.controlPoint) throw new Error("Resistance unit is not connected.");
  if (controller.pendingResponse) throw new Error("Resistance unit is still processing a command.");

  const responsePromise = waitForResponse(controller, expectedOpcode);

  if (controller.controlPoint.writeValueWithResponse) {
    await controller.controlPoint.writeValueWithResponse(payload);
  } else {
    await controller.controlPoint.writeValue(payload);
  }

  return responsePromise;
}

function waitForResponse(controller, expectedOpcode) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      controller.pendingResponse = null;
      reject(new Error("Timed out waiting for device response"));
    }, WRITE_TIMEOUT_MS);

    controller.pendingResponse = {
      expectedOpcode,
      resolve: (value) => {
        window.clearTimeout(timer);
        controller.pendingResponse = null;
        resolve(value);
      },
      reject: (error) => {
        window.clearTimeout(timer);
        controller.pendingResponse = null;
        reject(error);
      },
    };
  });
}

function handleControlPointResponse(controller, dataView) {
  if (dataView.byteLength < 3 || dataView.getUint8(0) !== OPCODES.responseCode) return;

  const requestOpcode = dataView.getUint8(1);
  const resultCode = dataView.getUint8(2);
  const pending = controller.pendingResponse;

  if (!pending || pending.expectedOpcode !== requestOpcode) return;

  const result = RESULT_CODES[resultCode] ?? `unknown response ${resultCode}`;
  if (resultCode === 0x01) {
    pending.resolve(result);
  } else {
    pending.reject(new Error(result));
  }
}

function parseFitnessMachineStatus(dataView) {
  if (!dataView?.byteLength) return "Status updated";

  const statusCode = dataView.getUint8(0);
  const statusByCode = {
    0x01: "Reset",
    0x02: "Stopped",
    0x04: "Started",
    0x07: "Target power changed",
    0x12: "Control permission lost",
  };

  return statusByCode[statusCode] ?? `Status ${statusCode}`;
}

function setControllerStatus(controller, status) {
  controller.status = status;
  controller.onStatus?.(controller);
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
