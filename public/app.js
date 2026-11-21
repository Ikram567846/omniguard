// OmniGuard Controller & Master Console Engine
let socket = null;
let peerConnection = null;
let dataChannel = null;
let currentSessionId = null;
let currentPartnerId = null;
let connectionTimeout = null;

// Feature States
let isViewOnly = false;
let isNightVision = false;
let isTorchOn = false;
let mediaRecorder = null;
let recordedChunks = [];
let recordingStartTime = null;
let recordTimerInterval = null;
let leafletMap = null;
let mapMarker = null;

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// UI Elements - Top & Dashboard
const connectionBadge = document.getElementById('connectionBadge');
const localDeviceIdEl = document.getElementById('localDeviceId');
const localPasswordEl = document.getElementById('localPassword');
const partnerIdInput = document.getElementById('partnerIdInput');
const partnerPasswordInput = document.getElementById('partnerPasswordInput');
const sessionModeSelect = document.getElementById('sessionMode');
const btnConnect = document.getElementById('btnConnect');

// Fleet Book UI Elements
const btnToggleFleetBook = document.getElementById('btnToggleFleetBook');
const btnSaveToFleet = document.getElementById('btnSaveToFleet');
const fleetBookSection = document.getElementById('fleetBookSection');
const fleetList = document.getElementById('fleetList');

const mainDashboard = document.getElementById('mainDashboard');
const sessionContainer = document.getElementById('sessionContainer');
const remoteVideo = document.getElementById('remoteVideo');
const remoteAudio = document.getElementById('remoteAudio');
const sessionPartnerId = document.getElementById('sessionPartnerId');
const sessionBatteryPill = document.getElementById('sessionBatteryPill');

// Unattended Password Elements
const unattendedPasswordInput = document.getElementById('unattendedPasswordInput');
const btnGenUnattended = document.getElementById('btnGenUnattended');
const btnSaveUnattended = document.getElementById('btnSaveUnattended');
const unattendedMsg = document.getElementById('unattendedMsg');

// Commercial License Elements
const licenseBadge = document.getElementById('licenseBadge');
const licenseKeyInput = document.getElementById('licenseKeyInput');
const btnActivateLicense = document.getElementById('btnActivateLicense');
const licenseMsg = document.getElementById('licenseMsg');
const btnToggleGenerator = document.getElementById('btnToggleGenerator');
const keyGeneratorBox = document.getElementById('keyGeneratorBox');
const btnRunGenerator = document.getElementById('btnRunGenerator');
const genTier = document.getElementById('genTier');
const genYears = document.getElementById('genYears');
const generatedKeyResult = document.getElementById('generatedKeyResult');

// Toolbar buttons
const btnSwitchSide = document.getElementById('btnSwitchSide');
const btnBlankScreen = document.getElementById('btnBlankScreen');
const btnToggleCam = document.getElementById('btnToggleCam');
const btnToggleTorch = document.getElementById('btnToggleTorch');
const btnNightVision = document.getElementById('btnNightVision');
const btnTwoWayAudio = document.getElementById('btnTwoWayAudio');
const btnRemoteBuzz = document.getElementById('btnRemoteBuzz');
const btnRecordDvr = document.getElementById('btnRecordDvr');
const btnSnapshot = document.getElementById('btnSnapshot');
const btnViewOnly = document.getElementById('btnViewOnly');
const btnEndSession = document.getElementById('btnEndSession');
const btnFileTransfer = document.getElementById('btnFileTransfer');
const fileInput = document.getElementById('fileInput');

// Drawers
const btnChatToggle = document.getElementById('btnChatToggle');
const chatDrawer = document.getElementById('chatDrawer');
const closeChatBtn = document.getElementById('closeChatBtn');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const btnSendChat = document.getElementById('btnSendChat');

const btnGpsToggle = document.getElementById('btnGpsToggle');
const gpsDrawer = document.getElementById('gpsDrawer');
const closeGpsBtn = document.getElementById('closeGpsBtn');
const gpsStatus = document.getElementById('gpsStatus');
const gpsCoordsList = document.getElementById('gpsCoordsList');
const alarmFeed = document.getElementById('alarmFeed');
const liveMapContainer = document.getElementById('liveMapContainer');

// 1. Initialize WebSocket Signaling Connection
function initSignaling() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${window.location.host}`);

  socket.onopen = () => {
    connectionBadge.textContent = 'Online';
    connectionBadge.classList.add('online');
    socket.send(JSON.stringify({
      type: 'REGISTER',
      data: { type: 'CONTROLLER', name: 'Master-Console' }
    }));
  };

  socket.onmessage = async (event) => {
    const msg = JSON.parse(event.data);

    switch (msg.type) {
      case 'REGISTERED':
        localDeviceIdEl.textContent = msg.data.deviceId;
        localPasswordEl.value = msg.data.password;
        if (msg.data.permanentPassword) {
          unattendedPasswordInput.value = msg.data.permanentPassword;
        }
        checkLicenseStatus(msg.data.deviceId);
        break;

      case 'CONNECT_ACCEPTED':
        currentSessionId = msg.data.sessionId;
        currentPartnerId = msg.data.hostId;
        initiateWebRTC(msg.data.hostId);
        break;

      case 'CONNECT_ERROR':
        clearTimeout(connectionTimeout);
        alert(`Connection Failed: ${msg.error}`);
        btnConnect.disabled = false;
        btnConnect.textContent = '⚡ Connect to Partner';
        break;

      case 'ANSWER':
        if (peerConnection) {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.data.sdp));
        }
        break;

      case 'ICE_CANDIDATE':
        if (peerConnection && msg.data.candidate) {
          try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(msg.data.candidate));
          } catch (e) {
            console.error('Error adding ICE candidate:', e);
          }
        }
        break;

      case 'BATTERY_STATUS':
        updateBatteryPill(msg.data);
        break;

      case 'GPS_UPDATE':
        updateGpsDisplay(msg.data);
        break;

      case 'ALARM_ALERT':
        renderAlarmAlert(msg.data);
        break;

      case 'SIDE_SWITCHED':
        alert('Control Side Swapped! You are now acting as the Host.');
        break;

      case 'SESSION_ENDED':
        alert('Remote Partner ended the session.');
        endSession();
        break;
    }
  };

  socket.onclose = () => {
    connectionBadge.textContent = 'Disconnected';
    connectionBadge.classList.remove('online');
    setTimeout(initSignaling, 3000);
  };
}

function enterSessionView() {
  clearTimeout(connectionTimeout);
  if (sessionContainer.style.display !== 'flex') {
    mainDashboard.style.display = 'none';
    sessionContainer.style.display = 'flex';
    sessionPartnerId.textContent = `Target: ${currentPartnerId}`;
    btnConnect.disabled = false;
    btnConnect.textContent = '⚡ Connect to Partner';
  }
}

// 2. WebRTC Peer Connection & Media Pipelines
async function initiateWebRTC(hostId) {
  peerConnection = new RTCPeerConnection(rtcConfig);

  // Setup DataChannel for ultra low-latency mouse/keyboard/chat
  dataChannel = peerConnection.createDataChannel('controlChannel', { ordered: true });
  setupDataChannel(dataChannel);

  // When remote video/audio track arrives
  peerConnection.ontrack = (event) => {
    enterSessionView();
    if (event.track.kind === 'video') {
      remoteVideo.srcObject = event.streams[0];
    } else if (event.track.kind === 'audio') {
      remoteAudio.srcObject = event.streams[0];
    }
  };

  peerConnection.onconnectionstatechange = () => {
    if (peerConnection.connectionState === 'connected') {
      enterSessionView();
    }
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.send(JSON.stringify({
        type: 'ICE_CANDIDATE',
        data: { targetId: hostId, candidate: event.candidate }
      }));
    }
  };

  // Add transceivers for receiving remote screen/camera
  peerConnection.addTransceiver('video', { direction: 'recvonly' });
  peerConnection.addTransceiver('audio', { direction: 'recvonly' });

  // Create WebRTC Offer
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  socket.send(JSON.stringify({
    type: 'OFFER',
    data: { targetId: hostId, sdp: offer }
  }));
}

function setupDataChannel(dc) {
  dc.onopen = () => {
    console.log('WebRTC DataChannel connected!');
    enterSessionView();
  };
  dc.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'CHAT') {
        appendChatMessage('Partner', data.text);
      }
    } catch {
      // Binary chunk
    }
  };
}

// 3. User Controls & High-DPI Mouse/Keyboard Input Normalization
function getNormalizedVideoCoordinates(e, video) {
  const rect = video.getBoundingClientRect();
  const videoWidth = video.videoWidth || 1920;
  const videoHeight = video.videoHeight || 1080;
  const videoRatio = videoWidth / videoHeight;
  const elementRatio = rect.width / rect.height;

  let renderWidth = rect.width;
  let renderHeight = rect.height;
  let offsetX = 0;
  let offsetY = 0;

  if (elementRatio > videoRatio) {
    renderWidth = rect.height * videoRatio;
    offsetX = (rect.width - renderWidth) / 2;
  } else {
    renderHeight = rect.width / videoRatio;
    offsetY = (rect.height - renderHeight) / 2;
  }

  const clickX = e.clientX - rect.left - offsetX;
  const clickY = e.clientY - rect.top - offsetY;

  if (clickX < 0 || clickX > renderWidth || clickY < 0 || clickY > renderHeight) {
    return null; // Click fell outside actual video rendering bounds
  }

  return {
    x: Math.max(0, Math.min(1, clickX / renderWidth)),
    y: Math.max(0, Math.min(1, clickY / renderHeight))
  };
}

btnConnect.addEventListener('click', () => {
  const hostId = partnerIdInput.value.trim();
  const password = partnerPasswordInput.value.trim();
  const mode = sessionModeSelect.value;

  if (!hostId || !password) {
    alert('Please enter both Partner ID (or PIN) and Password.');
    return;
  }

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    alert('Signaling server is offline! Please ensure server is running.');
    return;
  }

  btnConnect.disabled = true;
  btnConnect.textContent = 'Connecting...';

  clearTimeout(connectionTimeout);
  connectionTimeout = setTimeout(() => {
    if (sessionContainer.style.display !== 'flex') {
      alert('Connection timed out. Target device did not respond or may be offline.');
      btnConnect.disabled = false;
      btnConnect.textContent = '⚡ Connect to Partner';
    }
  }, 15000);

  socket.send(JSON.stringify({
    type: 'CONNECT_REQUEST',
    data: { hostId, password, mode }
  }));
});

// Interactive Mouse & Keyboard Capture over Video with High-DPI Aspect Ratio calculation
remoteVideo.addEventListener('mousemove', (e) => {
  if (isViewOnly) return;
  if (!dataChannel || dataChannel.readyState !== 'open') return;

  const coords = getNormalizedVideoCoordinates(e, remoteVideo);
  if (!coords) return;

  dataChannel.send(JSON.stringify({
    type: 'MOUSE_MOVE',
    x: coords.x,
    y: coords.y
  }));
});

remoteVideo.addEventListener('mousedown', (e) => {
  if (isViewOnly) return;
  if (!dataChannel || dataChannel.readyState !== 'open') return;
  dataChannel.send(JSON.stringify({ type: 'MOUSE_DOWN', button: e.button }));
});

remoteVideo.addEventListener('mouseup', (e) => {
  if (isViewOnly) return;
  if (!dataChannel || dataChannel.readyState !== 'open') return;
  dataChannel.send(JSON.stringify({ type: 'MOUSE_UP', button: e.button }));
});

window.addEventListener('keydown', (e) => {
  if (sessionContainer.style.display !== 'flex') return;
  if (document.activeElement === chatInput) return;
  if (isViewOnly) return;
  if (!dataChannel || dataChannel.readyState !== 'open') return;
  dataChannel.send(JSON.stringify({ type: 'KEY_DOWN', key: e.key, code: e.code }));
});

window.addEventListener('keyup', (e) => {
  if (sessionContainer.style.display !== 'flex') return;
  if (document.activeElement === chatInput) return;
  if (isViewOnly) return;
  if (!dataChannel || dataChannel.readyState !== 'open') return;
  dataChannel.send(JSON.stringify({ type: 'KEY_UP', key: e.key, code: e.code }));
});

// 4. Remote Action Toolbar Buttons
btnSwitchSide.addEventListener('click', () => {
  socket.send(JSON.stringify({
    type: 'SWITCH_SIDE',
    data: { sessionId: currentSessionId }
  }));
});

let isBlank = false;
btnBlankScreen.addEventListener('click', () => {
  isBlank = !isBlank;
  btnBlankScreen.classList.toggle('active', isBlank);
  socket.send(JSON.stringify({
    type: 'BLANK_SCREEN',
    data: { targetId: currentPartnerId, blank: isBlank }
  }));
});

btnToggleCam.addEventListener('click', () => {
  socket.send(JSON.stringify({
    type: 'SWITCH_CAMERA',
    data: { targetId: currentPartnerId }
  }));
});

if (btnToggleTorch) {
  btnToggleTorch.addEventListener('click', () => {
    isTorchOn = !isTorchOn;
    btnToggleTorch.classList.toggle('active', isTorchOn);
    socket.send(JSON.stringify({
      type: 'TOGGLE_TORCH',
      data: { targetId: currentPartnerId }
    }));
  });
}

if (btnNightVision) {
  btnNightVision.addEventListener('click', () => {
    isNightVision = !isNightVision;
    btnNightVision.classList.toggle('active', isNightVision);
    remoteVideo.classList.toggle('night-vision-active', isNightVision);
  });
}

if (btnViewOnly) {
  btnViewOnly.addEventListener('click', () => {
    isViewOnly = !isViewOnly;
    btnViewOnly.classList.toggle('active', isViewOnly);
    btnViewOnly.textContent = isViewOnly ? '🔒 View-Only: ON' : '👁️ View-Only';
  });
}

btnRemoteBuzz.addEventListener('click', () => {
  socket.send(JSON.stringify({
    type: 'TRIGGER_BUZZ',
    data: { targetId: currentPartnerId }
  }));
});

// DVR Screen & Camera Recording (MediaRecorder API)
if (btnRecordDvr) {
  btnRecordDvr.addEventListener('click', () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      // Stop Recording
      mediaRecorder.stop();
      clearInterval(recordTimerInterval);
      btnRecordDvr.textContent = '📹 Record DVR';
      btnRecordDvr.classList.remove('recording-active');
    } else {
      // Start Recording
      const stream = remoteVideo.srcObject;
      if (!stream) {
        alert('No active video stream to record!');
        return;
      }
      recordedChunks = [];
      let options = { mimeType: 'video/webm;codecs=vp8,opus' };
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = { mimeType: 'video/webm' };
      }
      try {
        mediaRecorder = new MediaRecorder(stream, options);
      } catch (err) {
        mediaRecorder = new MediaRecorder(stream);
      }

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = `OmniGuard_DVR_${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
        }, 100);
      };

      mediaRecorder.start(1000);
      recordingStartTime = Date.now();
      btnRecordDvr.classList.add('recording-active');

      recordTimerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
        const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const s = String(elapsed % 60).padStart(2, '0');
        btnRecordDvr.textContent = `⏹️ Stop Rec (${m}:${s})`;
      }, 1000);
    }
  });
}

// Snapshot Frame Capture to PNG
if (btnSnapshot) {
  btnSnapshot.addEventListener('click', () => {
    if (!remoteVideo || !remoteVideo.videoWidth) {
      alert('Video stream not ready for snapshot.');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = remoteVideo.videoWidth;
    canvas.height = remoteVideo.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(remoteVideo, 0, 0, canvas.width, canvas.height);

    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `OmniGuard_Snapshot_${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }, 100);
    }, 'image/png');
  });
}

// Battery Status Pill Updater
function updateBatteryPill(batteryData) {
  if (!sessionBatteryPill || !batteryData) return;
  const levelPct = Math.round((batteryData.level || 1) * 100);
  const icon = batteryData.charging ? '⚡' : '🔋';
  sessionBatteryPill.textContent = `${icon} ${levelPct}%`;

  if (levelPct <= 20 && !batteryData.charging) {
    sessionBatteryPill.style.background = '#ef4444';
    sessionBatteryPill.style.color = '#fff';
  } else {
    sessionBatteryPill.style.background = '#1e293b';
    sessionBatteryPill.style.color = '#34d399';
  }
}

btnEndSession.addEventListener('click', () => {
  endSession();
});

function endSession() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    clearInterval(recordTimerInterval);
    btnRecordDvr.textContent = '📹 Record DVR';
    btnRecordDvr.classList.remove('recording-active');
  }
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  sessionContainer.style.display = 'none';
  mainDashboard.style.display = 'block';
  btnConnect.disabled = false;
  btnConnect.textContent = '⚡ Connect to Partner';
}

// 5. Saved Fleet Book (Persistent Address Book)
function getFleetBook() {
  try {
    return JSON.parse(localStorage.getItem('omniguard_fleet') || '[]');
  } catch {
    return [];
  }
}

function saveFleetBook(list) {
  localStorage.setItem('omniguard_fleet', JSON.stringify(list));
  renderFleetList();
}

function renderFleetList() {
  if (!fleetList) return;
  const fleet = getFleetBook();
  fleetList.innerHTML = '';

  if (fleet.length === 0) {
    fleetList.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem; text-align: center; padding: 0.5rem;">No saved devices. Use "⭐ Save Device" above.</div>';
    return;
  }

  fleet.forEach((item, index) => {
    const el = document.createElement('div');
    el.className = 'fleet-item';
    el.innerHTML = `
      <div class="fleet-info">
        <span class="fleet-name">${escapeHtml(item.name || 'Device ' + (index + 1))}</span>
        <span class="fleet-id">${item.id} (${item.mode === 'CAMERA_SURVEILLANCE' ? '📷 CCTV' : '🖥️ Desktop'})</span>
      </div>
      <div class="fleet-actions">
        <button class="fleet-connect-btn" data-index="${index}">⚡ Connect</button>
        <button class="fleet-delete-btn" data-index="${index}" title="Remove">🗑️</button>
      </div>
    `;
    fleetList.appendChild(el);
  });

  // Attach event handlers
  fleetList.querySelectorAll('.fleet-connect-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.index, 10);
      const target = getFleetBook()[idx];
      if (target) {
        partnerIdInput.value = target.id;
        partnerPasswordInput.value = target.password || '';
        if (target.mode) sessionModeSelect.value = target.mode;
        btnConnect.click();
      }
    });
  });

  fleetList.querySelectorAll('.fleet-delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.index, 10);
      const fleet = getFleetBook();
      fleet.splice(idx, 1);
      saveFleetBook(fleet);
    });
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

if (btnToggleFleetBook) {
  btnToggleFleetBook.addEventListener('click', () => {
    const isHidden = fleetBookSection.style.display === 'none';
    fleetBookSection.style.display = isHidden ? 'block' : 'none';
    if (isHidden) renderFleetList();
  });
}

if (btnSaveToFleet) {
  btnSaveToFleet.addEventListener('click', () => {
    const id = partnerIdInput.value.trim();
    const password = partnerPasswordInput.value.trim();
    const mode = sessionModeSelect.value;
    if (!id) {
      alert('Please enter a Partner ID first.');
      return;
    }
    const name = prompt('Enter a nickname for this device (e.g. "Living Room Phone", "Office Laptop"):', 'My Device');
    if (!name) return;

    const fleet = getFleetBook();
    fleet.push({ name, id, password, mode, addedAt: Date.now() });
    saveFleetBook(fleet);
    fleetBookSection.style.display = 'block';
    alert(`Device "${name}" saved to Fleet Book!`);
  });
}

// 6. Unattended Master Password Generator & Saver
btnGenUnattended.addEventListener('click', () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
  let pwd = '';
  for (let i = 0; i < 12; i++) {
    pwd += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  unattendedPasswordInput.value = pwd;
});

btnSaveUnattended.addEventListener('click', async () => {
  const pwd = unattendedPasswordInput.value.trim();
  const deviceId = localDeviceIdEl.textContent.trim();
  if (!pwd) {
    alert('Please enter or generate a password first.');
    return;
  }
  try {
    const res = await fetch('/api/device/unattended', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, permanentPassword: pwd })
    });
    const data = await res.json();
    if (data.success) {
      unattendedMsg.style.display = 'inline';
      setTimeout(() => { unattendedMsg.style.display = 'none'; }, 3000);
    }
  } catch (err) {
    alert('Failed to save unattended password: ' + err.message);
  }
});

// 7. Commercial License Activation & Key Generator
btnToggleGenerator.addEventListener('click', () => {
  const isHidden = keyGeneratorBox.style.display === 'none';
  keyGeneratorBox.style.display = isHidden ? 'block' : 'none';
});

btnRunGenerator.addEventListener('click', async () => {
  const tier = genTier.value;
  const years = genYears.value;
  try {
    const res = await fetch('/api/license/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier, years })
    });
    const data = await res.json();
    if (data.success) {
      generatedKeyResult.textContent = `Generated Key: ${data.key}`;
      licenseKeyInput.value = data.key;
    }
  } catch (err) {
    alert('Key generation failed: ' + err.message);
  }
});

btnActivateLicense.addEventListener('click', async () => {
  const key = licenseKeyInput.value.trim();
  const deviceId = localDeviceIdEl.textContent.trim();
  if (!key) {
    alert('Please enter or generate a license key first.');
    return;
  }
  try {
    const res = await fetch('/api/license/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, licenseKey: key })
    });
    const data = await res.json();
    if (data.success) {
      licenseMsg.textContent = `✅ Active: ${data.license.tier} (Expires: ${new Date(data.license.expiresAt).toLocaleDateString()})`;
      licenseMsg.style.color = '#34d399';
      licenseBadge.textContent = `🔑 ${data.license.tier} Commercial`;
      licenseBadge.style.background = '#10b981';
      alert(data.message);
    } else {
      licenseMsg.textContent = `❌ ${data.error}`;
      licenseMsg.style.color = '#ef4444';
    }
  } catch (err) {
    alert('License activation error: ' + err.message);
  }
});

async function checkLicenseStatus(deviceId) {
  try {
    const res = await fetch(`/api/license/status/${encodeURIComponent(deviceId)}`);
    const data = await res.json();
    if (data && data.tier && data.tier !== 'COMMUNITY_FREE') {
      licenseBadge.textContent = `🔑 ${data.tier} Commercial`;
      licenseBadge.style.background = '#10b981';
    }
  } catch (_) {}
}

// 8. Chat and Interactive Leaflet GPS Drawers
btnChatToggle.addEventListener('click', () => chatDrawer.classList.toggle('open'));
closeChatBtn.addEventListener('click', () => chatDrawer.classList.remove('open'));

btnSendChat.addEventListener('click', () => {
  const text = chatInput.value.trim();
  if (!text || !dataChannel || dataChannel.readyState !== 'open') return;
  dataChannel.send(JSON.stringify({ type: 'CHAT', text }));
  appendChatMessage('Me', text);
  chatInput.value = '';
});

function appendChatMessage(sender, text) {
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${sender === 'Me' ? 'me' : 'partner'}`;
  bubble.textContent = `${sender}: ${text}`;
  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

btnGpsToggle.addEventListener('click', () => {
  gpsDrawer.classList.toggle('open');
  if (gpsDrawer.classList.contains('open') && leafletMap) {
    setTimeout(() => leafletMap.invalidateSize(), 300);
  }
});
closeGpsBtn.addEventListener('click', () => gpsDrawer.classList.remove('open'));

function updateGpsDisplay(coords) {
  gpsStatus.textContent = `Active Fix: Lat ${coords.latitude.toFixed(5)}, Lng ${coords.longitude.toFixed(5)}`;
  const item = document.createElement('div');
  item.style.fontSize = '0.75rem';
  item.style.color = '#93c5fd';
  item.textContent = `[${new Date().toLocaleTimeString()}] Lat: ${coords.latitude.toFixed(5)}, Lng: ${coords.longitude.toFixed(5)}`;
  gpsCoordsList.prepend(item);

  // Initialize or update interactive Leaflet Map
  if (window.L && liveMapContainer) {
    try {
      if (!leafletMap) {
        leafletMap = L.map('liveMapContainer').setView([coords.latitude, coords.longitude], 15);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '© OpenStreetMap'
        }).addTo(leafletMap);
        mapMarker = L.marker([coords.latitude, coords.longitude]).addTo(leafletMap);
      } else {
        if (mapMarker) {
          mapMarker.setLatLng([coords.latitude, coords.longitude]);
        }
        leafletMap.setView([coords.latitude, coords.longitude]);
      }
    } catch (e) {
      console.warn('Leaflet map update failed:', e);
    }
  }
}

function renderAlarmAlert(alert) {
  const item = document.createElement('div');
  item.style.padding = '0.35rem';
  item.style.borderRadius = '4px';
  item.style.background = alert.type === 'MOTION_DETECTED' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(245, 158, 11, 0.2)';
  item.style.color = alert.type === 'MOTION_DETECTED' ? '#fca5a5' : '#fcd34d';
  item.textContent = `⚠️ [${new Date().toLocaleTimeString()}] ${alert.type} on host`;
  alarmFeed.prepend(item);
}

// File Transfer trigger
btnFileTransfer.addEventListener('click', () => fileInput.click());

// --- Integrated Master Features: Customer Link Sharing & 4-Way CCTV Grid ---
const btnCopyCustomerLink = document.getElementById('btnCopyCustomerLink');
const btnToggleGridMode = document.getElementById('btnToggleGridMode');
const btnCloseGridMode = document.getElementById('btnCloseGridMode');
const cctvGridContainer = document.getElementById('cctvGridContainer');
const directClientUrlInput = document.getElementById('directClientUrlInput');
const btnCopyDirectClientUrl = document.getElementById('btnCopyDirectClientUrl');

function copyCustomerClientLink() {
  const url = `${window.location.origin}/client`;
  navigator.clipboard.writeText(url).then(() => {
    alert(`কাস্টমার লিংক সফলভাবে কপি হয়েছে!\n\n${url}\n\nএই লিংকটি আপনার ক্লায়েন্ট বা কাস্টমারকে দিন।`);
  }).catch(() => {
    prompt('নিচের লিংকটি কপি করে কাস্টমারকে দিন:', url);
  });
}

if (btnCopyCustomerLink) {
  btnCopyCustomerLink.addEventListener('click', copyCustomerClientLink);
}
if (btnCopyDirectClientUrl) {
  btnCopyDirectClientUrl.addEventListener('click', copyCustomerClientLink);
}

if (btnToggleGridMode) {
  btnToggleGridMode.addEventListener('click', () => {
    mainDashboard.style.display = 'none';
    cctvGridContainer.style.display = 'block';
  });
}

if (btnCloseGridMode) {
  btnCloseGridMode.addEventListener('click', () => {
    cctvGridContainer.style.display = 'none';
    mainDashboard.style.display = 'block';
  });
}

// 4-Way Grid Channel Connector
const gridChannels = {};
window.connectGridChannel = function(chNum) {
  const idEl = document.getElementById(`gridId${chNum}`);
  const pwdEl = document.getElementById(`gridPwd${chNum}`);
  const id = idEl.value.trim();
  const pwd = pwdEl.value.trim();

  if (!id || !pwd) {
    alert('দয়া করে আইডি এবং পাসওয়ার্ড উভয়ই লিখুন।');
    return;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const gridWs = new WebSocket(`${protocol}//${window.location.host}`);
  const badge = document.getElementById(`gridBadge${chNum}`);
  const form = document.getElementById(`gridForm${chNum}`);
  const vid = document.getElementById(`gridVid${chNum}`);

  badge.textContent = 'Connecting...';
  badge.style.color = '#f59e0b';

  let pc = null;

  gridWs.onopen = () => {
    gridWs.send(JSON.stringify({
      type: 'REGISTER',
      data: { type: 'CONTROLLER', name: `Grid-Viewer-${chNum}` }
    }));
  };

  gridWs.onmessage = async (e) => {
    const msg = JSON.parse(e.data);

    if (msg.type === 'REGISTERED') {
      gridWs.send(JSON.stringify({
        type: 'CONNECT_REQUEST',
        data: { hostId: id, password: pwd, mode: 'CAMERA_SURVEILLANCE' }
      }));
    } else if (msg.type === 'CONNECT_ACCEPTED') {
      form.style.display = 'none';
      badge.textContent = `🟢 LIVE (${id})`;
      badge.style.color = '#10b981';

      pc = new RTCPeerConnection(rtcConfig);
      pc.addTransceiver('video', { direction: 'recvonly' });

      pc.ontrack = (event) => {
        if (event.track.kind === 'video') {
          vid.srcObject = event.streams[0];
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          gridWs.send(JSON.stringify({
            type: 'ICE_CANDIDATE',
            data: { targetId: id, candidate: event.candidate }
          }));
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      gridWs.send(JSON.stringify({
        type: 'OFFER',
        data: { targetId: id, sdp: offer }
      }));
    } else if (msg.type === 'ANSWER' && pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(msg.data.sdp));
    } else if (msg.type === 'ICE_CANDIDATE' && pc && msg.data.candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(msg.data.candidate));
    } else if (msg.type === 'CONNECT_ERROR') {
      alert(`CH ${chNum} ত্রুটি: ${msg.error}`);
      badge.textContent = 'Failed';
      badge.style.color = '#ef4444';
    }
  };

  gridChannels[chNum] = { gridWs, pc };
};

// Start Signaling & Load Fleet on DOM Ready
window.addEventListener('DOMContentLoaded', () => {
  initSignaling();
  renderFleetList();
  if (directClientUrlInput) {
    directClientUrlInput.value = `${window.location.origin}/client`;
  }
});
