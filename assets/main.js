const API_URL = 'http://localhost:8010';

document.addEventListener('DOMContentLoaded', () => {
  const loginEl = document.getElementById('login');
  const appEl = document.getElementById('app');
  const loginForm = document.getElementById('loginForm');
  const loginBtn = document.getElementById('loginBtn');
  const loginUser = document.getElementById('loginUser');
  const loginPass = document.getElementById('loginPass');
  const usernameEl = document.getElementById('username');
  const logoutBtn = document.getElementById('logoutBtn');
  const createBtn = document.getElementById('createBtn');
  const appointmentsEl = document.getElementById('appointments');
  const appointmentEl = document.getElementById('appointment');
  const appointmentTitle = document.getElementById('appointmentTitle');
  const backBtn = document.getElementById('backBtn');
  const finishBtn = document.getElementById('finishBtn');
  const controls = document.getElementById('controls');
  const recordBtn = document.getElementById('recordBtn');
  const recordingsList = document.getElementById('recordings');

let token = null;
let currentUser = null;
let currentAppointment = null;
let currentStatus = 'pending';
let recorder = null;
let chunks = [];
let audioCount = 0;
let isRecording = false;
let holdTimer = null;

loginForm.onsubmit = async (e) => {
  e.preventDefault();
  if (!loginUser.value.trim() || !loginPass.value.trim()) return;
  loginBtn.disabled = true;
  try {
    const r = await fetch(`${API_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: loginUser.value, password: loginPass.value })
    });
    loginBtn.disabled = false;
    if (!r.ok) throw new Error();
    const d = await r.json();
    token = d.token;
    currentUser = d.user_id;
    usernameEl.textContent = currentUser;
    loginEl.classList.add('hidden');
    appEl.classList.remove('hidden');
    document.body.classList.add('logged-in');
    fetchAppointments();
  } catch (e) {
    alert('Ошибка авторизации');
  }
};

logoutBtn.onclick = () => {
  token = null;
  currentUser = null;
  loginEl.classList.remove('hidden');
  appEl.classList.add('hidden');
  document.body.classList.remove('logged-in');
};

async function fetchAppointments() {
  appointmentsEl.innerHTML = '';
  try {
    const r = await fetch(`${API_URL}/api/v1/appointments/list`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!r.ok) return;
    const d = await r.json();
    d.appointments.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    d.appointments.forEach(ap => {
      const btn = document.createElement('button');
      btn.className = 'secondary';
      btn.textContent = `${new Date(ap.created_at).toLocaleString()} - ${ap.status}`;
      btn.onclick = () => openAppointment(ap.appointment_id, ap.status);
      appointmentsEl.appendChild(btn);
    });
  } catch (e) {}
}

createBtn.onclick = async () => {
  try {
    const r = await fetch(`${API_URL}/api/v1/appointments/create`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!r.ok) throw new Error();
    const d = await r.json();
    openAppointment(d.appointment_id, 'pending');
  } catch (e) {
    alert('Ошибка создания приема');
  }
};

backBtn.onclick = () => {
  appointmentEl.classList.add('hidden');
  appointmentsEl.classList.remove('hidden');
  fetchAppointments();
};

async function openAppointment(id, status) {
  currentAppointment = id;
  currentStatus = status;
  appointmentTitle.textContent = `Прием ${id.slice(0, 8)}`;
  appointmentsEl.classList.add('hidden');
  appointmentEl.classList.remove('hidden');
  finishBtn.classList.toggle('hidden', status === 'finished');
  controls.classList.toggle('hidden', status === 'finished');
  loadRecordings();
}

finishBtn.onclick = async () => {
  try {
    const fd = new FormData();
    fd.append('appointment_id', currentAppointment);
    const r = await fetch(`${API_URL}/api/v1/appointments/finish`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: fd
    });
    if (!r.ok) throw new Error();
    finishBtn.classList.add('hidden');
    controls.classList.add('hidden');
    fetchAppointments();
  } catch (e) {
    alert('Ошибка завершения');
  }
};

function startRecording() {
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = e => { chunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'audio/webm' });
      chunks = [];
      uploadRecording(blob);
    };
    recorder.start();
    isRecording = true;
    recordBtn.textContent = 'Стоп';
  }).catch(() => alert('Нет доступа к микрофону'));
}

function stopRecording() {
  if (recorder) {
    recorder.stop();
    isRecording = false;
    recordBtn.textContent = 'Запись';
  }
}

recordBtn.addEventListener('pointerdown', e => {
  recordBtn.setPointerCapture(e.pointerId);
  holdTimer = setTimeout(() => { startRecording(); recordBtn.dataset.mode = 'hold'; }, 200);
});
recordBtn.addEventListener('pointerup', e => {
  clearTimeout(holdTimer);
  recordBtn.releasePointerCapture(e.pointerId);
  if (recordBtn.dataset.mode === 'hold') {
    if (isRecording) stopRecording();
    recordBtn.dataset.mode = '';
  } else {
    if (!isRecording) startRecording(); else stopRecording();
  }
});

function uploadRecording(blob) {
  const fd = new FormData();
  fd.append('number', audioCount + 1);
  fd.append('appointment_id', currentAppointment);
  fd.append('file', blob, `audio_${Date.now()}.webm`);
  const status = document.createElement('span');
  status.className = 'status';
  status.textContent = 'отправка...';
  recordingsList.prepend(status);
  fetch(`${API_URL}/api/v1/appointments/audio/upload`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: fd
  }).then(r => r.ok ? r.json() : Promise.reject()).then(() => {
    status.remove();
    loadRecordings();
  }).catch(() => { status.textContent = 'ошибка'; });
}

async function loadRecordings() {
  recordingsList.innerHTML = '';
  audioCount = 0;
  try {
    const r = await fetch(`${API_URL}/api/v1/appointments/audio/list?appointment_id=${currentAppointment}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!r.ok) return;
    const d = await r.json();
    d.audio_files.forEach(f => { audioCount++; addExisting(f); });
  } catch (e) {}
}

function addExisting(f) {
  const li = document.createElement('li');
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `${f.audio_id}. ${new Date(f.created_at).toLocaleTimeString()}`;
  const txt = document.createElement('button');
  txt.className = 'text-btn';
  txt.textContent = '📝';
  txt.onclick = () => alert(f.transcript || '');
  meta.appendChild(txt);
  li.appendChild(meta);
  const audio = document.createElement('audio');
  audio.controls = true;
  audio.src = `${API_URL}/api/v1/appointments/audio/get?appointment_id=${currentAppointment}&audio_id=${f.audio_id}`;
  li.appendChild(audio);
  if (currentStatus !== 'finished') {
    const del = document.createElement('button');
    del.className = 'text-btn';
    del.textContent = '✖';
    del.onclick = () => deleteAudio(f.audio_id, li);
    li.appendChild(del);
  }
  recordingsList.appendChild(li);
}

async function deleteAudio(id, el) {
  try {
    const r = await fetch(`${API_URL}/api/v1/appointments/audio/delete?appointment_id=${currentAppointment}&audio_id=${id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (r.ok) el.remove();
  } catch (e) {}
}

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js');
}

});
