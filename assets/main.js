const API_URL='http://localhost:8010';
const loginEl=document.getElementById('login');
const sessionEl=document.getElementById('session');
const loginForm=document.getElementById('loginForm');
const loginBtn=document.getElementById('loginBtn');
const loginUser=document.getElementById('loginUser');
const loginPass=document.getElementById('loginPass');
const startBtn=document.getElementById('startBtn');
const controls=document.getElementById('controls');
const recordBtn=document.getElementById('recordBtn');
const finishBtn=document.getElementById('finishBtn');
const recordingsList=document.getElementById('recordings');
let token=null,sessionId=null,recorder=null,chunks=[],audioCount=0,isRecording=false,holdTimer=null;
loginForm.onsubmit=e=>{e.preventDefault();
    if(!loginUser.value.trim()||!loginPass.value.trim())return;
    loginBtn.disabled=true;
    fetch(`${API_URL}/api/v1/auth/login`,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({username:loginUser.value,password:loginPass.value})
    }).then(r=>{loginBtn.disabled=false;return r.ok?r.json():Promise.reject();})
    .then(data=>{
        token=data.token;
        loginEl.classList.add('hidden');
        sessionEl.classList.remove('hidden');
        document.body.classList.add('logged-in');
    }).catch(()=>alert('Ошибка авторизации'));
};
startBtn.onclick=()=>{
    fetch(`${API_URL}/api/v1/appointments/create`,{
        method:'POST',
        headers:{'Authorization':`Bearer ${token}`}
    }).then(r=>r.ok?r.json():Promise.reject())
    .then(data=>{
        sessionId=data.appointment_id||data.id||crypto.randomUUID();
        startBtn.classList.add('hidden');
        controls.classList.remove('hidden');
        audioCount=0;
        recordingsList.innerHTML='';
    }).catch(()=>alert('Ошибка создания приема'));
};
function startRecording(){
    navigator.mediaDevices.getUserMedia({audio:true}).then(stream=>{
        recorder=new MediaRecorder(stream);
        recorder.ondataavailable=e=>{chunks.push(e.data);};
        recorder.onstop=()=>{
            const blob=new Blob(chunks,{type:'audio/webm'});
            chunks=[];
            addRecording(blob);
        };
        recorder.start();
        isRecording=true;
        recordBtn.textContent='Стоп';
    }).catch(()=>alert('Нет доступа к микрофону'));
}
function stopRecording(){
    if(recorder){
        recorder.stop();
        isRecording=false;
        recordBtn.textContent='Запись';
    }
}
function addRecording(blob){
    const id=++audioCount;
    const li=document.createElement('li');
    const meta=document.createElement('div');
    meta.className='meta';
    meta.textContent=`${id}. ${new Date().toLocaleTimeString()}`;
    const audio=document.createElement('audio');
    audio.controls=true;
    audio.src=URL.createObjectURL(blob);
    const status=document.createElement('span');
    status.className='status';
    status.textContent='отправка...';
    li.appendChild(meta);
    li.appendChild(audio);
    li.appendChild(status);
    recordingsList.prepend(li);
    sendAudio(id,blob,status);
}
function sendAudio(id,blob,statusEl){
    const fd=new FormData();
    fd.append('number',id);
    fd.append('appointment_id',sessionId);
    fd.append('file',blob,`audio_${id}.webm`);
    fetch(`${API_URL}/api/v1/audio/upload`,{method:'POST',headers:{'Authorization':`Bearer ${token}`},body:fd})
        .then(r=>r.ok?r.json():Promise.reject())
        .then(()=>{statusEl.textContent='отправлено';})
        .catch(()=>{statusEl.textContent='ошибка';});
}
finishBtn.onclick=()=>{
    controls.classList.add('hidden');
    startBtn.classList.remove('hidden');
    recordingsList.innerHTML='';
    alert('Прием завершен');
};
recordBtn.addEventListener('pointerdown',e=>{
    recordBtn.setPointerCapture(e.pointerId);
    holdTimer=setTimeout(()=>{startRecording();recordBtn.dataset.mode='hold';},200);
});
recordBtn.addEventListener('pointerup',e=>{
    clearTimeout(holdTimer);
    recordBtn.releasePointerCapture(e.pointerId);
    if(recordBtn.dataset.mode==='hold'){
        if(isRecording)stopRecording();
        recordBtn.dataset.mode='';
    }else{
        if(!isRecording)startRecording();
        else stopRecording();
    }
});
if('serviceWorker' in navigator && location.protocol.startsWith('http')){
    navigator.serviceWorker.register('./sw.js');
}
