const $=s=>document.querySelector(s);
const camera=$('#camera'),canvas=$('#visionCanvas'),ctx=canvas.getContext('2d');
const startBtn=$('#startBtn'),status=$('#visionStatus'),hint=$('#hint'),toast=$('#toast');
let stream=null,vision=false,raf=0;

function resize(){canvas.width=innerWidth*devicePixelRatio;canvas.height=innerHeight*devicePixelRatio;ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0)}
addEventListener('resize',resize);resize();

function notify(text){toast.textContent=text;toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),1800)}
function clock(){ $('#clock').textContent=new Intl.DateTimeFormat([], {hour:'2-digit',minute:'2-digit'}).format(new Date()) }
setInterval(clock,1000);clock();

async function startVision(){
  if(vision)return;
  try{
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:1280},height:{ideal:720}},audio:false});
    camera.srcObject=stream;await camera.play();vision=true;
    document.body.classList.add('vision-on');status.textContent='VISION ACTIVE';hint.textContent='Camera online · spatial layer ready';startBtn.textContent='VISION ACTIVE';
    notify('Vision system online');draw();
  }catch(error){
    status.textContent='CAMERA BLOCKED';hint.textContent='Allow camera access, then try again.';notify('Camera permission required');
  }
}

function draw(){
  if(!vision)return;
  ctx.clearRect(0,0,innerWidth,innerHeight);
  const t=performance.now()/1000,cx=innerWidth/2,cy=innerHeight/2;
  const r=70+Math.sin(t*2)*5;
  ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.strokeStyle='rgba(255,255,255,.12)';ctx.lineWidth=1;ctx.stroke();
  for(let i=0;i<3;i++){const a=t*(.35+i*.08)+i*2.1;const x=cx+Math.cos(a)*r,y=cy+Math.sin(a)*r;ctx.beginPath();ctx.arc(x,y,2.5,0,Math.PI*2);ctx.fillStyle='rgba(255,255,255,.7)';ctx.fill()}
  raf=requestAnimationFrame(draw);
}

startBtn.addEventListener('click',startVision);
$('.dock').addEventListener('click',e=>{const button=e.target.closest('.dock-item');if(!button)return;document.querySelectorAll('.dock-item').forEach(x=>x.classList.remove('active'));button.classList.add('active');notify(`${button.dataset.app[0].toUpperCase()+button.dataset.app.slice(1)} layer selected`)})

addEventListener('beforeunload',()=>{cancelAnimationFrame(raf);stream?.getTracks().forEach(t=>t.stop())});
