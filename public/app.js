// ======= util =======
const logEl = document.getElementById('log');
const statusEl = document.getElementById('status');
const presenceEl = document.getElementById('presence');
const orb = document.getElementById('orb');

let pc, dc;
let localStream, micTrack, remoteAudioEl;
let started = false;

const log = (txt) => {
  console.log('[unibot]', txt);
  logEl.textContent = (txt + '\n' + logEl.textContent).slice(0, 8000);
};

const setStatus = (s) => (statusEl.textContent = s);
const setPresence = (s) => (presenceEl.textContent = s);

// ======= media =======
async function initMedia() {
  // cerem A/V – dacă video sau audio pică, continuăm cu ce avem
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false // nu afișăm camera; o folosim doar dacă faci detector față
    });
  } catch (e) {
    // fallback: doar audio, în caz că video blochează permisiunea
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      log('Eroare media: ' + err.message);
      throw new Error('Media stream has no audio tracks');
    }
  }

  micTrack = localStream.getAudioTracks()[0];
  if (!micTrack) throw new Error('Media stream has no audio tracks');
}

// ======= token efemer =======
async function getEphemeralToken() {
  const r = await fetch('/session');
  if (!r.ok) throw new Error('Nu pot obține /session');
  const j = await r.json();
  if (!j?.client_secret?.value) throw new Error('no ephemeral token');
  return j.client_secret.value;
}

// ======= orb mic vizual (pulse în timpul vorbirii locale) =======
function pulseOrb(active) {
  if (active) orb.classList.add('talking');
  else orb.classList.remove('talking');
}

// ======= conexiune Realtime (HTTP/SDP) =======
async function connectRealtime() {
  setStatus('starting');
  log('Pornire sesiune…');

  // PeerConnection + transceiver audio bidirecțional
  pc = new RTCPeerConnection({
    // STUN public pt demo
    iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }]
  });

  // track de “audio remote”
  pc.ontrack = (e) => {
    const track = e.streams[0]?.getAudioTracks?.()[0];
    if (!remoteAudioEl) remoteAudioEl = new Audio();
    remoteAudioEl.srcObject = e.streams[0];
    remoteAudioEl.play().catch(() => {});
  };

  pc.onconnectionstatechange = () => {
    log('pc state: ' + pc.connectionState);
    if (pc.connectionState === 'connected') setStatus('ready');
    if (pc.connectionState === 'failed') setStatus('error');
  };

  // transceiver pentru microfon + înlocuim cu track-ul real
  const tx = pc.addTransceiver('audio', { direction: 'sendrecv' });
  await initMedia();
  await tx.sender.replaceTrack(micTrack);

  // date channel pt comenzi (greeting init etc.)
  dc = pc.createDataChannel('oai-events');
  dc.onopen = () => {
    log('datachannel open');
    // trimitem greeting către model (pe vocea Alloy, nu TTS local)
    // asta pornește instant răspunsul audio al modelului
    try {
      dc.send(JSON.stringify({
        type: 'response.create',
        response: {
          modalities: ['audio'],
          instructions: 'Salut! Sunt Unibot, asistentul clinicii Imperial Dent. Cu ce vă pot ajuta? Aveți un control programat sau este o urgență?'
        }
      }));
    } catch (e) {
      log('Greeting send error: ' + (e.message || e));
    }
  };

  // mic “VU meter” simplu
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const src = audioCtx.createMediaStreamSource(localStream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  const data = new Uint8Array(analyser.frequencyBinCount);
  src.connect(analyser);

  const loop = () => {
    analyser.getByteTimeDomainData(data);
    // dacă amplitudinea variază, considerăm că vorbești ~pulse
    let active = false;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      if (Math.abs(v) > 0.07) { active = true; break; }
    }
    pulseOrb(active);
    requestAnimationFrame(loop);
  };
  loop();

  // SDP: offer -> POST la Realtime -> answer
  const offer = await pc.createOffer({ offerToReceiveAudio: true });
  await pc.setLocalDescription(offer);

  const token = await getEphemeralToken();
  const base = 'https://api.openai.com/v1/realtime';
  const model = 'gpt-4o-realtime-preview';

  const resp = await fetch(`${base}?model=${encodeURIComponent(model)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/sdp'
    },
    body: offer.sdp
  });

  const answerSDP = await resp.text();
  await pc.setRemoteDescription({ type: 'answer', sdp: answerSDP });

  setStatus('ready');
  log('Conectat.');
}

// ======= UI =======
document.getElementById('start').addEventListener('click', async () => {
  if (started) return;
  started = true;
  try {
    await connectRealtime();
  } catch (e) {
    started = false;
    log('Eroare la start: ' + (e.message || e));
    setStatus('error');
  }
});

document.getElementById('fs').addEventListener('click', () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen();
  else document.exitFullscreen();
});

document.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'f') {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
  }
});
