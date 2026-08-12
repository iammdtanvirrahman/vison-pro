const $=s=>document.querySelector(s);
const camera=$('#camera'),canvas=$('#visionCanvas'),ctx=canvas.getContext('2d',{alpha:true});
const startBtn=$('#startBtn'),status=$('#visionStatus'),hint=$('#hint'),toast=$('#toast');
let stream=null,vision=false,raf=0,handLandmarker=null,handReady=false,lastVideoTime=-1;
let pointer={x:innerWidth/2,y:innerHeight/2,active:false,pinch:false};

function resize(){const d=Math.min(devicePixelRatio||1,2);canvas.width=innerWidth*d;canvas.height=innerHeight*d;ctx.setTransform(d,0,0,d,0,0)}
addEventListener('resize',resize);resize();
function notify(text){toast.textContent=text;toast.classList.add('show');clearTimeout(notify.t);notify.t=setTimeout(()=>toast.classList.remove('show'),1800)}
function clock(){$('#clock').textContent=new Intl.DateTimeFormat([], {hour:'2-digit',minute:'2-digit'}).format(new Date())}
setInterval(clock,1000);clock();

async function loadHandTracking(){
  if(handReady||!vision)return;
  try{
    const visionLib=await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/+esm');
    const {HandLandmarker,FilesetResolver}=visionLib;
    const fileset=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm');
    handLandmarker=await HandLandmarker.createFromOptions(fileset,{baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',delegate:'GPU'},runningMode:'VIDEO',numHands:1,minHandDetectionConfidence:.55,minHandPresenceConfidence:.55,minTrackingConfidence:.55});
    handReady=true;status.textContent='GESTURE READY';hint.textContent='Pinch to select · move your hand to control';notify('Hand tracking ready');
  }catch(e){status.textContent='VISION ACTIVE';hint.textContent='Camera online · gesture module unavailable';notify('Gesture model unavailable — camera mode active')}
}

async function startVision(){
  if(vision)return;
  if(!navigator.mediaDevices?.getUserMedia){notify('Camera API unavailable');return}
  try{
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:1280},height:{ideal:720}},audio:false});
    camera.srcObject=stream;await camera.play();vision=true;document.body.classList.add('vision-on');
    status.textContent='VISION ACTIVE';hint.textContent='Loading spatial vision…';startBtn.textContent='VISION ACTIVE';notify('Vision system online');
    loadHandTracking();draw();
  }catch(error){status.textContent='CAMERA BLOCKED';hint.textContent='Allow camera access, then try again.';notify('Camera permission required')}
}

function pinch(a,b){const dx=a.x-b.x,dy=a.y-b.y;return Math.hypot(dx,dy)<.065}
function processHands(result){
  const hand=result?.landmarks?.[0];
  if(!hand){pointer.active=false;pointer.pinch=false;return}
  const index=hand[8],thumb=hand[4];
  pointer.active=true;pointer.x=(1-index.x)*innerWidth;pointer.y=index.y*innerHeight;pointer.pinch=pinch(index,thumb);
}
function drawPointer(){
  if(!pointer.active)return;
  const {x,y}=pointer;
  ctx.beginPath();ctx.arc(x,y,pointer.pinch?20:13,0,Math.PI*2);ctx.strokeStyle=pointer.pinch?'rgba(255,255,255,.9)':'rgba(255,255,255,.45)';ctx.lineWidth=2;ctx.stroke();
  ctx.beginPath();ctx.arc(x,y,pointer.pinch?4:2.5,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();
}
function draw(){
  if(!vision)return;
  ctx.clearRect(0,0,innerWidth,innerHeight);
  const t=performance.now()/1000,cx=innerWidth/2,cy=innerHeight/2,r=70+Math.sin(t*2)*5;
  ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.strokeStyle='rgba(255,255,255,.12)';ctx.lineWidth=1;ctx.stroke();
  for(let i=0;i<3;i++){const a=t*(.35+i*.08)+i*2.1,x=cx+Math.cos(a)*r,y=cy+Math.sin(a)*r;ctx.beginPath();ctx.arc(x,y,2.5,0,Math.PI*2);ctx.fillStyle='rgba(255,255,255,.7)';ctx.fill()}
  if(handLandmarker&&camera.readyState>=2&&camera.currentTime!==lastVideoTime){lastVideoTime=camera.currentTime;processHands(handLandmarker.detectForVideo(camera,performance.now()))}
  drawPointer();raf=requestAnimationFrame(draw)
}

startBtn.addEventListener('click',startVision);
$('.dock').addEventListener('click',e=>{const button=e.target.closest('.dock-item');if(!button)return;document.querySelectorAll('.dock-item').forEach(x=>x.classList.remove('active'));button.classList.add('active');notify(`${button.dataset.app[0].toUpperCase()+button.dataset.app.slice(1)} layer selected`)})
addEventListener('beforeunload',()=>{cancelAnimationFrame(raf);stream?.getTracks().forEach(t=>t.stop())});
