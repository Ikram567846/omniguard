const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const WebSocket = require('ws');
const deviceManager = require('./deviceManager');
const telemetryHub = require('./telemetryHub');
const licenseManager = require('./licenseManager');

const app = express();
const httpServer = http.createServer(app);

const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;

// 1. Auto-generate TLS certificate for mobile HTTPS camera compatibility
let httpsServer = null;
let pems = null;
try {
  const selfsigned = require('selfsigned');
  const attrs = [{ name: 'commonName', value: 'OmniGuard Local Node' }];
  pems = selfsigned.generate(attrs, { days: 365 });
  httpsServer = https.createServer({ key: pems.private, cert: pems.cert }, app);
} catch (e) {
  console.log('[INFO] Running on standard HTTP (Self-signed HTTPS skipped):', e.message);
}

// 2. Attach WebSocket Signaling to HTTP & HTTPS servers
const wssHttp = new WebSocket.Server({ server: httpServer });
let wssHttps = null;
if (httpsServer) {
  wssHttps = new WebSocket.Server({ server: httpsServer });
}

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Unified Commercial Client Portal Route
app.get('/client', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/client.html'));
});
app.get('/customer', (req, res) => {
  res.redirect('/client');
});
app.get('/host', (req, res) => {
  res.redirect('/client');
});

// REST APIs
app.get('/api/status', (req, res) => {
  res.json({
    status: 'OmniGuard Core Server Running',
    version: '1.0.0',
    httpPort: PORT,
    httpsPort: httpsServer ? HTTPS_PORT : null
  });
});

app.get('/api/telemetry/:id/history', (req, res) => {
  const history = telemetryHub.getLocationHistory(req.params.id);
  res.json(history);
});

app.get('/api/telemetry/events', (req, res) => {
  const events = telemetryHub.getSecurityEvents(req.query.deviceId);
  res.json(events);
});

// Commercial License APIs
app.post('/api/license/activate', (req, res) => {
  const { deviceId, licenseKey } = req.body;
  if (!deviceId || !licenseKey) {
    return res.status(400).json({ success: false, error: 'DeviceId and LicenseKey required' });
  }
  const result = licenseManager.activateLicense(deviceId, licenseKey);
  res.json(result);
});

app.get('/api/license/status/:deviceId', (req, res) => {
  const status = licenseManager.getDeviceLicense(req.params.deviceId);
  res.json(status);
});

app.post('/api/license/generate', (req, res) => {
  const { tier = 'PROFESSIONAL', years = 1 } = req.body;
  const newKey = licenseManager.generateLicenseKey(tier, parseInt(years, 10));
  const details = licenseManager.validLicensePool.get(newKey);
  res.json({
    success: true,
    key: newKey,
    details
  });
});

// Set Custom Unattended Master Password
app.post('/api/device/unattended', (req, res) => {
  const { deviceId, permanentPassword } = req.body;
  if (!deviceId || !permanentPassword) {
    return res.status(400).json({ success: false, error: 'DeviceId and Password required' });
  }
  const ok = deviceManager.setUnattendedPassword(deviceId, permanentPassword);
  res.json({ success: ok });
});

// 3. Centralized WebSocket Signaling Logic
function handleWsConnection(ws) {
  let registeredDeviceId = null;

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);

      switch (msg.type) {
        case 'REGISTER': {
          const device = deviceManager.registerDevice(ws, msg.data || {});
          registeredDeviceId = device.id;

          ws.send(JSON.stringify({
            type: 'REGISTERED',
            data: {
              deviceId: device.id,
              pairingPin: device.pairingPin,
              password: device.password,
              permanentPassword: device.permanentPassword,
              status: device.status
            }
          }));
          break;
        }

        case 'UPDATE_PASSWORD': {
          const device = deviceManager.findDevice(registeredDeviceId);
          if (device && msg.data && msg.data.password) {
            device.password = msg.data.password.trim();
          }
          break;
        }

        case 'SET_UNATTENDED_PASSWORD': {
          if (registeredDeviceId && msg.data && msg.data.password) {
            deviceManager.setUnattendedPassword(registeredDeviceId, msg.data.password);
            ws.send(JSON.stringify({
              type: 'UNATTENDED_PASSWORD_SAVED',
              data: { success: true, permanentPassword: msg.data.password.trim() }
            }));
          }
          break;
        }

        case 'CONNECT_REQUEST': {
          const { hostId, password, mode } = msg.data;
          const auth = deviceManager.authenticate(hostId, password);

          if (!auth.success) {
            ws.send(JSON.stringify({
              type: 'CONNECT_ERROR',
              error: auth.error
            }));
            return;
          }

          const session = deviceManager.createSession(registeredDeviceId, hostId, mode);
          if (!session) {
            ws.send(JSON.stringify({
              type: 'CONNECT_ERROR',
              error: 'Failed to initialize session'
            }));
            return;
          }

          // Notify Host that a controller wants to connect
          const host = auth.host;
          if (host.socket && host.socket.readyState === WebSocket.OPEN) {
            host.socket.send(JSON.stringify({
              type: 'INCOMING_CONNECTION',
              data: {
                sessionId: session.id,
                controllerId: registeredDeviceId,
                mode: session.mode
              }
            }));
          }

          ws.send(JSON.stringify({
            type: 'CONNECT_ACCEPTED',
            data: {
              sessionId: session.id,
              hostId: auth.host.id
            }
          }));
          break;
        }

        case 'OFFER':
        case 'ANSWER':
        case 'ICE_CANDIDATE': {
          const { targetId } = msg.data;
          const target = deviceManager.findDevice(targetId);
          if (target && target.socket && target.socket.readyState === WebSocket.OPEN) {
            target.socket.send(JSON.stringify({
              type: msg.type,
              data: {
                ...msg.data,
                fromId: registeredDeviceId
              }
            }));
          }
          break;
        }

        case 'SWITCH_SIDE': {
          const { sessionId } = msg.data;
          const updatedSession = deviceManager.switchSide(sessionId);
          if (updatedSession) {
            const client1 = deviceManager.findDevice(updatedSession.controllerId);
            const client2 = deviceManager.findDevice(updatedSession.hostId);

            const payload = JSON.stringify({
              type: 'SIDE_SWITCHED',
              data: {
                sessionId,
                newControllerId: updatedSession.controllerId,
                newHostId: updatedSession.hostId
              }
            });

            if (client1 && client1.socket) client1.socket.send(payload);
            if (client2 && client2.socket) client2.socket.send(payload);
          }
          break;
        }

        case 'BLANK_SCREEN': {
          const { targetId, blank } = msg.data;
          const target = deviceManager.findDevice(targetId);
          if (target && target.socket) {
            target.socket.send(JSON.stringify({
              type: 'SET_BLANK_SCREEN',
              blank: !!blank
            }));
          }
          break;
        }

        case 'TRIGGER_BUZZ': {
          const { targetId } = msg.data;
          const target = deviceManager.findDevice(targetId);
          if (target && target.socket) {
            target.socket.send(JSON.stringify({ type: 'TRIGGER_BUZZ' }));
          }
          break;
        }

        case 'SWITCH_CAMERA': {
          const { targetId } = msg.data;
          const target = deviceManager.findDevice(targetId);
          if (target && target.socket) {
            target.socket.send(JSON.stringify({ type: 'TOGGLE_CAMERA' }));
          }
          break;
        }

        case 'SCREEN_FRAME':
        case 'INPUT':
        case 'RELAY_INPUT':
        case 'START_STREAM':
        case 'STOP_STREAM':
        case 'STREAM_REQUEST':
        case 'STREAM_ACCEPTED':
        case 'TUNNEL_DATA': {
          const targetId = (msg.data && msg.data.targetId) || msg.targetId;
          if (targetId) {
            const target = deviceManager.findDevice(targetId);
            if (target && target.socket && target.socket.readyState === WebSocket.OPEN) {
              target.socket.send(JSON.stringify({
                type: msg.type,
                data: {
                  ...(msg.data || {}),
                  fromId: registeredDeviceId
                }
              }));
            }
          }
          break;
        }

        case 'TOGGLE_TORCH': {
          const { targetId } = msg.data;
          const target = deviceManager.findDevice(targetId);
          if (target && target.socket) {
            target.socket.send(JSON.stringify({ type: 'TOGGLE_TORCH' }));
          }
          break;
        }

        case 'BATTERY_STATUS': {
          for (const session of deviceManager.sessions.values()) {
            if (session.hostId === registeredDeviceId) {
              const controller = deviceManager.findDevice(session.controllerId);
              if (controller && controller.socket) {
                controller.socket.send(JSON.stringify({
                  type: 'BATTERY_STATUS',
                  data: msg.data
                }));
              }
            }
          }
          break;
        }

        case 'GPS_UPDATE': {
          const coords = msg.data;
          telemetryHub.recordLocation(registeredDeviceId, coords);
          for (const session of deviceManager.sessions.values()) {
            if (session.hostId === registeredDeviceId) {
              const controller = deviceManager.findDevice(session.controllerId);
              if (controller && controller.socket) {
                controller.socket.send(JSON.stringify({
                  type: 'GPS_UPDATE',
                  data: { deviceId: registeredDeviceId, ...coords }
                }));
              }
            }
          }
          break;
        }

        case 'SECURITY_ALERT': {
          const alert = telemetryHub.recordSecurityEvent({
            deviceId: registeredDeviceId,
            ...msg.data
          });
          for (const session of deviceManager.sessions.values()) {
            if (session.hostId === registeredDeviceId) {
              const controller = deviceManager.findDevice(session.controllerId);
              if (controller && controller.socket) {
                controller.socket.send(JSON.stringify({
                  type: 'ALARM_ALERT',
                  data: alert
                }));
              }
            }
          }
          break;
        }

        default:
          break;
      }
    } catch (err) {
      console.error('Signaling error:', err.message);
    }
  });

  ws.on('close', () => {
    const disconnectedId = deviceManager.disconnectDevice(ws);
    if (disconnectedId) {
      console.log(`Device disconnected: ${disconnectedId}`);
    }
  });
}

// Bind connection handlers
wssHttp.on('connection', handleWsConnection);
if (wssHttps) {
  wssHttps.on('connection', handleWsConnection);
}

httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[FATAL] Port ${PORT} is already in use by another process.`);
    process.exit(1);
  } else {
    console.error('[HTTP SERVER ERROR]', err);
  }
});

httpServer.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 OmniGuard Core Server: http://localhost:${PORT}`);
  console.log(`📡 WebSocket Signaling Hub Active on port ${PORT}`);
  if (httpsServer) {
    httpsServer.listen(HTTPS_PORT, () => {
      console.log(`🔒 Mobile HTTPS Secure Server: https://localhost:${HTTPS_PORT}`);
      console.log(`   (Use HTTPS for Android/iPhone Wi-Fi Camera access)`);
      console.log(`====================================================`);
    });
    httpsServer.on('error', (err) => {
      console.warn('[HTTPS WARNING] Port ' + HTTPS_PORT + ' busy or unavailable: ' + err.message);
    });
  } else {
    console.log(`====================================================`);
  }
});
