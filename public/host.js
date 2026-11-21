// OmniGuard Host / Broadcaster Engine
let socket = null;
let peerConnection = null;
let localMediaStream = null;
let myDeviceId = null;
let myPairingPin = null;
let activeControllerId = null;
let isTorchActive = false;
let wakeLock = null;

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// UI Elements
const hostStatusBadge = document.getElementById('hostStatusBadge');
const myHostIdEl = document.getElementById('myHostId');
const myPairingPinEl = document.getElementById('myPairingPin');
const myHostPasswordEl = document.getElementById('myHostPassword');
const hostPermanentPasswordInput = document.getElementById('hostPermanentPasswordInput');
const btnSaveHostPermanentPass = document.getElementById('btnSaveHostPermanentPass');
const hostPermPassSavedMsg = document.getElementById('hostPermPassSavedMsg');
const batteryStatusIndicator = document.getElementById('batteryStatusIndicator');

const btnStartScreen = document.getElementById('btnStartScreen');
const btnStartCam = document.getElementById('btnStartCam');
const btnAutoStartMobile = document.getElementById('btnAutoStartMobile');
const mobileStartBanner = document.getElementById('mobileStartBanner');
const btnEnableGps = document.getElementById('btnEnableGps');
const hostGpsStatus = document.getElementById('hostGpsStatus');
const hostLocalPreview = document.getElementById('hostLocalPreview');
const transparentBanner = document.getElementById('transparentBanner');
const sirenAudio = document.getElementById('sirenAudio');

// Disguise Elements
const stealthScreen = document.getElementById('stealthScreen');
const digitalClock = document.getElementById('digitalClock');
const calculatorDisguise = document.getElementById('calculatorDisguise');
const calcDisplay = document.getElementById('calcDisplay');
const notepadDisguise = document.getElementById('notepadDisguise');
const btnExitNotepad = document.getElementById('btnExitNotepad');

const btnLaunchCalc = document.getElementById('btnLaunchCalc');
const btnLaunchNotepad = document.getElementById('btnLaunchNotepad');
const btnLaunchClock = document.getElementById('btnLaunchClock');

const chkMotionDetect = document.getElementById('chkMotionDetect');
const chkSoundDetect = document.getElementById('chkSoundDetect');
const motionCanvas = document.getElementById('motionCanvas');

// 1. WebSocket Signaling Connection
function initHostSignaling() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${window.location.host}`);

  socket.onopen = () => {
    hostStatusBadge.textContent = 'Standby (Ready)';
    hostStatusBadge.classList.add('online');
    const savedId = localStorage.getItem('omniguard_host_device_id');
    const savedPermPwd = localStorage.getItem('omniguard_host_perm_pwd');
    socket.send(JSON.stringify({
      type: 'REGISTER',
      data: {
        type: 'HOST',
        name: 'Security-Node',
        deviceId: savedId || undefined,
        permanentPassword: savedPermPwd || undefined
      }
    }));
  };

  socket.onmessage = async (event) => {
    const msg = JSON.parse(event.data);

    switch (msg.type) {
      case 'REGISTERED':
        myDeviceId = msg.data.deviceId;
        myPairingPin = msg.data.pairingPin;
        localStorage.setItem('omniguard_host_device_id', myDeviceId);
        myHostIdEl.textContent = msg.data.deviceId;
        if (myPairingPinEl) myPairingPinEl.textContent = msg.data.pairingPin;
        myHostPasswordEl.value = msg.data.password;
        if (hostPermanentPasswordInput && (msg.data.permanentPassword || localStorage.getItem('omniguard_host_perm_pwd'))) {
          hostPermanentPasswordInput.value = msg.data.permanentPassword || localStorage.getItem('omniguard_host_perm_pwd');
        }
        initBatteryTelemetry();
        requestScreenWakeLock();
        break;

      case 'INCOMING_CONNECTION':
        activeControllerId = msg.data.controllerId;
        transparentBanner.style.display = 'block';
        hostStatusBadge.textContent = 'Live Session Active';
        break;

      case 'OFFER':
        await handleIncomingOffer(msg.data.fromId, msg.data.sdp);
        break;

      case 'ICE_CANDIDATE':
        if (peerConnection && msg.data.candidate) {
          try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(msg.data.candidate));
          } catch (e) {
            console.error('Error adding candidate:', e);
          }
        }
        break;

      case 'TRIGGER_BUZZ':
        triggerSirenAlarm();
        break;

      case 'SET_BLANK_SCREEN':
        if (msg.blank) {
          stealthScreen.style.display = 'flex';
          startDigitalClock();
        } else {
          stealthScreen.style.display = 'none';
        }
        break;

      case 'TOGGLE_CAMERA':
        toggleCameraFacing();
        break;

      case 'TOGGLE_TORCH':
        toggleHardwareTorch();
        break;
    }
  };

  socket.onclose = () => {
    hostStatusBadge.textContent = 'Offline';
    hostStatusBadge.classList.remove('online');
    setTimeout(initHostSignaling, 3000);
  };
}

// 2. Hardware Flashlight (Torch) Control
async function toggleHardwareTorch() {
  if (!localMediaStream) return;
  const videoTrack = localMediaStream.getVideoTracks()[0];
  if (!videoTrack) return;

  try {
    const capabilities = videoTrack.getCapabilities ? videoTrack.getCapabilities() : {};
    if (capabilities.torch) {
      isTorchActive = !isTorchActive;
      await videoTrack.applyConstraints({
        advanced: [{ torch: isTorchActive }]
      });
      console.log('Torch state applied:', isTorchActive);
    } else {
      console.warn('Hardware torch not supported on this camera/browser.');
    }
  } catch (err) {
    console.warn('Failed to toggle torch:', err);
  }
}

// 3. Screen Stay-Awake WakeLock
async function requestScreenWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('Screen WakeLock active (prevents sleeping)');
    } catch (e) {
      console.log('WakeLock not granted:', e);
    }
  }
}

// 4. Battery Telemetry Stream
function initBatteryTelemetry() {
  if ('getBattery' in navigator) {
    navigator.getBattery().then((battery) => {
      const report = () => {
        const data = { level: battery.level, charging: battery.charging };
        if (batteryStatusIndicator) {
          const icon = battery.charging ? '⚡' : '🔋';
          batteryStatusIndicator.textContent = `${icon} ${Math.round(battery.level * 100)}%`;
        }
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            type: 'BATTERY_STATUS',
            data
          }));
        }
      };
      report();
      battery.addEventListener('levelchange', report);
      battery.addEventListener('chargingchange', report);
      setInterval(report, 30000);
    }).catch(() => {});
  }
}

// 5. Media Acquisition (Screen or Camera)
btnStartScreen.addEventListener('click', async () => {
  try {
    localMediaStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    hostLocalPreview.srcObject = localMediaStream;
    btnStartScreen.textContent = '✅ Broadcasting Desktop';
    btnStartScreen.classList.remove('btn-primary');
    btnStartScreen.classList.add('btn-secondary');
    if (chkMotionDetect.checked) startMotionDetection();
    await updatePeerTracks(localMediaStream);
  } catch (err) {
    alert('Screen capture cancelled or blocked: ' + err.message);
  }
});

let currentFacingMode = 'user';
btnStartCam.addEventListener('click', async () => {
  try {
    localMediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: currentFacingMode },
      audio: true
    });
    hostLocalPreview.srcObject = localMediaStream;
    btnStartCam.textContent = '✅ Broadcasting Camera';
    btnStartCam.classList.remove('btn-secondary');
    btnStartCam.classList.add('btn-primary');
    if (chkMotionDetect.checked) startMotionDetection();
    if (chkSoundDetect.checked) startAcousticDetection(localMediaStream);
    await updatePeerTracks(localMediaStream);
  } catch (err) {
    alert('Camera access denied: ' + err.message);
  }
});

if (btnAutoStartMobile) {
  btnAutoStartMobile.addEventListener('click', () => {
    btnStartCam.click();
    if (mobileStartBanner) {
      mobileStartBanner.style.background = '#064e3b';
      mobileStartBanner.style.borderColor = '#10b981';
      mobileStartBanner.innerHTML = '<div style="font-size: 1rem; font-weight: 700; color: #34d399;">✅ ক্যামেরা ও অডিও লাইভ সক্রিয় আছে!</div><div style="font-size: 0.8rem; color: #cbd5e1; margin-top: 0.3rem;">উপরের আইডি বা পিন ব্যবহার করে পিসি থেকে কানেক্ট করুন।</div>';
    }
  });
}

async function toggleCameraFacing() {
  currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
  if (localMediaStream) {
    localMediaStream.getTracks().forEach(t => t.stop());
  }
  btnStartCam.click();
}

let standbyCanvasStream = null;

function createHostStandbyStream(text = 'OmniGuard Host Standby') {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');

  function draw() {
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('📡 OmniGuard Smart Security Broadcaster', canvas.width / 2, canvas.height / 2 - 40);

    ctx.fillStyle = '#34d399';
    ctx.font = '24px sans-serif';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 20);

    ctx.fillStyle = '#64748b';
    ctx.font = '18px monospace';
    ctx.fillText(new Date().toLocaleTimeString(), canvas.width / 2, canvas.height / 2 + 70);
  }
  draw();
  return canvas.captureStream(5);
}

// Helper to replace or add tracks in peer connection
async function updatePeerTracks(stream) {
  if (!peerConnection || !stream) return;
  const videoTrack = stream.getVideoTracks()[0];
  if (!videoTrack) return;

  const senders = peerConnection.getSenders();
  const videoSender = senders.find(s => s.track && s.track.kind === 'video');
  if (videoSender) {
    await videoSender.replaceTrack(videoTrack);
  } else {
    peerConnection.addTrack(videoTrack, stream);
  }
}

// 6. WebRTC Offer Handling & Media Streaming
async function handleIncomingOffer(controllerId, offerSdp) {
  peerConnection = new RTCPeerConnection(rtcConfig);

  // If local stream is not active yet, use standby stream
  if (!localMediaStream) {
    standbyCanvasStream = createHostStandbyStream('Connected to Controller - Camera Activating...');
    standbyCanvasStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, standbyCanvasStream);
    });
  } else {
    localMediaStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localMediaStream);
    });
  }

  peerConnection.onicecandidate = (event) => {
    if (event.candidate && socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'ICE_CANDIDATE',
        data: { targetId: controllerId, candidate: event.candidate }
      }));
    }
  };

  // DataChannel for incoming commands
  peerConnection.ondatachannel = (event) => {
    const dc = event.channel;
    dc.onmessage = (e) => {
      try {
        const cmd = JSON.parse(e.data);
        handleRemoteInput(cmd);
      } catch (err) {}
    };
  };

  await peerConnection.setRemoteDescription(new RTCSessionDescription(offerSdp));
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  socket.send(JSON.stringify({
    type: 'ANSWER',
    data: { targetId: controllerId, sdp: answer }
  }));
}

function handleRemoteInput(cmd) {
  // If local native agent is available, inject mouse/key
  fetch('http://localhost:5050/inject', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  }).catch(() => {});
}

// 7. TrackView Features: Siren, Clock, GPS, AI Sensors
function triggerSirenAlarm() {
  sirenAudio.currentTime = 0;
  sirenAudio.play().catch(e => console.log('Audio playback prevented:', e));
  alert('🚨 REMOTE SIREN BUZZ TRIGGERED BY CONTROLLER!');
}

let clockInterval = null;
function startDigitalClock() {
  if (clockInterval) clearInterval(clockInterval);
  clockInterval = setInterval(() => {
    const now = new Date();
    digitalClock.textContent = now.toTimeString().split(' ')[0];
  }, 1000);
}

btnEnableGps.addEventListener('click', () => {
  if (!navigator.geolocation) {
    alert('Geolocation not supported by this browser.');
    return;
  }
  btnEnableGps.textContent = '📍 Streaming GPS...';
  btnEnableGps.classList.remove('btn-secondary');
  btnEnableGps.classList.add('btn-primary');

  navigator.geolocation.watchPosition((pos) => {
    hostGpsStatus.textContent = `Lat: ${pos.coords.latitude.toFixed(5)}, Lng: ${pos.coords.longitude.toFixed(5)}`;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'GPS_UPDATE',
        data: {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          speed: pos.coords.speed
        }
      }));
    }
  }, (err) => {
    hostGpsStatus.textContent = `GPS Error: ${err.message}`;
  }, { enableHighAccuracy: true });
});

// AI Frame Difference Motion Detection
function startMotionDetection() {
  const ctx = motionCanvas.getContext('2d');
  motionCanvas.width = 160;
  motionCanvas.height = 120;
  let prevFrame = null;

  setInterval(() => {
    if (!localMediaStream) return;
    ctx.drawImage(hostLocalPreview, 0, 0, 160, 120);
    const currFrame = ctx.getImageData(0, 0, 160, 120);

    if (prevFrame) {
      let diff = 0;
      for (let i = 0; i < currFrame.data.length; i += 4) {
        diff += Math.abs(currFrame.data[i] - prevFrame.data[i]);
      }
      const score = diff / (160 * 120);
      if (score > 25) { // Threshold for motion
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            type: 'SECURITY_ALERT',
            data: { type: 'MOTION_DETECTED', severity: 'HIGH', score }
          }));
        }
      }
    }
    prevFrame = currFrame;
  }, 1000);
}

// Acoustic Spike Detection
function startAcousticDetection(stream) {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const buffer = new Uint8Array(analyser.frequencyBinCount);
    setInterval(() => {
      analyser.getByteFrequencyData(buffer);
      let sum = 0;
      for (let i = 0; i < buffer.length; i++) sum += buffer[i];
      const avg = sum / buffer.length;
      if (avg > 80) { // Loud noise threshold
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            type: 'SECURITY_ALERT',
            data: { type: 'ACOUSTIC_SPIKE', severity: 'MEDIUM', decibels: avg }
          }));
        }
      }
    }, 1500);
  } catch (err) {
    console.warn('Audio analysis not supported:', err);
  }
}

// 8. 4-Tier Stealth Disguise Engine
// Tier 1: Clock
if (btnLaunchClock) {
  btnLaunchClock.addEventListener('click', () => {
    stealthScreen.style.display = 'flex';
    startDigitalClock();
  });
}
stealthScreen.addEventListener('dblclick', () => {
  stealthScreen.style.display = 'none';
  if (clockInterval) clearInterval(clockInterval);
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    stealthScreen.style.display = 'none';
    if (clockInterval) clearInterval(clockInterval);
  }
});

// Tier 2: Calculator Disguise with Secret Unlock Code (2026= or 9999=)
let calcInput = '0';
let secretPinBuffer = '';

if (btnLaunchCalc) {
  btnLaunchCalc.addEventListener('click', () => {
    calculatorDisguise.style.display = 'flex';
    calcInput = '0';
    calcDisplay.textContent = '0';
  });
}

document.querySelectorAll('.calc-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const val = btn.dataset.val;

    if (val === 'C') {
      calcInput = '0';
      secretPinBuffer = '';
      calcDisplay.textContent = '0';
      return;
    }

    if (val === '=') {
      // Check Secret Unlock PIN
      if (secretPinBuffer === '2026' || secretPinBuffer === '9999' || calcInput === '2026' || calcInput === '9999') {
        calculatorDisguise.style.display = 'none';
        alert('🔓 Secret PIN Verified! Host dashboard unlocked.');
        secretPinBuffer = '';
        return;
      }
      try {
        const safeExpr = calcInput.replace(/[^0-9+\-*/.]/g, '');
        // Evaluate simple arithmetic safely
        const result = Function(`'use strict'; return (${safeExpr})`)();
        calcInput = String(result);
        calcDisplay.textContent = calcInput;
      } catch {
        calcDisplay.textContent = 'Error';
        calcInput = '0';
      }
      secretPinBuffer = '';
      return;
    }

    if (val === '+/-') {
      if (calcInput.startsWith('-')) {
        calcInput = calcInput.substring(1);
      } else if (calcInput !== '0') {
        calcInput = '-' + calcInput;
      }
      calcDisplay.textContent = calcInput;
      return;
    }

    if (val === '%') {
      calcInput = String(parseFloat(calcInput) / 100);
      calcDisplay.textContent = calcInput;
      return;
    }

    // Append digit or operator
    if (calcInput === '0' && !isNaN(val)) {
      calcInput = val;
    } else {
      calcInput += val;
    }
    if (!isNaN(val)) {
      secretPinBuffer += val;
    } else {
      secretPinBuffer = '';
    }
    calcDisplay.textContent = calcInput;
  });
});

// Tier 3: Notepad Disguise
if (btnLaunchNotepad) {
  btnLaunchNotepad.addEventListener('click', () => {
    notepadDisguise.style.display = 'flex';
  });
}
if (btnExitNotepad) {
  btnExitNotepad.addEventListener('click', () => {
    notepadDisguise.style.display = 'none';
  });
}

// Permanent Password Save Handler
if (btnSaveHostPermanentPass) {
  btnSaveHostPermanentPass.addEventListener('click', () => {
    const val = (hostPermanentPasswordInput.value || '').trim();
    if (!val) {
      alert('দয়া করে একটি পারমানেন্ট পাসওয়ার্ড লিখুন।');
      return;
    }
    localStorage.setItem('omniguard_host_perm_pwd', val);
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'SET_UNATTENDED_PASSWORD',
        data: { password: val }
      }));
    }
    if (hostPermPassSavedMsg) {
      hostPermPassSavedMsg.style.display = 'block';
      setTimeout(() => { hostPermPassSavedMsg.style.display = 'none'; }, 3000);
    }
  });
}

// Start Signaling on Load
window.addEventListener('DOMContentLoaded', initHostSignaling);
