const API_URL = 'https://cdemo.fatdog.pro';

function getSupportedMimeType() {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/aac',
    'audio/mpeg'
  ];
  return types.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

function getExtension(mimeType) {
  switch (mimeType) {
    case 'audio/webm;codecs=opus':
    case 'audio/webm':
      return 'webm';
    case 'audio/mp4':
      return 'mp4';
    case 'audio/aac':
      return 'aac';
    case 'audio/mpeg':
      return 'mp3';
    default:
      return 'webm';
  }
}

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
  const backBtn = document.getElementById('backBtn');
  const finishBtn = document.getElementById('finishBtn');
  const controls = document.getElementById('controls');
  const recordBtn = document.getElementById('recordBtn');
  const recordingsList = document.getElementById('recordings');
  const reportBtn = document.getElementById('reportBtn');
  const loaderEl = document.getElementById('loader');
  const reportDialog = document.getElementById('reportDialog');
  const reportMainBtn = document.getElementById('reportMainBtn');
  const reportAnamnesisBtn = document.getElementById('reportAnamnesisBtn');

  function translateStatus(status) {
    switch (status) {
      case 'pending':
      case 'active':
        return 'активен';
      case 'finished':
        return 'завершен';
      default:
        return status;
    }
  }

let token = localStorage.getItem('token');
let currentUser = localStorage.getItem('user');
let currentAppointment = null;
let currentStatus = 'pending';
let recorder = null;
let chunks = [];
let audioCount = 0;
let isRecording = false;
let holdTimer = null;
const retryQueue = [];
let audioPollInterval = null;
let lastAudioSnapshot = null;


function showApp() {
  loginEl.classList.add('hidden');
  appEl.classList.remove('hidden');
  document.body.classList.add('logged-in');
}

function showLogin() {
  loginEl.classList.remove('hidden');
  appEl.classList.add('hidden');
  document.body.classList.remove('logged-in');
}

function showLoader() {
  loaderEl.classList.remove('hidden');
}

function hideLoader() {
  loaderEl.classList.add('hidden');
}

function showReportDialog() {
  reportDialog.classList.remove('hidden');
}

function hideReportDialog() {
  reportDialog.classList.add('hidden');
}

async function requestReport(type) {
  hideReportDialog();
  showLoader();
  try {
    const r = await apiFetch(`${API_URL}/api/v1/appointments/report?appointment_id=${currentAppointment}&report_type=${type}`);
    if (!r.ok) throw new Error();
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report_${currentAppointment}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('Ошибка получения отчета');
  } finally {
    hideLoader();
  }
}

async function apiFetch(url, options = {}) {
  options.headers = options.headers || {};
  if (token) options.headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(url, options);
  if (response.status === 401) {
    token = null;
    currentUser = null;
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    showLogin();
    location.reload();
    throw new Error('unauthorized');
  }
  return response;
}

async function validateToken() {
  try {
    const r = await fetch(`${API_URL}/api/v1/appointments/list`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return r.ok;
  } catch (e) {
    return false;
  }
}

if (token) {
  showLoader();
  validateToken().then(valid => {
    hideLoader();
    if (valid) {
      usernameEl.textContent = currentUser || '';
      showApp();
      fetchAppointments();
    } else {
      token = null;
      currentUser = null;
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      showLogin();
    }
  });
}

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
    localStorage.setItem('token', token);
    localStorage.setItem('user', currentUser);
    usernameEl.textContent = currentUser;
    showApp();
    fetchAppointments();
    const queue = [...retryQueue];
    retryQueue.length = 0;
    queue.forEach(fn => fn());
    location.reload();
  } catch (e) {
    alert('Ошибка авторизации');
  }
};

logoutBtn.onclick = () => {
  stopAudioPolling();
  token = null;
  currentUser = null;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  showLogin();
  location.reload();
};

async function fetchAppointments() {
  appointmentsEl.innerHTML = '';
  try {
    const r = await apiFetch(`${API_URL}/api/v1/appointments/list`);
    if (!r.ok) return;
    const d = await r.json();
    d.appointments.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const total = d.appointments.length;
    d.appointments.forEach((ap, idx) => {
      const number = total - idx;
      const btn = document.createElement('button');
      btn.className = 'secondary';
      btn.textContent = `Прием ${number}: ${new Date(ap.created_at).toLocaleString()} - ${translateStatus(ap.status)}`;
      btn.onclick = () => openAppointment(ap.appointment_id, ap.status, number);
      appointmentsEl.appendChild(btn);
    });
  } catch (e) {
    if (e.message === 'unauthorized') retryQueue.push(fetchAppointments);
  }
}

createBtn.onclick = async function createAppointment() {
  try {
    const r = await apiFetch(`${API_URL}/api/v1/appointments/create`, {
      method: 'POST'
    });
    if (!r.ok) throw new Error();
    const d = await r.json();
    openAppointment(d.appointment_id, 'pending');
  } catch (e) {
    if (e.message === 'unauthorized') retryQueue.push(createAppointment);
    else alert('Ошибка создания приема');
  }
};

backBtn.onclick = () => {
  stopAudioPolling();
  appointmentEl.classList.add('hidden');
  appointmentsEl.classList.remove('hidden');
  createBtn.classList.remove('hidden');
  fetchAppointments();
};

async function openAppointment(id, status, number = null) {
  currentAppointment = id;
  currentStatus = status;
  const title = document.getElementById('appointmentTitle');
  if (number !== null) {
    title.textContent = `Прием ${number}`;
  } else {
    title.textContent = '';
  }
  createBtn.classList.add('hidden');
  appointmentsEl.classList.add('hidden');
  appointmentEl.classList.remove('hidden');
  finishBtn.classList.toggle('hidden', status === 'finished');
  controls.classList.toggle('hidden', status === 'finished');
  loadRecordings();
  startAudioPolling();
}

finishBtn.onclick = async function finishAppointment() {
  try {
    const fd = new FormData();
    fd.append('appointment_id', currentAppointment);
    const r = await apiFetch(`${API_URL}/api/v1/appointments/finish`, {
      method: 'POST',
      body: fd
    });
    if (!r.ok) throw new Error();
    finishBtn.classList.add('hidden');
    controls.classList.add('hidden');
    stopAudioPolling();
    fetchAppointments();
    location.reload();
  } catch (e) {
    if (e.message === 'unauthorized') retryQueue.push(finishAppointment);
    else alert('Ошибка завершения');
  }
};

function startRecording() {
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    const mimeType = getSupportedMimeType();
    recorder = new MediaRecorder(stream, { mimeType });

    recorder.ondataavailable = e => { chunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType });
      chunks = [];
      uploadRecording(blob, recorder.mimeType);
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

function uploadRecording(blob, mimeType) {
  const fd = new FormData();
  const number = audioCount + 1;
  audioCount = number;
  fd.append('number', number);
  fd.append('appointment_id', currentAppointment);
  const ext = getExtension(mimeType);
  fd.append('file', blob, `audio_${Date.now()}.${ext}`);
  const status = document.createElement('span');
  status.className = 'status';
  status.textContent = 'отправка...';
  recordingsList.appendChild(status);
  apiFetch(`${API_URL}/api/v1/appointments/audio/upload`, {
    method: 'POST',
    body: fd
  }).then(r => r.ok ? r.json() : Promise.reject()).then(() => {
    status.remove();
    loadRecordings();
  }).catch(e => {
    if (e.message === 'unauthorized') {
      status.textContent = 'ожидание авторизации...';
      retryQueue.push(() => uploadRecording(blob));
    } else {
      status.textContent = 'ошибка';
    }
  });
}

function renderRecordings(files) {
  recordingsList.innerHTML = '';
  audioCount = 0;
  files.sort((a, b) => a.audio_id - b.audio_id).forEach(f => {
    audioCount = Math.max(audioCount, f.audio_id);
    addExisting(f);
  });
  recordingsList.scrollTop = recordingsList.scrollHeight;
}

async function loadRecordings() {
  try {
    const r = await apiFetch(`${API_URL}/api/v1/appointments/audio/list?appointment_id=${currentAppointment}`);
    if (!r.ok) return;
    const d = await r.json();
    renderRecordings(d.audio_files);
    lastAudioSnapshot = JSON.stringify(d.audio_files);
  } catch (e) {
    if (e.message === 'unauthorized') retryQueue.push(loadRecordings);
  }
}

async function checkAudioUpdates() {
  try {
    const r = await apiFetch(`${API_URL}/api/v1/appointments/audio/list?appointment_id=${currentAppointment}`);
    if (!r.ok) return;
    const d = await r.json();
    const snapshot = JSON.stringify(d.audio_files);
    if (snapshot !== lastAudioSnapshot) {
      lastAudioSnapshot = snapshot;
      renderRecordings(d.audio_files);
    }
  } catch (e) {
    if (e.message === 'unauthorized') retryQueue.push(checkAudioUpdates);
  }
}

function startAudioPolling() {
  stopAudioPolling();
  audioPollInterval = setInterval(checkAudioUpdates, 5000);
}

function stopAudioPolling() {
  if (audioPollInterval) {
    clearInterval(audioPollInterval);
    audioPollInterval = null;
  }
}

async function fetchAudio(id) {
  const r = await apiFetch(`${API_URL}/api/v1/appointments/audio/get?appointment_id=${currentAppointment}&audio_id=${id}`);
  if (!r.ok) throw new Error();
  const blob = await r.blob();
  return URL.createObjectURL(blob);
}

function addExisting(f) {
  const li = document.createElement('li');
  const meta = document.createElement('div');
  meta.className = 'meta';
  const time = document.createElement('span');
  time.textContent = `${f.audio_id}. ${new Date(f.created_at).toLocaleTimeString()}`;
  meta.appendChild(time);
  if (currentStatus !== 'finished') {
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    meta.appendChild(spacer);
    const del = document.createElement('button');
    del.className = 'danger';
    del.textContent = 'удалить';
    del.onclick = () => deleteAudio(f.audio_id, li);
    meta.appendChild(del);
  }
  li.appendChild(meta);
  const audio = document.createElement('audio');
  audio.controls = true;
  fetchAudio(f.audio_id).then(url => { audio.src = url; }).catch(e => {
    if (e.message === 'unauthorized') retryQueue.push(loadRecordings);
  });
  li.appendChild(audio);
  if (f.transcript) {
    const text = document.createElement('div');
    text.className = 'transcript';
    text.textContent = f.transcript;
    li.appendChild(text);
  }
  recordingsList.appendChild(li);
}

async function deleteAudio(id, el) {
  try {
    const r = await apiFetch(`${API_URL}/api/v1/appointments/audio/delete?appointment_id=${currentAppointment}&audio_id=${id}`);
    if (r.ok) el.remove();
  } catch (e) {
    if (e.message === 'unauthorized') retryQueue.push(() => deleteAudio(id, el));
  }
}

reportBtn.onclick = () => {
  if (currentAppointment) showReportDialog();
};

reportMainBtn.onclick = () => requestReport('main');
reportAnamnesisBtn.onclick = () => requestReport('anamnesis');

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
}

});
