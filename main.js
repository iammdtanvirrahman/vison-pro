const $ = (s) => document.querySelector(s);

const camera = $('#camera');
const canvas = $('#visionCanvas');
const ctx = canvas.getContext('2d');
const startBtn = $('#startBtn');
const status = $('#visionStatus');
const hint = $('#hint');
const toast = $('#toast');
const cursor = $('#spatialCursor');
const gestureState = $('#gestureState');

const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm';
const LIB_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/+esm';

let stream = null;
let vision = false;
let raf = 0;
let handLandmarker = null;
let lastVideoTime = -1;
let pinched = false;
let dragTarget = null;
let dragOffsetX = 0;
let dragOffsetY = 0;
let lastGestureAt = 0;
let modelLoading = false;
let modelFailed = false;

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(innerWidth * dpr);
  canvas.height = Math.floor(innerHeight * dpr);
  canvas.style.width = `${innerWidth}px`;
  canvas.style.height = `${innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

addEventListener('resize', resize);
resize();

function notify(text) {
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove('show'), 1700);
}

function clock() {
  $('#clock').textContent = new Intl.DateTimeFormat([], {
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date());
}
setInterval(clock, 1000);
clock();

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function getCursorPoint() {
  return {
    x: parseFloat(cursor.style.left) || innerWidth / 2,
    y: parseFloat(cursor.style.top) || innerHeight / 2
  };
}

function getTargetAt(x, y) {
  return document.elementFromPoint(x, y)?.closest('.spatial-window:not(.closed), .dock-item, #startBtn');
}

function setStatus(text, helper = hint.textContent) {
  status.textContent = text;
  if (helper) hint.textContent = helper;
}

async function loadHands() {
  if (handLandmarker || modelLoading) return !!handLandmarker;
  modelLoading = true;
  modelFailed = false;
  setStatus('LOADING HAND MODEL', 'Preparing spatial hand control…');

  try {
    const { HandLandmarker, FilesetResolver } = await import(LIB_URL);
    const fileset = await FilesetResolver.forVisionTasks(WASM_URL);

    const create = (delegate) => HandLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate
      },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    try {
      handLandmarker = await create('GPU');
    } catch (gpuError) {
      console.warn('GPU hand tracking failed, retrying with CPU.', gpuError);
      handLandmarker = await create('CPU');
    }

    setStatus('HAND CONTROL READY', 'Point with your index finger • pinch to grab');
    gestureState.textContent = 'READY';
    notify('Hand control ready');
    return true;
  } catch (error) {
    console.error('Hand tracking initialization failed:', error);
    handLandmarker = null;
    modelFailed = true;
    setStatus('HAND MODEL ERROR', 'Camera works, but the hand model could not load.');
    gestureState.textContent = 'MODEL ERROR';
    notify('Hand model failed — pointer fallback active');
    return false;
  } finally {
    modelLoading = false;
  }
}

async function startVision() {
  if (vision) return;

  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus('CAMERA UNSUPPORTED', 'Use HTTPS or localhost in a modern browser.');
    notify('Camera API unavailable');
    return;
  }

  startBtn.disabled = true;
  startBtn.textContent = 'STARTING…';

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 }
      },
      audio: false
    });

    camera.srcObject = stream;
    await camera.play();

    vision = true;
    document.body.classList.add('vision-on');
    cursor.style.opacity = '1';
    startBtn.textContent = 'VISION ACTIVE';
    setStatus('CAMERA ONLINE', 'Loading hand control…');
    notify('Camera online');

    draw();

    // Wait for the camera pipeline to be alive, then initialize tracking.
    await loadHands();
  } catch (error) {
    console.error('Camera start failed:', error);
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    vision = false;
    document.body.classList.remove('vision-on');
    cursor.style.opacity = '0';
    startBtn.disabled = false;
    startBtn.textContent = 'START VISION';

    if (error?.name === 'NotAllowedError') {
      setStatus('CAMERA BLOCKED', 'Allow camera permission, then press START VISION again.');
      notify('Camera permission required');
    } else {
      setStatus('CAMERA ERROR', 'Unable to start the camera.');
      notify('Camera could not start');
    }
  }
}

function moveCursor(x, y) {
  x = Math.max(12, Math.min(innerWidth - 12, x));
  y = Math.max(12, Math.min(innerHeight - 12, y));

  cursor.style.left = `${x}px`;
  cursor.style.top = `${y}px`;

  const target = getTargetAt(x, y);
  document.querySelectorAll('.spatial-window').forEach((window) => {
    window.classList.toggle('hovered', window === target);
  });

  if (dragTarget) {
    dragTarget.style.setProperty('--x', `${x - dragOffsetX}px`);
    dragTarget.style.setProperty('--y', `${y - dragOffsetY}px`);
    gestureState.textContent = 'GRABBING';
  } else {
    gestureState.textContent = target ? (pinched ? 'PINCH' : 'TARGET') : 'TRACKING';
  }
}

function activateTarget(target) {
  if (!target) return;

  const window = target.closest('.spatial-window');
  if (window) {
    window.classList.add('selected');
    notify(`${(window.dataset.window || 'window').toUpperCase()} selected`);
    return;
  }

  if (target.matches('.dock-item')) {
    document.querySelectorAll('.dock-item').forEach((item) => item.classList.remove('active'));
    target.classList.add('active');
    notify(`${target.dataset.app.toUpperCase()} selected`);
    return;
  }

  if (target.matches('#startBtn')) startVision();
}

function setPinch(value) {
  if (value === pinched) return;
  pinched = value;
  cursor.classList.toggle('pinch', pinched);

  const now = performance.now();
  const { x, y } = getCursorPoint();
  const target = getTargetAt(x, y);

  if (pinched) {
    if (now - lastGestureAt < 120) return;
    lastGestureAt = now;

    const window = target?.closest('.spatial-window:not(.closed)');
    if (window) {
      dragTarget = window;
      const rect = window.getBoundingClientRect();
      dragOffsetX = x - rect.left;
      dragOffsetY = y - rect.top;
      window.classList.add('selected');
      gestureState.textContent = 'GRABBING';
      notify('Grab');
    } else {
      activateTarget(target);
    }
  } else if (dragTarget) {
    dragTarget.classList.remove('selected');
    dragTarget = null;
    gestureState.textContent = 'RELEASED';
    notify('Released');
  }
}

function processHand(result) {
  if (!result?.landmarks?.length) {
    gestureState.textContent = modelFailed ? 'FALLBACK' : 'NO HAND';
    return;
  }

  const lm = result.landmarks[0];
  const index = lm[8];
  const thumb = lm[4];
  const wrist = lm[0];
  const palm = lm[9];
  const scale = Math.max(distance(wrist, palm), 0.04);

  // The camera is mirrored in CSS, so reverse X for the UI coordinate system.
  const x = (1 - index.x) * innerWidth;
  const y = index.y * innerHeight;
  moveCursor(x, y);

  const pinchDistance = distance(index, thumb);
  const pinchThreshold = Math.max(0.035, scale * 0.60);
  setPinch(pinchDistance < pinchThreshold);
}

function draw() {
  if (!vision) return;

  ctx.clearRect(0, 0, innerWidth, innerHeight);

  if (handLandmarker && camera.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && camera.currentTime !== lastVideoTime) {
    lastVideoTime = camera.currentTime;
    try {
      const result = handLandmarker.detectForVideo(camera, performance.now());
      processHand(result);
    } catch (error) {
      console.warn('Hand frame failed:', error);
      gestureState.textContent = 'TRACKING ERROR';
    }
  }

  const t = performance.now() / 1000;
  const r = 70 + Math.sin(t * 2) * 5;
  ctx.beginPath();
  ctx.arc(innerWidth / 2, innerHeight / 2, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,.10)';
  ctx.stroke();

  raf = requestAnimationFrame(draw);
}

// Mouse fallback keeps the UI usable while the camera/model is unavailable.
addEventListener('pointermove', (event) => {
  if (!vision || handLandmarker) return;
  moveCursor(event.clientX, event.clientY);
});

addEventListener('pointerdown', (event) => {
  if (!vision || handLandmarker) return;
  moveCursor(event.clientX, event.clientY);
  setPinch(true);
});

addEventListener('pointerup', () => {
  if (!vision || handLandmarker) return;
  setPinch(false);
});

startBtn.addEventListener('click', startVision);

$('.dock').addEventListener('click', (event) => {
  const button = event.target.closest('.dock-item');
  if (!button) return;
  document.querySelectorAll('.dock-item').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  notify(`${button.dataset.app.toUpperCase()} selected`);
});

document.querySelectorAll('.close-window').forEach((button) => {
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    button.closest('.spatial-window').classList.add('closed');
    notify('Window closed');
  });
});

addEventListener('beforeunload', () => {
  cancelAnimationFrame(raf);
  stream?.getTracks().forEach((track) => track.stop());
  handLandmarker?.close?.();
});
