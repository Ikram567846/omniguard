// OmniGuard Unified Device, Session & Authentication Engine
const crypto = require('crypto');

class DeviceManager {
  constructor() {
    this.devices = new Map(); // deviceId -> Device
    this.sessions = new Map(); // sessionId -> Session
    this.unattendedPasswords = new Map(); // deviceId -> permanentPassword
    this.pairingPins = new Map(); // 6-digit pairing PIN -> deviceId
  }

  // Generate 9-digit UltraViewer style ID
  generateDeviceId() {
    let id;
    do {
      const part1 = Math.floor(100 + Math.random() * 900);
      const part2 = Math.floor(100 + Math.random() * 900);
      const part3 = Math.floor(100 + Math.random() * 900);
      id = `${part1} ${part2} ${part3}`;
    } while (this.devices.has(id));
    return id;
  }

  // Normalize ID (removes spaces, hyphens for seamless matching)
  normalizeId(id) {
    if (!id) return '';
    return id.toString().replace(/[\s-]/g, '');
  }

  // Find device by normalized ID, exact ID, or 6-digit Pairing PIN
  findDevice(rawId) {
    if (!rawId) return null;
    const cleanTarget = this.normalizeId(rawId);
    
    // Check 9-digit Device ID
    for (const [key, device] of this.devices.entries()) {
      if (this.normalizeId(key) === cleanTarget) {
        return device;
      }
    }

    // Check 6-digit Pairing PIN
    if (this.pairingPins.has(cleanTarget)) {
      const realDeviceId = this.pairingPins.get(cleanTarget);
      return this.devices.get(realDeviceId) || null;
    }

    return null;
  }

  // Generate 6-digit dynamic one-time password
  generateDynamicPassword() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  // Generate 6-digit easy pairing PIN
  generatePairingPin() {
    let pin;
    do {
      pin = Math.floor(100000 + Math.random() * 900000).toString();
    } while (this.pairingPins.has(pin));
    return pin;
  }

  // Register device node (supports persistent deviceId & permanentPassword)
  registerDevice(ws, metadata = {}) {
    let deviceId = metadata.deviceId;
    if (!deviceId || typeof deviceId !== 'string' || this.normalizeId(deviceId).length < 6) {
      deviceId = this.generateDeviceId();
    } else {
      if (this.devices.has(deviceId)) {
        const old = this.devices.get(deviceId);
        if (old.socket && old.socket !== ws) {
          try { old.socket.close(); } catch (e) {}
        }
      }
    }

    const dynamicPassword = this.generateDynamicPassword();
    const pairingPin = metadata.pairingPin || this.generatePairingPin();

    if (metadata.permanentPassword) {
      this.unattendedPasswords.set(this.normalizeId(deviceId), metadata.permanentPassword.toString().trim());
    }
    const permanentPassword = this.unattendedPasswords.get(this.normalizeId(deviceId)) || null;

    const device = {
      id: deviceId,
      pairingPin: pairingPin,
      password: dynamicPassword,
      permanentPassword: permanentPassword,
      socket: ws,
      type: metadata.type || 'HOST', // CONTROLLER or HOST
      name: metadata.name || 'OmniGuard Node',
      registeredAt: Date.now(),
      status: 'ONLINE',
      mode: 'IDLE'
    };

    this.devices.set(deviceId, device);
    this.pairingPins.set(pairingPin, deviceId);
    return device;
  }

  // Set Permanent Custom Unattended Master Password
  setUnattendedPassword(deviceId, permanentPassword) {
    if (!deviceId || !permanentPassword) return false;
    const cleanId = this.normalizeId(deviceId);
    this.unattendedPasswords.set(cleanId, permanentPassword.trim());

    const device = this.findDevice(deviceId);
    if (device) {
      device.permanentPassword = permanentPassword.trim();
    }
    return true;
  }

  // Authenticate using Dynamic Password OR Permanent Unattended Password
  authenticate(targetId, providedPassword) {
    const target = this.findDevice(targetId);
    if (!target) {
      return { success: false, error: 'Target device not found or offline' };
    }

    const cleanPass = (providedPassword || '').toString().trim();
    const isDynamicMatch = target.password === cleanPass;
    const isPermanentMatch = target.permanentPassword && (target.permanentPassword === cleanPass);

    if (isDynamicMatch || isPermanentMatch) {
      return {
        success: true,
        host: target,
        authType: isPermanentMatch ? 'PERMANENT_UNATTENDED' : 'DYNAMIC'
      };
    }

    return { success: false, error: 'Invalid Password. Please verify credentials.' };
  }

  // Create Active Session
  createSession(controllerId, hostId, mode = 'FULL_CONTROL') {
    const controller = this.findDevice(controllerId);
    const host = this.findDevice(hostId);

    if (!controller || !host) return null;

    const sessionId = crypto.randomUUID();
    const session = {
      id: sessionId,
      controllerId: controller.id,
      hostId: host.id,
      mode: mode,
      startedAt: Date.now(),
      status: 'CONNECTED'
    };

    this.sessions.set(sessionId, session);
    controller.mode = 'ACTIVE_CONTROLLER';
    host.mode = 'ACTIVE_HOST';
    return session;
  }

  // Swap Side (Make Controller become Host and vice versa)
  switchSide(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const temp = session.controllerId;
    session.controllerId = session.hostId;
    session.hostId = temp;
    return session;
  }

  // Clean disconnect
  disconnectDevice(ws) {
    let disconnectedId = null;
    for (const [id, device] of this.devices.entries()) {
      if (device.socket === ws) {
        disconnectedId = id;
        if (device.pairingPin) {
          this.pairingPins.delete(device.pairingPin);
        }
        this.devices.delete(id);
        break;
      }
    }

    // Cleanup active sessions
    if (disconnectedId) {
      for (const [sId, session] of this.sessions.entries()) {
        if (session.controllerId === disconnectedId || session.hostId === disconnectedId) {
          const partnerId = session.controllerId === disconnectedId ? session.hostId : session.controllerId;
          const partner = this.findDevice(partnerId);
          if (partner && partner.socket && partner.socket.readyState === 1) {
            partner.socket.send(JSON.stringify({
              type: 'SESSION_ENDED',
              reason: 'Partner disconnected'
            }));
          }
          this.sessions.delete(sId);
        }
      }
    }
    return disconnectedId;
  }
}

module.exports = new DeviceManager();
