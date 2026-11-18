// OmniGuard Telemetry, GPS Tracking & Security Events Hub

class TelemetryHub {
  constructor() {
    this.locationHistory = new Map(); // deviceId -> Array of GPS fixes
    this.securityAlerts = []; // Array of motion/sound alerts
    this.maxHistoryPerDevice = 100;
  }

  recordLocation(deviceId, coords) {
    if (!deviceId || !coords) return;
    if (!this.locationHistory.has(deviceId)) {
      this.locationHistory.set(deviceId, []);
    }
    const history = this.locationHistory.get(deviceId);
    const entry = {
      lat: coords.latitude,
      lng: coords.longitude,
      accuracy: coords.accuracy || null,
      speed: coords.speed || null,
      timestamp: Date.now()
    };
    history.push(entry);
    if (history.length > this.maxHistoryPerDevice) {
      history.shift();
    }
    return entry;
  }

  recordSecurityEvent(event) {
    const alert = {
      id: Math.random().toString(36).substring(2, 9),
      deviceId: event.deviceId,
      type: event.type, // 'MOTION_DETECTED' or 'ACOUSTIC_SPIKE'
      severity: event.severity || 'MEDIUM',
      value: event.value || null,
      timestamp: Date.now()
    };
    this.securityAlerts.unshift(alert);
    if (this.securityAlerts.length > 200) {
      this.securityAlerts.pop();
    }
    return alert;
  }

  getLocationHistory(deviceId) {
    return this.locationHistory.get(deviceId) || [];
  }

  getSecurityEvents(deviceId = null) {
    if (deviceId) {
      return this.securityAlerts.filter(a => a.deviceId === deviceId);
    }
    return this.securityAlerts.slice(0, 50);
  }
}

module.exports = new TelemetryHub();
