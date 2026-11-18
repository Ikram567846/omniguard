// OmniGuard Customer QuickSupport Client Script
let socket = null;
let peerConnection = null;
let dataChannel = null;
let localStream = null;
let standbyStream = null;
let currentSessionId = null;
let activeControllerId = null;
let pendingSessionMode = 'FULL_CONTROL';

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// UI Elements
const clientStatusBadge = document.getElementById('clientStatusBadge');
const clientStatusText = document.getElementById('clientStatusText');
const custDeviceId = document.getElementById('custDeviceId');
const custPairingPin = document.getElementById('custPairingPin');
const custPassword = document.getElementById('custPassword');
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

// Create lightweight Standby Canvas Stream (ensures instant WebRTC negotiation without blocking)
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
  const stream = canvas.captureStream(5);
  return stream;
}

function initSignaling() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${window.location.host}`);

  socket.onopen = () => {
    clientStatusBadge.classList.add('online');
    clientStatusText.textContent = 'সংযুক্ত (প্রস্তুত)';
    
    socket.send(JSON.stringify({
      type: 'REGISTER',
      data: { type: 'HOST', name: 'QuickSupport-Client' }
    }));
  };

  socket.onmessage = async (event) => {
    const msg = JSON.parse(event.data);

    switch (msg.type) {
      case 'REGISTERED':
        custDeviceId.textContent = msg.data.deviceId;
        if (custPairingPin) custPairingPin.textContent = msg.data.pairingPin;
        custPassword.value = msg.data.password;
        break;

      case 'INCOMING_CONNECTION':
        currentSessionId = msg.data.sessionId;
        activeControllerId = msg.data.controllerId;
        pendingSessionMode = msg.data.mode || 'FULL_CONTROL';

        // Show prompt to user
        if (incomingRequestBox) {
          incomingRequestBox.style.display = 'block';
          incomingAgentInfo.textContent = `টেকনিশিয়ান (${activeControllerId}) আপনার স্ক্রিন দেখতে অনুরোধ করেছেন।`;
        }
        break;

      case 'OFFER':
        await handleOffer(msg.data.fromId, msg.data.sdp);
        break;

      case 'ICE_CANDIDATE':
        if (peerConnection && msg.data.candidate) {
          try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(msg.data.candidate));
          } catch (e) {
            console.error('ICE candidate error:', e);
          }
        }
        break;

      case 'SESSION_ENDED':
        endSession();
        alert('টেকনিশিয়ান সেশন সমাপ্ত করেছেন।');
        break;
    }
  };

  socket.onclose = () => {
    clientStatusBadge.classList.remove('online');
    clientStatusText.textContent = 'বিচ্ছিন্ন (পুনঃসংযোগ হচ্ছে...)';
    setTimeout(initSignaling, 3000);
  };
}

async function handleOffer(controllerId, sdp) {
  try {
    activeControllerId = controllerId;
    peerConnection = new RTCPeerConnection(rtcConfig);

    // Attach standby stream immediately so WebRTC answer has video track and completes negotiation instantly
    standbyStream = createStandbyStream(`Connected to Technician (${controllerId})`);
    standbyStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, standbyStream);
    });

    peerConnection.ondatachannel = (event) => {
      dataChannel = event.channel;
      dataChannel.onmessage = (e) => {
        if (!chkAllowControl.checked) return;
        try {
          const payload = JSON.parse(e.data);
          // If local native injection helper is running
          fetch('http://localhost:5050/inject', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          }).catch(() => {});
        } catch (_) {}
      };
    };

    peerConnection.onicecandidate = (event) => {
      if (event.candidate && socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: 'ICE_CANDIDATE',
          data: { targetId: controllerId, candidate: event.candidate }
        }));
      }
    };

    await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.send(JSON.stringify({
      type: 'ANSWER',
      data: { targetId: controllerId, sdp: answer }
    }));

  } catch (err) {
    console.error('Failed to handle offer:', err);
  }
}

// User Action: Accept & Share Screen (Direct User Gesture)
if (btnAcceptScreenShare) {
  btnAcceptScreenShare.addEventListener('click', async () => {
    try {
      if (pendingSessionMode === 'CAMERA_SURVEILLANCE') {
        localStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true
        });
      } else {
        // Desktop Screen Capture
        try {
          localStream = await navigator.mediaDevices.getDisplayMedia({
            video: { cursor: 'always' },
            audio: true
          });
        } catch (screenErr) {
          console.warn('Screen capture cancelled or unavailable:', screenErr);
          localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
          });
        }
      }

      // Replace standby track with the live captured video track
      if (peerConnection && localStream && localStream.getVideoTracks().length > 0) {
        const liveVideoTrack = localStream.getVideoTracks()[0];
        const senders = peerConnection.getSenders();
        const videoSender = senders.find(s => s.track && s.track.kind === 'video');
        if (videoSender) {
          await videoSender.replaceTrack(liveVideoTrack);
        } else {
          peerConnection.addTrack(liveVideoTrack, localStream);
        }

        // When customer stops sharing via browser bar
        liveVideoTrack.onended = () => {
          endSession();
        };
      }

      // Update UI state
      if (incomingRequestBox) incomingRequestBox.style.display = 'none';
      if (activeSessionBox) {
        activeSessionBox.style.display = 'block';
        sessionAgentInfo.textContent = `🟢 রিমোট সেশন সক্রিয়: টেকনিশিয়ান (${activeControllerId}) আপনার সাথে যুক্ত আছেন।`;
      }
    } catch (err) {
      alert('স্ক্রিন শেয়ার অনুমোদন করা যায়নি: ' + err.message);
    }
  });
}

// Reject Session
if (btnRejectSession) {
  btnRejectSession.addEventListener('click', () => {
    if (incomingRequestBox) incomingRequestBox.style.display = 'none';
    endSession();
  });
}

function endSession() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  if (standbyStream) {
    standbyStream.getTracks().forEach(t => t.stop());
    standbyStream = null;
  }
  if (activeSessionBox) activeSessionBox.style.display = 'none';
  if (incomingRequestBox) incomingRequestBox.style.display = 'none';

  if (socket && socket.readyState === WebSocket.OPEN && currentSessionId) {
    socket.send(JSON.stringify({
      type: 'SESSION_ENDED',
      sessionId: currentSessionId
    }));
  }
}

// User Actions: Copy & Refresh
btnCopyId.addEventListener('click', () => {
  const id = custDeviceId.textContent.trim();
  if (id && id !== '--- --- ---') {
    navigator.clipboard.writeText(id);
    alert('আইডি কপি করা হয়েছে: ' + id);
  }
});

if (btnCopyPin) {
  btnCopyPin.addEventListener('click', () => {
    const pin = custPairingPin.textContent.trim();
    if (pin && pin !== '--- ---') {
      navigator.clipboard.writeText(pin);
      alert('পেয়ারিং পিন কপি করা হয়েছে: ' + pin);
    }
  });
}

btnRefreshPass.addEventListener('click', () => {
  const newPass = Math.floor(100000 + Math.random() * 900000).toString();
  custPassword.value = newPass;
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'UPDATE_PASSWORD',
      data: { password: newPass }
    }));
  }
});

btnDisconnectSession.addEventListener('click', () => {
  endSession();
});

window.addEventListener('DOMContentLoaded', initSignaling);
