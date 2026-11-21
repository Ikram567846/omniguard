// OmniGuard Unified Client Engine (Remote Support + Smart CCTV)
let socket = null;
let peerConnection = null;
let dataChannel = null;
let localStream = null;
let standbyStream = null;
let currentSessionId = null;
let activeControllerId = null;
let activeMode = 'SUPPORT'; // 'SUPPORT' or 'CCTV'
let currentFacingMode = 'environment';
let isTorchActive = false;
let wakeLock = null;

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// UI Elements - Tabs & Global
const tabBtnSupport = document.getElementById('tabBtnSupport');
const tabBtnCctv = document.getElementById('tabBtnCctv');
const tabContentSupport = document.getElementById('tabContentSupport');
const tabContentCctv = document.getElementById('tabContentCctv');
const clientStatusBadge = document.getElementById('clientStatusBadge');
const batteryIndicator = document.getElementById('batteryIndicator');

// UI Elements - Remote Support
const custDeviceId = document.getElementById('custDeviceId');
const custPassword = document.getElementById('custPassword');
const custPairingPin = document.getElementById('custPairingPin');
const btnCopyId = document.getElementById('btnCopyId');
const btnCopyPin = document.getElementById('btnCopyPin');
const btnRefreshPass = document.getElementById('btnRefreshPass');
const incomingRequestBox = document.getElementById('incomingRequestBox');
const incomingAgentInfo = document.getElementById('incomingAgentInfo');
const btnAcceptScreenShare = document.getElementById('btnAcceptScreenShare');
const btnRejectSession = document.getElementById('btnRejectSession');
const activeSessionBox = document.getElementById('activeSessionBox');
const sessionAgentInfo = document.getElementById('sessionAgentInfo');
const btnDisconnectSession = document.getElementById('btnDisconnectSession');
const chkAllowControl = document.getElementById('chkAllowControl');
const agentDot = document.getElementById('agentDot');
const agentText = document.getElementById('agentText');
const custLicenseBadge = document.getElementById('custLicenseBadge');
const custLicenseInput = document.getElementById('custLicenseInput');
const btnActivateCustLicense = document.getElementById('btnActivateCustLicense');
const custLicenseMsg = document.getElementById('custLicenseMsg');

// UI Elements - CCTV
const cctvVideo = document.getElementById('cctvVideo');
const cctvPinBanner = document.getElementById('cctvPinBanner');
const cctvIdDisplay = document.getElementById('cctvIdDisplay');
const cctvPinDisplay = document.getElementById('cctvPinDisplay');
const btnFlipCamera = document.getElementById('btnFlipCamera');
const btnToggleTorch = document.getElementById('btnToggleTorch');
const btnDisguiseCalc = document.getElementById('btnDisguiseCalc');
const btnDisguiseClock = document.getElementById('btnDisguiseClock');
const clockOverlay = document.getElementById('clockOverlay');
const calcOverlay = document.getElementById('calcOverlay');
const liveClockText = document.getElementById('liveClockText');
const calcDisplay = document.getElementById('calcDisplay');

// 1. Tab Switching Logic
function switchTab(mode) {
  if (mode === 'support') {
    activeMode = 'SUPPORT';
    tabBtnSupport.classList.add('active');
    tabBtnCctv.classList.remove('active');
    tabContentSupport.classList.add('active');
    tabContentCctv.classList.remove('active');
  } else {
    activeMode = 'CCTV';
    tabBtnCctv.classList.add('active');
    tabBtnSupport.classList.remove('active');
    tabContentCctv.classList.add('active');
    tabContentSupport.classList.remove('active');
    startCameraStream();
    requestWakeLock();
  }
}

// 2. Standby Canvas Stream (ensures instant WebRTC setup without blocking user activation)
function createStandbyStream(text = 'Awaiting Screen Share...') {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');

  function draw() {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🛡️ OmniGuard Remote QuickSupport', canvas.width / 2, canvas.height / 2 - 40);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '24px sans-serif';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 20);

    ctx.fillStyle = '#64748b';
    ctx.font = '18px monospace';
    ctx.fillText(new Date().toLocaleTimeString(), canvas.width / 2, canvas.height / 2 + 70);
  }
  draw();
  return canvas.captureStream(5);
}

// 3. Camera Stream (for CCTV mode)
async function startCameraStream() {
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
  }
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: currentFacingMode },
      audio: true
    });
    cctvVideo.srcObject = localStream;
    initAudioSensors(localStream);
    initMotionDetection();
  } catch (err) {
    console.warn('Camera access denied or unavailable:', err.message);
  }
}

// 4. WebSocket Signaling Connection
function initSignaling() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${window.location.host}`);

  socket.onopen = () => {
    clientStatusBadge.className = 'badge online';
    clientStatusBadge.textContent = '🟢 অনলাইন প্রস্তুত';
    
    socket.send(JSON.stringify({
      type: 'REGISTER',
      data: { type: 'HOST', name: 'OmniGuard-Client' }
    }));
  };

  socket.onmessage = async (event) => {
    const msg = JSON.parse(event.data);

    switch (msg.type) {
      case 'REGISTERED':
        const id = msg.data.deviceId;
        const pin = msg.data.pairingPin;
        const pwd = msg.data.password;

        custDeviceId.textContent = id;
        custPassword.textContent = pwd;
        custPairingPin.textContent = pin;

        cctvIdDisplay.textContent = id;
        cctvPinDisplay.textContent = pin;
        cctvPinBanner.textContent = `PIN: ${pin}`;

        checkLicenseStatus(id);
        break;

      case 'PASSWORD_REFRESHED':
        custPassword.textContent = msg.data.password;
        break;

      case 'CONNECT_REQUEST':
        currentSessionId = msg.data.sessionId;
        activeControllerId = msg.data.controllerId;
        const reqMode = msg.data.mode || 'FULL_CONTROL';

        if (reqMode === 'CAMERA_SURVEILLANCE' || activeMode === 'CCTV') {
          // Auto-accept CCTV surveillance
          socket.send(JSON.stringify({
            type: 'ACCEPT_CONNECT',
            data: { sessionId: currentSessionId }
          }));
          setupWebRTCConnection(msg.data.controllerId, 'CCTV');
        } else {
          // Remote PC Support request: display approval box
          incomingRequestBox.style.display = 'block';
          incomingAgentInfo.textContent = `টেকনিশিয়ান (${msg.data.controllerId}) আপনার স্ক্রিন নিয়ন্ত্রণ করতে চাচ্ছেন।`;
        }
        break;

      case 'OFFER':
        if (peerConnection) {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.data.sdp));
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);

          socket.send(JSON.stringify({
            type: 'ANSWER',
            data: { targetId: msg.data.sourceId, sdp: answer }
          }));
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

      case 'SESSION_ENDED':
        endLocalSession();
        break;
    }
  };

  socket.onclose = () => {
    clientStatusBadge.className = 'badge';
    clientStatusBadge.textContent = '🔴 সংযোগ বিচ্ছিন্ন';
    setTimeout(initSignaling, 3000);
  };
}

// 5. WebRTC Setup
function setupWebRTCConnection(targetId, mode = 'SUPPORT') {
  if (peerConnection) {
    peerConnection.close();
  }

  peerConnection = new RTCPeerConnection(rtcConfig);

  // Send video track
  let streamToSend = (mode === 'CCTV' && localStream) ? localStream : (localStream || standbyStream);
  if (!streamToSend) {
    standbyStream = createStandbyStream();
    streamToSend = standbyStream;
  }

  streamToSend.getTracks().forEach(track => {
    peerConnection.addTrack(track, streamToSend);
  });

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.send(JSON.stringify({
        type: 'ICE_CANDIDATE',
        data: { targetId: targetId, candidate: event.candidate }
      }));
    }
  };

  peerConnection.ondatachannel = (event) => {
    dataChannel = event.channel;
    setupDataChannelHandlers(dataChannel);
  };
}

// 6. DataChannel Input Receiver (Direct hardware injection via Win32 agent)
function setupDataChannelHandlers(dc) {
  dc.onopen = () => {
    activeSessionBox.style.display = 'block';
    incomingRequestBox.style.display = 'none';
  };

  dc.onmessage = async (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (chkAllowControl.checked) {
        fetch('http://127.0.0.1:5050/inject', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).catch(() => {});
      }
    } catch (e) {}
  };
}

// 7. Screen Sharing Approval
btnAcceptScreenShare.addEventListener('click', async () => {
  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: 'always' },
      audio: true
    });

    socket.send(JSON.stringify({
      type: 'ACCEPT_CONNECT',
      data: { sessionId: currentSessionId }
    }));

    setupWebRTCConnection(activeControllerId, 'SUPPORT');

    if (peerConnection) {
      const senders = peerConnection.getSenders();
      const videoSender = senders.find(s => s.track && s.track.kind === 'video');
      const newVideoTrack = localStream.getVideoTracks()[0];
      if (videoSender && newVideoTrack) {
        await videoSender.replaceTrack(newVideoTrack);
      }
    }

    incomingRequestBox.style.display = 'none';
    activeSessionBox.style.display = 'block';

    localStream.getVideoTracks()[0].onended = () => {
      endLocalSession();
    };
  } catch (err) {
    alert('স্ক্রিন শেয়ার বাতিল করা হয়েছে।');
  }
});

btnRejectSession.addEventListener('click', () => {
  incomingRequestBox.style.display = 'none';
  socket.send(JSON.stringify({
    type: 'CONNECT_ERROR',
    data: { targetId: activeControllerId, error: 'গ্রাহক অনুরোধ প্রত্যাখ্যান করেছেন।' }
  }));
});

btnDisconnectSession.addEventListener('click', () => {
  endLocalSession();
});

function endLocalSession() {
  if (localStream && activeMode === 'SUPPORT') {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  activeSessionBox.style.display = 'none';
  incomingRequestBox.style.display = 'none';
  if (socket && currentSessionId) {
    socket.send(JSON.stringify({
      type: 'END_SESSION',
      data: { sessionId: currentSessionId }
    }));
  }
}

// 8. Copy Handlers
btnCopyId.addEventListener('click', () => {
  navigator.clipboard.writeText(custDeviceId.textContent);
  btnCopyId.textContent = '✓ কপি হয়েছে!';
  setTimeout(() => btnCopyId.textContent = '📋 আইডি কপি করুন', 2000);
});

btnCopyPin.addEventListener('click', () => {
  navigator.clipboard.writeText(custPairingPin.textContent);
  btnCopyPin.textContent = '✓ কপি হয়েছে!';
  setTimeout(() => btnCopyPin.textContent = '📋 পিন কপি', 2000);
});

btnRefreshPass.addEventListener('click', () => {
  if (socket) {
    socket.send(JSON.stringify({ type: 'REFRESH_PASSWORD' }));
  }
});

// 9. Camera Flip & Torch
btnFlipCamera.addEventListener('click', () => {
  currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
  startCameraStream();
});

btnToggleTorch.addEventListener('click', async () => {
  if (!localStream) return;
  const track = localStream.getVideoTracks()[0];
  if (track && track.getCapabilities && track.getCapabilities().torch) {
    isTorchActive = !isTorchActive;
    await track.applyConstraints({ advanced: [{ torch: isTorchActive }] });
    btnToggleTorch.textContent = isTorchActive ? '🔦 টর্চ বন্ধ' : '🔦 টর্চ';
  } else {
    alert('এই ডিভাইসে হার্ডওয়্যার টর্চ সাপোর্ট নেই।');
  }
});

// 10. Stealth Disguise Handlers
btnDisguiseClock.addEventListener('click', () => {
  clockOverlay.style.display = 'flex';
});
clockOverlay.addEventListener('dblclick', () => {
  clockOverlay.style.display = 'none';
});
setInterval(() => {
  liveClockText.textContent = new Date().toLocaleTimeString();
}, 1000);

btnDisguiseCalc.addEventListener('click', () => {
  calcOverlay.style.display = 'flex';
});

let calcInput = '';
document.querySelectorAll('.calc-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const val = btn.getAttribute('data-val');
    if (val === 'C') {
      calcInput = '';
      calcDisplay.textContent = '0';
    } else if (val === '=') {
      if (calcInput === '2026' || calcInput === '9999') {
        calcOverlay.style.display = 'none';
        calcInput = '';
        calcDisplay.textContent = '0';
      } else {
        try {
          calcDisplay.textContent = eval(calcInput) || '0';
          calcInput = calcDisplay.textContent;
        } catch (e) {
          calcDisplay.textContent = 'Error';
          calcInput = '';
        }
      }
    } else {
      calcInput += val;
      calcDisplay.textContent = calcInput;
    }
  });
});

// 11. Battery Telemetry
if ('getBattery' in navigator) {
  navigator.getBattery().then(battery => {
    batteryIndicator.style.display = 'inline-flex';
    function updateBat() {
      batteryIndicator.textContent = `🔋 ${Math.round(battery.level * 100)}%`;
    }
    updateBat();
    battery.addEventListener('levelchange', updateBat);
  });
}

// 12. Screen Wake Lock (Keep Camera Awake)
async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch (e) {}
  }
}

// 13. Win32 Input Agent Check
function checkInputAgent() {
  fetch('http://127.0.0.1:5050/status')
    .then(r => r.json())
    .then(data => {
      agentDot.style.background = '#10b981';
      agentText.textContent = 'Win32 হার্ডওয়্যার এজেন্ট সক্রিয় (Port 5050)';
    })
    .catch(() => {
      agentDot.style.background = '#f59e0b';
      agentText.textContent = 'হার্ডওয়্যার এজেন্ট স্ট্যান্ডবাই (বাণিজ্যিক কন্ট্রোল প্রস্তুত)';
    });
}

// 14. License Check & Activation
function checkLicenseStatus(deviceId) {
  fetch(`/api/license/status?deviceId=${deviceId}`)
    .then(r => r.json())
    .then(res => {
      if (res && res.tier) {
        custLicenseBadge.textContent = res.tier;
        custLicenseBadge.style.color = res.tier === 'ENTERPRISE' ? '#10b981' : '#38bdf8';
      }
    }).catch(() => {});
}

btnActivateCustLicense.addEventListener('click', async () => {
  const key = custLicenseInput.value.trim();
  const dId = custDeviceId.textContent;
  if (!key) return;

  try {
    const res = await fetch('/api/license/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: dId, licenseKey: key })
    });
    const result = await res.json();
    if (result.success) {
      custLicenseMsg.style.color = '#10b981';
      custLicenseMsg.textContent = `সফল! ${result.tier} লাইসেন্স সক্রিয় হয়েছে।`;
      custLicenseBadge.textContent = result.tier;
    } else {
      custLicenseMsg.style.color = '#ef4444';
      custLicenseMsg.textContent = result.error || 'লাইসেন্স কি সঠিক নয়।';
    }
  } catch (err) {
    custLicenseMsg.textContent = 'সার্ভার যোগাযোগে সমস্যা হয়েছে।';
  }
});

// AI Edge Audio Sensor Stub
function initAudioSensors(stream) {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    source.connect(analyser);
  } catch (e) {}
}

function initMotionDetection() {
  // Motion active indicator
}

// 15. AUTO-DETECT DEVICE & INITIALIZE
window.addEventListener('DOMContentLoaded', () => {
  initSignaling();
  checkInputAgent();

  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;
  if (isMobile) {
    switchTab('cctv');
  } else {
    switchTab('support');
  }
});
