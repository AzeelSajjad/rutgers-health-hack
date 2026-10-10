const cases = [
  {
    id: '04', name: 'Maria R.', initials: 'MR', pronouns: 'She/her', title: 'Shortness of breath', focus: 'Heart failure', attitude: 'Reserved', manner: 'Quiet and cautious',
    opening: 'Hi, doctor. I’m feeling really short of breath, especially when I try to walk.', avatarColor: '#956c51', avatarBg: '#f2e9de',
    vitals: [['Blood pressure', '146/88', 'mmHg'], ['Heart rate', '108', 'bpm · elevated', true], ['Respiratory rate', '24', '/min · elevated', true], ['O₂ saturation', '91%', 'room air · low', true]],
    concerns: [['Dyspnea', 'Worsening over 3 days', 'Active'], ['Oxygen desaturation', '91% on room air', 'Monitor']],
    note: 'Patient reports increasing breathlessness with exertion, now present at rest. Further history pending.',
    history: [['Heart failure', 'Chronic'], ['Hypertension', 'Longstanding'], ['Type 2 diabetes', 'On oral medication']],
    medications: [['Furosemide', '40 mg · once daily'], ['Lisinopril', '10 mg · once daily'], ['Metformin', '500 mg · twice daily']], allergies: 'No known allergies recorded',
    labs: [['BNP', 'Elevated · 820 pg/mL', 'High'], ['Creatinine', '1.1 mg/dL', 'In range'], ['White blood cells', '9.8 K/µL', 'In range'], ['Potassium', '4.2 mmol/L', 'In range']], imaging: 'Chest radiograph · findings available in case review',
    answers: [['onset|when|long|start|worse', 'It started a few days ago. It’s been getting worse.'], ['lie|flat|sleep|pillow', 'Lying flat makes it harder. I’ve been using three pillows.'], ['swelling|ankle|leg|weight', 'My ankles have looked a little puffy lately.'], ['medication|medicine|pill|water pill|taking', 'I take a water pill. I missed a couple of doses this week.'], ['history|condition|medical|health', 'I have heart failure and high blood pressure.'], ['chest pain|pain', 'No chest pain.'], ['cough|fever', 'I’ve had a dry cough at night. No fever that I’ve noticed.'], ['home|alone|support|live', 'I live alone. I’m a little worried about that.']],
    fallback: 'I’m not sure. It’s been hard to talk about.', impression: 'The presentation is concerning for worsening heart failure with volume overload.',
    debrief: ['Progressive dyspnea, now at rest, with orthopnea', 'New ankle swelling and possible missed diuretic doses', 'Oxygen saturation 91%, tachycardia, and elevated respiratory rate', 'Known heart failure and elevated BNP'],
    reflect: ['Clarify onset, progression, exertional limits, and nighttime symptoms', 'Explore weight change, swelling, medication access, and adherence', 'Ask about chest pain, fever, cough, and possible triggers', 'Summarize the patient’s concerns and home support'],
    takeaway: 'Next time, ask early whether breathing is worse when lying flat or wakes the patient at night, then check for swelling and missed diuretic doses.'
  },
  {
    id: '07', name: 'Daniel K.', initials: 'DK', pronouns: 'He/him', title: 'Worsening breathlessness', focus: 'COPD exacerbation', attitude: 'Anxious', manner: 'Worried and talkative',
    opening: 'I can’t catch my breath. I’m worried this is getting bad quickly.', avatarColor: '#557b70', avatarBg: '#e3eee9',
    vitals: [['Blood pressure', '138/82', 'mmHg'], ['Heart rate', '116', 'bpm · elevated', true], ['Respiratory rate', '28', '/min · elevated', true], ['O₂ saturation', '89%', 'room air · low', true]],
    concerns: [['Dyspnea and wheeze', 'Worsening over 2 days', 'Active'], ['Low oxygen saturation', '89% on room air', 'Monitor']],
    note: 'Patient with COPD reports increased breathlessness and cough. Respiratory assessment ongoing.',
    history: [['COPD', 'Moderate · prior admissions'], ['Hypertension', 'Longstanding'], ['Tobacco use', 'Former smoker']],
    medications: [['Albuterol inhaler', 'As needed'], ['Tiotropium', 'Once daily'], ['Amlodipine', '5 mg · once daily']], allergies: 'Penicillin · rash reported',
    labs: [['White blood cells', '12.4 K/µL', 'High'], ['Creatinine', '0.9 mg/dL', 'In range'], ['Potassium', '4.0 mmol/L', 'In range'], ['Venous CO₂', 'Elevated', 'Review']], imaging: 'Chest radiograph · hyperinflation noted in sample report',
    answers: [['onset|when|long|start|worse', 'It started two days ago, and it feels worse today. I’m getting scared.'], ['cough|sputum|phlegm', 'I’ve been coughing more, and the mucus is thicker than usual.'], ['fever|chills', 'I felt warm last night, but I didn’t take my temperature.'], ['medication|medicine|inhaler|pill|taking', 'I use my rescue inhaler a lot. I’m almost out of it.'], ['history|condition|medical|health', 'I have COPD. I’ve been admitted for my breathing before.'], ['chest pain|pain', 'My chest feels tight when I wheeze, but it doesn’t hurt sharply.'], ['smok|tobacco|cigarette', 'I used to smoke, but I quit a few years ago.'], ['home|alone|support|live', 'My daughter lives nearby, but I came in by myself.']],
    fallback: 'I’m really worried. It’s hard to focus when I feel this short of breath.', impression: 'The presentation is concerning for an acute COPD exacerbation with hypoxemia.',
    debrief: ['Increased dyspnea and cough with thicker sputum', 'Oxygen saturation 89% with tachycardia and tachypnea', 'Known COPD and frequent rescue inhaler use with limited supply', 'Leukocytosis and prior respiratory admissions in the sample chart'],
    reflect: ['Establish symptom onset, baseline breathing, and recent change', 'Clarify inhaler use, medication access, and prior exacerbations', 'Explore sputum changes, fever, chest symptoms, and possible triggers', 'Ask about smoking history and available support'],
    takeaway: 'Next time, compare symptoms with the patient’s breathing baseline, then quantify rescue inhaler use and ask whether they can access a refill.'
  },
  {
    id: '11', name: 'Avery T.', initials: 'AT', pronouns: 'They/them', title: 'Fever and cough', focus: 'Pneumonia', attitude: 'Open and direct', manner: 'Matter-of-fact and forthcoming',
    opening: 'I’ve had a fever and a cough for a few days, and now it hurts when I take a deep breath.', avatarColor: '#755a8b', avatarBg: '#eee8f3',
    vitals: [['Blood pressure', '122/76', 'mmHg'], ['Heart rate', '104', 'bpm · elevated', true], ['Respiratory rate', '22', '/min · elevated', true], ['O₂ saturation', '93%', 'room air · low', true]],
    concerns: [['Fever and productive cough', 'Worsening over 4 days', 'Active'], ['Pleuritic discomfort', 'With deep breathing', 'Assess']],
    note: 'Patient reports fever, productive cough, and pleuritic discomfort. Evaluation in progress.',
    history: [['Asthma', 'Mild · intermittent'], ['Type 2 diabetes', 'Diet controlled'], ['Recent illness exposure', 'Household contact reported']],
    medications: [['Albuterol inhaler', 'As needed'], ['Acetaminophen', 'As needed for fever']], allergies: 'No known allergies recorded',
    labs: [['White blood cells', '14.2 K/µL', 'High'], ['Creatinine', '0.8 mg/dL', 'In range'], ['Lactate', '1.4 mmol/L', 'In range'], ['O₂ saturation', '93% on room air', 'Low']], imaging: 'Chest radiograph · focal opacity noted in sample report',
    answers: [['onset|when|long|start|worse', 'It started about four days ago. The fever began first, then the cough got worse.'], ['cough|sputum|phlegm', 'I’m coughing up yellow mucus several times a day.'], ['fever|chills|temperature', 'I measured 38.5°C last night and had chills.'], ['pain|chest|breathe|breath', 'It’s a sharp pain on the right when I take a deep breath or cough.'], ['medication|medicine|inhaler|pill|taking', 'I’ve taken acetaminophen twice. I used my inhaler once this morning.'], ['history|condition|medical|health', 'I have mild asthma and diabetes, but both are usually well controlled.'], ['sick|exposure|contact|family', 'My partner had a bad cold last week.'], ['home|alone|support|live', 'I live with my partner, who can help if I need it.']],
    fallback: 'I can tell you what I’ve noticed. The fever and cough have been the main problems.', impression: 'The presentation is concerning for community-acquired pneumonia.',
    debrief: ['Fever with productive cough and pleuritic discomfort', 'Oxygen saturation 93% with tachycardia and tachypnea', 'Leukocytosis and focal opacity in the sample radiology report', 'Asthma, diabetes, and recent household illness exposure'],
    reflect: ['Clarify fever pattern, cough, sputum, and breathing symptoms', 'Characterize chest discomfort and screen for related symptoms', 'Review relevant conditions, medications, and recent sick contacts', 'Check hydration, function, and available support at home'],
    takeaway: 'Next time, pin down the fever and cough timeline, then characterize pain with breathing and ask about sick contacts.'
  }
];

function renderChartSection(patientCase, section) {
  const row = (icon, name, detail, status = '') => `<div class="list-row"><span class="row-icon">${icon}</span><div class="row-copy"><strong>${escapeText(name)}</strong><span>${escapeText(detail)}</span></div>${status ? `<span class="status ${status === 'High' || status === 'Active' ? 'high' : ''}">${escapeText(status)}</span>` : ''}</div>`;
  if (section === 'summary') return `<section class="chart-section"><div class="section-title">VITALS <span style="font-weight:400;letter-spacing:0">· On arrival</span></div><div class="vitals-grid">${patientCase.vitals.map(([name, value, detail, alert]) => `<div class="vital ${alert ? 'alert' : ''}"><span>${escapeText(name)}</span><strong>${escapeText(value)}</strong><small>${escapeText(detail)}</small></div>`).join('')}</div></section><section class="chart-section"><div class="section-title">ACTIVE CONCERNS</div>${patientCase.concerns.map(item => row('↗', item[0], item[1], item[2])).join('')}</section><section class="chart-section"><div class="section-title">RECENT NOTE</div><div class="note-text">${escapeText(patientCase.note)}</div></section>`;
  if (section === 'history') return `<section class="chart-section"><div class="section-title">MEDICAL HISTORY</div>${patientCase.history.map(item => row('✚', item[0], item[1])).join('')}</section><section class="chart-section"><div class="section-title">MEDICATIONS</div>${patientCase.medications.map(item => row('▤', item[0], item[1])).join('')}</section><section class="chart-section"><div class="section-title">ALLERGIES</div>${row('!', patientCase.allergies, 'Review with patient')}</section>`;
  return `<section class="chart-section"><div class="section-title">LAB RESULTS <span style="font-weight:400;letter-spacing:0">· Today</span></div>${patientCase.labs.map(item => row('⌁', item[0], item[1], item[2])).join('')}</section><section class="chart-section"><div class="section-title">IMAGING</div>${row('▧', patientCase.imaging, 'Sample report')}</section><section class="chart-section"><div class="section-title">ABOUT THESE RESULTS</div><div class="note-text">Demo findings are included to support this learning case. They are not connected to MIMIC data.</div></section>`;
}

const content = document.getElementById('chartContent');
const tabs = [...document.querySelectorAll('.chart-tab')];
let activeCase = null;
function showTab(name) {
  if (activeCase) content.innerHTML = renderChartSection(activeCase, name);
  tabs.forEach(tab => {
    const selected = tab.dataset.tab === name;
    tab.classList.toggle('active', selected);
    tab.setAttribute('aria-selected', String(selected));
  });
}
tabs.forEach(tab => tab.addEventListener('click', () => showTab(tab.dataset.tab)));

const messages = document.getElementById('messages');
const input = document.getElementById('messageInput');
let typing = document.getElementById('typing');
const encounterPanel = document.querySelector('.conversation-panel');
const voiceStatus = document.getElementById('voiceStatus');
const micButton = document.getElementById('micButton');
const initialMarkup = messages.innerHTML;
const debriefModal = document.getElementById('debriefModal');
const endSessionButton = document.getElementById('endSession');
const appShell = document.querySelector('.app-shell');
const sidebarToggle = document.getElementById('sidebarToggle');
let voiceMode = false;
let encounterEnded = false;
let pendingReplyTimer = null;
let encounterStartedAt = null;
let activeLearnerKey = 'demo';
let currentPage = 'practice';
function escapeText(value) {
  const node = document.createElement('span');
  node.textContent = value;
  return node.innerHTML;
}
function practiceStorageKey() {
  return `casecoach.practice.v1.${activeLearnerKey}`;
}
function loadPracticeRecords() {
  try {
    const records = JSON.parse(localStorage.getItem(practiceStorageKey()) || '[]');
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}
function savePracticeRecords(records) {
  try { localStorage.setItem(practiceStorageKey(), JSON.stringify(records)); }
  catch { notify('This browser could not save your practice progress.'); }
}
function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}
function sortedRecords() {
  return loadPracticeRecords().sort((a, b) => new Date(b.date) - new Date(a.date));
}
function statCard(label, value, detail, icon) {
  return `<article class="dash-stat"><div class="dash-stat-label">${escapeText(label)}<span class="dash-stat-icon">${icon}</span></div><strong>${escapeText(String(value))}</strong><small>${escapeText(detail)}</small></article>`;
}
function activityMarkup(records, emptyMessage) {
  if (!records.length) return `<p class="empty-activity">${escapeText(emptyMessage)}</p>`;
  return records.slice(0, 4).map(record => {
    const patientCase = cases.find(item => item.id === record.caseId);
    if (!patientCase) return '';
    return `<div class="activity-item"><div class="activity-avatar" style="background:${patientCase.avatarBg};color:${patientCase.avatarColor}">${patientCase.initials}</div><div class="activity-copy"><strong>${escapeText(patientCase.focus)}</strong><small>${escapeText(patientCase.name)} · ${record.questionCount} questions</small></div><time class="activity-date">${formatDate(record.date)}</time></div>`;
  }).join('');
}
function addMessage(value, who) {
  const row = document.createElement('div');
  row.className = `message-row ${who === 'patient' ? 'patient-row' : 'student-row'}`;
  const initials = who === 'patient' ? activeCase.initials : 'JS';
  const avatarClass = who === 'patient' ? 'patient-avatar' : 'student-avatar';
  const label = who === 'patient' ? activeCase.name.split(' ')[0].toUpperCase() : 'YOU';
  const bubbleClass = who === 'patient' ? 'patient-bubble' : 'student-bubble';
  const body = `<div class="message-content"><div class="message-label ${who === 'student' ? 'right-label' : ''}">${label} <span>·</span> NOW</div><div class="bubble ${bubbleClass}">${escapeText(value)}</div></div>`;
  row.innerHTML = who === 'patient' ? `<div class="avatar ${avatarClass} mini">${initials}</div>${body}` : `${body}<div class="avatar ${avatarClass} mini">${initials}</div>`;
  messages.insertBefore(row, typing);
  messages.scrollTop = messages.scrollHeight;
}
function getPatientReply(question) {
  const normalized = question.toLowerCase();
  const match = activeCase.answers.find(([keywords]) => keywords.split('|').some(keyword => normalized.includes(keyword)));
  return match ? match[1] : activeCase.fallback;
}
function setList(elementId, entries) {
  document.getElementById(elementId).innerHTML = entries.map(entry => `<li>${escapeText(entry)}</li>`).join('');
}
function startCase(caseId) {
  const selectedCase = cases.find(item => item.id === caseId);
  if (!selectedCase) return;
  if (recognition && isListening) recognition.stop();
  clearTimeout(pendingReplyTimer);
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  activeCase = selectedCase;
  encounterEnded = false;
  encounterStartedAt = Date.now();
  voiceMode = false;
  messages.innerHTML = initialMarkup;
  typing = messages.querySelector('#typing');
  input.value = '';
  input.disabled = false;
  micButton.disabled = false;
  document.querySelector('.send-button').disabled = false;
  endSessionButton.disabled = false;
  endSessionButton.innerHTML = 'End encounter <span>→</span>';
  document.getElementById('debriefModal').classList.add('hidden');
  document.querySelector('.patient-selection').classList.add('hidden');
  document.getElementById('caseHeading').classList.remove('hidden');
  document.getElementById('encounterWorkspace').classList.remove('hidden');
  document.getElementById('sessionFooter').classList.remove('hidden');
  document.getElementById('caseNumber').textContent = `CASE ${activeCase.id}`;
  document.getElementById('caseTitle').textContent = activeCase.title;
  document.getElementById('caseSubtitle').textContent = `Emergency department · ${activeCase.attitude} communication style`;
  document.getElementById('caseCondition').textContent = activeCase.focus;
  document.getElementById('patientName').textContent = activeCase.name;
  document.getElementById('stagePatientName').textContent = activeCase.name;
  const stagePortrait = document.getElementById('patientStagePortrait');
  stagePortrait.textContent = activeCase.initials;
  stagePortrait.style.setProperty('--avatar-bg', activeCase.avatarBg);
  stagePortrait.style.setProperty('--avatar-color', activeCase.avatarColor);
  document.getElementById('chartPatientName').textContent = activeCase.name;
  document.getElementById('patientPronouns').textContent = activeCase.pronouns;
  document.getElementById('chartAvatar').textContent = activeCase.initials;
  const portrait = document.getElementById('patientPortrait');
  portrait.textContent = activeCase.initials;
  portrait.style.background = activeCase.avatarBg;
  portrait.style.color = activeCase.avatarColor;
  portrait.setAttribute('aria-label', `Avatar for ${activeCase.name}`);
  document.getElementById('debriefImpression').textContent = `${activeCase.impression} This is a simulated learning case, not a clinical diagnosis.`;
  document.getElementById('debriefTakeaway').textContent = activeCase.takeaway;
  setList('debriefDetails', activeCase.debrief);
  setList('debriefReflection', activeCase.reflect);
  encounterPanel.classList.remove('patient-speaking', 'listening');
  voiceStatus.textContent = 'Ready to talk';
  showTab('summary');
  addMessage(activeCase.opening, 'patient');
}
const patientCards = document.getElementById('patientCards');
patientCards.innerHTML = cases.map(patientCase => `<article class="patient-case-card"><div class="patient-card-top"><div class="case-card-avatar" style="background:${patientCase.avatarBg};color:${patientCase.avatarColor}">${patientCase.initials}</div><span class="case-number">CASE ${patientCase.id}</span></div><h2>${escapeText(patientCase.name)}</h2><p class="patient-case-focus">${escapeText(patientCase.title)}</p><div class="patient-case-divider"></div><div class="case-attribute"><span>CONDITION FOCUS</span><strong>${escapeText(patientCase.focus)}</strong></div><div class="case-attribute attitude-attribute"><span>COMMUNICATION STYLE</span><strong><i class="attitude-dot"></i>${escapeText(patientCase.attitude)}</strong><small>${escapeText(patientCase.manner)}</small></div><button class="start-case-button" type="button" data-case-id="${patientCase.id}">Start encounter <span>→</span></button></article>`).join('');
patientCards.addEventListener('click', event => {
  const button = event.target.closest('[data-case-id]');
  if (button) startCase(button.dataset.caseId);
});
document.getElementById('backToCases').addEventListener('click', () => {
  if (recognition && isListening) recognition.stop();
  clearTimeout(pendingReplyTimer);
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  encounterPanel.classList.remove('patient-speaking', 'listening');
  document.getElementById('caseHeading').classList.add('hidden');
  document.getElementById('encounterWorkspace').classList.add('hidden');
  document.getElementById('sessionFooter').classList.add('hidden');
  document.querySelector('.patient-selection').classList.remove('hidden');
});
function sendMessage(value) {
  const text = value.trim();
  if (!text || encounterEnded) return;
  addMessage(text, 'student');
  input.value = '';
  input.style.height = 'auto';
  typing.classList.remove('hidden');
  encounterPanel.classList.add('patient-speaking');
  voiceStatus.textContent = `${activeCase.name.split(' ')[0]} is responding`;
  messages.scrollTop = messages.scrollHeight;
  pendingReplyTimer = window.setTimeout(() => {
    if (encounterEnded) return;
    typing.classList.add('hidden');
    const reply = getPatientReply(text);
    addMessage(reply, 'patient');
    if (voiceMode && 'speechSynthesis' in window) {
      const spokenReply = new SpeechSynthesisUtterance(reply);
      spokenReply.lang = 'en-US';
      spokenReply.onend = () => {
        encounterPanel.classList.remove('patient-speaking');
        voiceStatus.textContent = 'Ready to talk';
      };
      spokenReply.onerror = spokenReply.onend;
      window.speechSynthesis.speak(spokenReply);
    } else {
      encounterPanel.classList.remove('patient-speaking');
      voiceStatus.textContent = 'Ready to talk';
    }
  }, 850);
}
document.getElementById('chatForm').addEventListener('submit', event => {
  event.preventDefault();
  sendMessage(input.value);
});
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 68)}px`;
});
const toast = document.getElementById('toast');
let toastTimer;
function notify(text) {
  toast.textContent = text;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2200);
}
document.getElementById('clearChat').addEventListener('click', () => {
  if (recognition && isListening) recognition.stop();
  clearTimeout(pendingReplyTimer);
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  typing.classList.add('hidden');
  messages.innerHTML = initialMarkup;
  typing = messages.querySelector('#typing');
  encounterStartedAt = Date.now();
  if (activeCase) addMessage(activeCase.opening, 'patient');
  encounterEnded = false;
  input.disabled = false;
  document.querySelector('.send-button').disabled = false;
  micButton.disabled = false;
  endSessionButton.disabled = false;
  endSessionButton.innerHTML = 'End encounter <span>→</span>';
  debriefModal.classList.add('hidden');
  encounterPanel.classList.remove('patient-speaking', 'listening');
  voiceStatus.textContent = 'Ready to talk';
  notify('Encounter restarted');
});
function finishEncounter() {
  if (encounterEnded) return;
  encounterEnded = true;
  clearTimeout(pendingReplyTimer);
  if (recognition && isListening) recognition.stop();
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  typing.classList.add('hidden');
  input.disabled = true;
  document.querySelector('.send-button').disabled = true;
  micButton.disabled = true;
  endSessionButton.disabled = true;
  endSessionButton.textContent = 'Encounter ended';
  voiceStatus.textContent = 'Encounter ended';
  encounterPanel.classList.remove('patient-speaking', 'listening');
  saveEncounterFeedback();
  debriefModal.classList.remove('hidden');
  document.getElementById('debriefDone').focus();
}
function closeDebrief() {
  debriefModal.classList.add('hidden');
  endSessionButton.focus();
}
endSessionButton.addEventListener('click', finishEncounter);
document.getElementById('closeDebrief').addEventListener('click', closeDebrief);
document.getElementById('debriefDone').addEventListener('click', closeDebrief);
debriefModal.addEventListener('click', event => { if (event.target === debriefModal) closeDebrief(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !debriefModal.classList.contains('hidden')) closeDebrief(); });
document.querySelector('.expand-button').addEventListener('click', () => notify('Chart view options'));

function saveEncounterFeedback() {
  if (!activeCase) return;
  const records = loadPracticeRecords();
  const questionCount = messages.querySelectorAll('.student-row').length;
  const durationMinutes = Math.max(1, Math.round((Date.now() - (encounterStartedAt || Date.now())) / 60000));
  const record = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    caseId: activeCase.id,
    date: new Date().toISOString(),
    questionCount,
    durationMinutes,
    impression: activeCase.impression,
    takeaway: activeCase.takeaway,
    details: [...activeCase.debrief],
    reflect: [...activeCase.reflect]
  };
  savePracticeRecords([record, ...records].slice(0, 100));
}

function renderOverview() {
  const records = sortedRecords();
  const practiced = new Set(records.map(record => record.caseId)).size;
  const questionCount = records.reduce((total, record) => total + Number(record.questionCount || 0), 0);
  document.getElementById('overviewStats').innerHTML = [
    statCard('Completed encounters', records.length, records.length ? 'Saved debriefs ready to review' : 'End an encounter to save feedback', '✓'),
    statCard('Cases explored', `${practiced}/${cases.length}`, 'Different clinical focuses practiced', '◉'),
    statCard('Questions asked', questionCount, 'Across your completed sessions', '？'),
    statCard('Saved feedback', records.length, 'Organized by practice case', '♡')
  ].join('');
  const continueTitle = document.getElementById('continueTitle');
  const continueDescription = document.getElementById('continueDescription');
  const continueButton = document.getElementById('continuePractice');
  if (activeCase && !encounterEnded) {
    continueTitle.textContent = `Continue ${activeCase.name}`;
    continueDescription.textContent = `${activeCase.focus} · Your interview is still in progress.`;
    continueButton.textContent = 'Return to encounter →';
  } else if (records.length) {
    const recentCase = cases.find(item => item.id === records[0].caseId);
    continueTitle.textContent = recentCase ? `Last practiced: ${recentCase.focus}` : 'Ready for another case?';
    continueDescription.textContent = 'Choose a patient and work through the interview at your own pace.';
    continueButton.textContent = 'Choose a patient →';
  } else {
    continueTitle.textContent = 'Choose a case to begin';
    continueDescription.textContent = 'Practice a focused interview with a virtual patient, then review your saved debrief.';
    continueButton.textContent = 'Choose a patient →';
  }
  document.getElementById('overviewRecent').innerHTML = activityMarkup(records, 'Your completed encounters will appear here.');
  document.getElementById('overviewCases').innerHTML = cases.map(patientCase => {
    const count = records.filter(record => record.caseId === patientCase.id).length;
    return `<article class="overview-case"><div class="overview-case-top"><div class="activity-avatar" style="background:${patientCase.avatarBg};color:${patientCase.avatarColor}">${patientCase.initials}</div><strong>${escapeText(patientCase.focus)}</strong></div><p>${escapeText(patientCase.attitude)} patient · ${escapeText(patientCase.title)}</p><div class="overview-case-footer"><span>${count} ${count === 1 ? 'session' : 'sessions'}</span><button type="button" data-case-id="${patientCase.id}">Practice →</button></div></article>`;
  }).join('');
}

function renderProgress() {
  const records = sortedRecords();
  const practicedIds = new Set(records.map(record => record.caseId));
  const questionCount = records.reduce((total, record) => total + Number(record.questionCount || 0), 0);
  document.getElementById('progressStats').innerHTML = [
    statCard('Completed encounters', records.length, 'Practice sessions ended', '✓'),
    statCard('Cases practiced', `${practicedIds.size}/${cases.length}`, 'Unique clinical focuses', '◉'),
    statCard('Interview questions', questionCount, 'You asked during completed sessions', '？'),
    statCard('Cases to explore', cases.length - practicedIds.size, 'New perspectives to practice', '✳')
  ].join('');
  const maxCount = Math.max(1, ...cases.map(patientCase => records.filter(record => record.caseId === patientCase.id).length));
  document.getElementById('focusBreakdown').innerHTML = cases.map(patientCase => {
    const count = records.filter(record => record.caseId === patientCase.id).length;
    return `<div class="focus-row"><div class="focus-row-head"><strong>${escapeText(patientCase.focus)}</strong><span>${count} ${count === 1 ? 'encounter' : 'encounters'}</span></div><div class="focus-track"><span style="width:${count ? Math.max(5, Math.round(count / maxCount * 100)) : 0}%"></span></div></div>`;
  }).join('');
  document.getElementById('progressHistory').innerHTML = activityMarkup(records, 'No completed sessions yet. Your practice history will build as you finish cases.');
}

function renderSavedFeedback() {
  const filter = document.getElementById('feedbackCaseFilter');
  if (filter.options.length === 1) {
    cases.forEach(patientCase => {
      const option = document.createElement('option');
      option.value = patientCase.id;
      option.textContent = `Case ${patientCase.id} · ${patientCase.focus}`;
      filter.append(option);
    });
  }
  const selectedCase = filter.value || 'all';
  const records = sortedRecords();
  const visibleRecords = selectedCase === 'all' ? records : records.filter(record => record.caseId === selectedCase);
  const selected = cases.find(item => item.id === selectedCase);
  const title = selected ? selected.focus : 'all practice cases';
  document.getElementById('feedbackSummary').innerHTML = `<span><strong>${visibleRecords.length}</strong> ${visibleRecords.length === 1 ? 'saved debrief' : 'saved debriefs'} for ${escapeText(title)}</span><span>Most recent first</span>`;
  const list = document.getElementById('savedFeedbackList');
  if (!visibleRecords.length) {
    list.innerHTML = `<div class="empty-feedback"><div class="empty-feedback-mark">♡</div><h2>${selected ? `No feedback saved for ${escapeText(selected.focus)} yet` : 'No saved feedback yet'}</h2><p>Complete and end a practice encounter to save its debrief here. You can then return to it by case.</p><button class="dashboard-primary" type="button" data-page="practice">Choose a patient <span>→</span></button></div>`;
    return;
  }
  list.innerHTML = visibleRecords.map(record => {
    const patientCase = cases.find(item => item.id === record.caseId);
    if (!patientCase) return '';
    return `<article class="saved-feedback-card"><header><div class="feedback-case-ident"><div class="activity-avatar" style="background:${patientCase.avatarBg};color:${patientCase.avatarColor}">${patientCase.initials}</div><div><h2>${escapeText(patientCase.focus)}</h2><p>Case ${patientCase.id} · ${escapeText(patientCase.name)} · ${escapeText(patientCase.attitude)} patient</p></div></div><time class="feedback-date">${formatDate(record.date)}</time></header><div class="feedback-impression"><strong>CASE IMPRESSION</strong>${escapeText(record.impression)}</div><div class="key-takeaway"><strong>ONE KEY TAKEAWAY FOR NEXT TIME</strong><p>${escapeText(record.takeaway || patientCase.takeaway)}</p></div><div class="feedback-columns"><section class="feedback-section"><h3>KEY DETAILS IN THIS CASE</h3><ul>${record.details.map(item => `<li>${escapeText(item)}</li>`).join('')}</ul></section><section class="feedback-section"><h3>REFLECTION & FOLLOW-UP</h3><ul>${record.reflect.map(item => `<li>${escapeText(item)}</li>`).join('')}</ul></section></div><footer class="feedback-card-footer"><span>${record.questionCount} interview ${record.questionCount === 1 ? 'question' : 'questions'} · about ${record.durationMinutes} min</span><button type="button" data-case-id="${patientCase.id}">Practice this case again →</button></footer></article>`;
  }).join('');
}

function refreshCurrentPage() {
  if (currentPage === 'overview') renderOverview();
  if (currentPage === 'progress') renderProgress();
  if (currentPage === 'feedback') renderSavedFeedback();
}

function showPatientSelection() {
  if (recognition && isListening) recognition.stop();
  clearTimeout(pendingReplyTimer);
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  encounterPanel.classList.remove('patient-speaking', 'listening');
  document.getElementById('caseHeading').classList.add('hidden');
  document.getElementById('encounterWorkspace').classList.add('hidden');
  document.getElementById('sessionFooter').classList.add('hidden');
  document.querySelector('.patient-selection').classList.remove('hidden');
}

function navigateToPage(page) {
  if (!['overview', 'practice', 'progress', 'feedback'].includes(page)) return;
  currentPage = page;
  document.getElementById('overviewPage').classList.toggle('hidden', page !== 'overview');
  document.getElementById('practicePage').classList.toggle('hidden', page !== 'practice');
  document.getElementById('progressPage').classList.toggle('hidden', page !== 'progress');
  document.getElementById('feedbackPage').classList.toggle('hidden', page !== 'feedback');
  document.querySelectorAll('[data-page].nav-item, [data-page].taskbar-link').forEach(link => {
    const active = link.dataset.page === page;
    link.classList.toggle('active', active);
    link.classList.toggle('selected', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  refreshCurrentPage();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

const learningSpaces = {
  'clinical-skills': { name: 'Clinical Skills I', cohort: 'Spring cohort · 2026' },
  'communication-lab': { name: 'Patient Communication Lab', cohort: 'Summer cohort · 2026' },
  assessment: { name: 'Foundations of Assessment', cohort: 'Fall cohort · 2026' }
};
function learningSpaceStorageKey() {
  return `casecoach.learningSpace.v1.${activeLearnerKey}`;
}
function readSavedLearningSpace() {
  try {
    const saved = localStorage.getItem(learningSpaceStorageKey());
    return learningSpaces[saved] ? saved : 'clinical-skills';
  } catch { return 'clinical-skills'; }
}
function setActiveLearningSpace(id) {
  const selected = learningSpaces[id] ? id : 'clinical-skills';
  const space = learningSpaces[selected];
  document.getElementById('activeCourseName').textContent = space.name;
  document.getElementById('activeCourseCohort').textContent = space.cohort;
  document.getElementById('settingsCourseName').textContent = space.name;
  document.getElementById('settingsCourseCohort').textContent = space.cohort;
  document.querySelectorAll('[data-course-id]').forEach(option => option.setAttribute('aria-checked', String(option.dataset.courseId === selected)));
  try { localStorage.setItem(learningSpaceStorageKey(), selected); } catch { /* This selector still works for the current view. */ }
}

const courseSwitcherButton = document.getElementById('courseSwitcherButton');
const courseMenu = document.getElementById('courseMenu');
const profileMenuButton = document.getElementById('profileMenuButton');
const profileMenu = document.getElementById('profileMenu');
const accountSettingsModal = document.getElementById('accountSettingsModal');
function closeCourseMenu() {
  courseMenu.classList.add('hidden');
  courseSwitcherButton.setAttribute('aria-expanded', 'false');
}
function closeProfileMenu() {
  profileMenu.classList.add('hidden');
  profileMenuButton.setAttribute('aria-expanded', 'false');
}
function openProfileMenu() {
  closeCourseMenu();
  profileMenu.classList.remove('hidden');
  profileMenuButton.setAttribute('aria-expanded', 'true');
}
function openCourseMenu() {
  closeProfileMenu();
  courseMenu.classList.remove('hidden');
  courseSwitcherButton.setAttribute('aria-expanded', 'true');
}
courseSwitcherButton.addEventListener('click', () => {
  if (courseMenu.classList.contains('hidden')) openCourseMenu();
  else closeCourseMenu();
});
document.querySelectorAll('[data-course-id]').forEach(option => {
  option.addEventListener('click', () => {
    setActiveLearningSpace(option.dataset.courseId);
    closeCourseMenu();
    notify(`Learning space changed to ${learningSpaces[option.dataset.courseId].name}`);
    courseSwitcherButton.focus();
  });
});
profileMenuButton.addEventListener('click', () => {
  if (profileMenu.classList.contains('hidden')) openProfileMenu();
  else closeProfileMenu();
});
document.querySelectorAll('[data-open-profile]').forEach(button => button.addEventListener('click', openProfileMenu));
document.getElementById('openAccountSettings').addEventListener('click', () => {
  closeProfileMenu();
  accountSettingsModal.classList.remove('hidden');
  document.getElementById('closeAccountSettings').focus();
});
function closeAccountSettings() {
  accountSettingsModal.classList.add('hidden');
  profileMenuButton.focus();
}
document.getElementById('closeAccountSettings').addEventListener('click', closeAccountSettings);
document.getElementById('settingsDone').addEventListener('click', closeAccountSettings);
accountSettingsModal.addEventListener('click', event => { if (event.target === accountSettingsModal) closeAccountSettings(); });
document.getElementById('settingsChooseCourse').addEventListener('click', () => {
  closeAccountSettings();
  openCourseMenu();
  courseSwitcherButton.focus();
});
document.addEventListener('click', event => {
  if (!event.target.closest('.course-switcher')) closeCourseMenu();
  if (!event.target.closest('.profile-menu-wrap') && !event.target.closest('[data-open-profile]')) closeProfileMenu();
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (!accountSettingsModal.classList.contains('hidden')) closeAccountSettings();
  closeCourseMenu();
  closeProfileMenu();
});
setActiveLearningSpace(readSavedLearningSpace());

document.addEventListener('click', event => {
  const pageControl = event.target.closest('[data-page]');
  if (pageControl) {
    event.preventDefault();
    closeProfileMenu();
    if (pageControl.dataset.page === 'feedback' && currentPage === 'practice' && activeCase && !pageControl.dataset.feedbackCase) {
      document.getElementById('feedbackCaseFilter').value = activeCase.id;
    }
    if (pageControl.dataset.feedbackCase) {
      document.getElementById('feedbackCaseFilter').value = pageControl.dataset.feedbackCase;
    }
    navigateToPage(pageControl.dataset.page);
    return;
  }
  const caseControl = event.target.closest('.overview-case [data-case-id], .saved-feedback-card [data-case-id]');
  if (caseControl) {
    startCase(caseControl.dataset.caseId);
    navigateToPage('practice');
  }
});
document.getElementById('continuePractice').addEventListener('click', () => {
  if (!activeCase || encounterEnded) showPatientSelection();
  navigateToPage('practice');
});
document.getElementById('feedbackCaseFilter').addEventListener('change', renderSavedFeedback);
renderOverview();
renderProgress();
renderSavedFeedback();

function setSidebarCollapsed(collapsed) {
  appShell.classList.toggle('sidebar-collapsed', collapsed);
  sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
  sidebarToggle.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  sidebarToggle.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  localStorage.setItem('casecoach.sidebarCollapsed', String(collapsed));
}
setSidebarCollapsed(localStorage.getItem('casecoach.sidebarCollapsed') === 'true');
sidebarToggle.addEventListener('click', () => setSidebarCollapsed(!appShell.classList.contains('sidebar-collapsed')));

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isListening = false;
function updateMicState(listening) {
  isListening = listening;
  encounterPanel.classList.toggle('listening', listening);
  micButton.classList.toggle('recording', listening);
  micButton.setAttribute('aria-label', listening ? 'Stop listening' : 'Start speaking');
  micButton.title = listening ? 'Stop listening' : 'Speak your question';
  voiceStatus.textContent = encounterEnded ? 'Encounter ended' : listening ? 'Listening to you…' : 'Ready to talk';
}
if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.onstart = () => updateMicState(true);
  recognition.onresult = event => {
    let finalText = '';
    let interimText = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalText += transcript;
      else interimText += transcript;
    }
    if (interimText) {
      input.placeholder = interimText;
      voiceStatus.textContent = 'Hearing you…';
    }
    if (finalText.trim()) {
      const separator = input.value && !/\s$/.test(input.value) ? ' ' : '';
      input.value += `${separator}${finalText.trim()}`;
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, 68)}px`;
      input.placeholder = 'Ask a question… or use your mic';
      input.focus();
      notify('Review your dictated question, then select Send');
    }
  };
  recognition.onerror = event => {
    updateMicState(false);
    input.placeholder = 'Ask a question… or use your mic';
    notify(event.error === 'not-allowed' ? 'Allow microphone access in your browser to speak' : 'I couldn’t hear that. Please try again.');
  };
  recognition.onend = () => {
    updateMicState(false);
    input.placeholder = 'Ask a question… or use your mic';
  };
}
micButton.addEventListener('click', () => {
  if (!recognition) {
    notify('Voice recognition is not supported in this browser. You can still type your question.');
    return;
  }
  if (isListening) recognition.stop();
  else {
    try { voiceMode = true; recognition.start(); }
    catch { notify('Microphone is already starting. Please try again in a moment.'); }
  }
});

// Auth0 Universal Login wiring. The app remains usable as a clearly labeled
// preview until the public SPA domain and client ID are configured.
const authScreen = document.getElementById('authScreen');
const authStatus = document.getElementById('authStatus');
const signInButton = document.getElementById('authSignIn');
const studentSignUpButton = document.getElementById('authStudentSignUp');
const facultySignUpButton = document.getElementById('authFacultySignUp');
const logoutButton = document.getElementById('authLogoutButton');
const demoAccess = document.getElementById('demoAccess');
const authConfig = window.CASECOACH_AUTH0 || {};
let authClient = null;
let demoPreviewActive = false;
let currentAuthUser = null;

function showAuthenticatedApp(user, requestedAccountType = null) {
  currentAuthUser = user;
  activeLearnerKey = encodeURIComponent(user.sub || 'authenticated');
  let accountType = ['student', 'faculty'].includes(requestedAccountType) ? requestedAccountType : null;
  try {
    if (accountType) sessionStorage.setItem('casecoach.requestedAccountType', accountType);
    else accountType = sessionStorage.getItem('casecoach.requestedAccountType');
  } catch { /* Account type remains a display hint for this session. */ }
  const displayName = user.name || user.nickname || user.email || 'CaseCoach learner';
  const initials = displayName.split(/\s+/).slice(0, 2).map(part => part.charAt(0)).join('').toUpperCase();
  document.getElementById('topAccountAvatar').textContent = initials;
  document.getElementById('menuAccountAvatar').textContent = initials;
  document.getElementById('menuAccountName').textContent = displayName;
  document.getElementById('menuAccountSubtext').textContent = accountType === 'faculty' ? 'Faculty access pending' : accountType === 'student' ? 'Student account' : user.email || 'Signed in';
  document.getElementById('settingsDisplayName').textContent = displayName;
  document.getElementById('settingsEmail').textContent = user.email || 'Signed in with Auth0';
  document.getElementById('settingsAccountType').textContent = accountType === 'faculty' ? 'Faculty signup · access pending verification' : accountType === 'student' ? 'Student signup' : 'Account type managed by your institution';
  setActiveLearningSpace(readSavedLearningSpace());
  authScreen.classList.add('hidden');
  appShell.classList.remove('hidden');
  logoutButton.classList.remove('hidden');
  logoutButton.textContent = 'Sign out';
  refreshCurrentPage();
}

function showDemoPreview() {
  demoPreviewActive = true;
  currentAuthUser = null;
  activeLearnerKey = 'demo';
  document.getElementById('topAccountAvatar').textContent = 'DP';
  document.getElementById('menuAccountAvatar').textContent = 'DP';
  document.getElementById('menuAccountName').textContent = 'Demo learner';
  document.getElementById('menuAccountSubtext').textContent = 'Unauthenticated preview';
  document.getElementById('settingsDisplayName').textContent = 'Demo learner';
  document.getElementById('settingsEmail').textContent = 'Demo account · not signed in';
  document.getElementById('settingsAccountType').textContent = 'Student demo';
  setActiveLearningSpace(readSavedLearningSpace());
  authScreen.classList.add('hidden');
  appShell.classList.remove('hidden');
  logoutButton.classList.remove('hidden');
  logoutButton.textContent = 'Exit preview';
  refreshCurrentPage();
}

document.getElementById('previewDemo').addEventListener('click', showDemoPreview);
logoutButton.addEventListener('click', () => {
  closeProfileMenu();
  if (demoPreviewActive) {
    demoPreviewActive = false;
    appShell.classList.add('hidden');
    authScreen.classList.remove('hidden');
    logoutButton.classList.add('hidden');
    return;
  }
  try { sessionStorage.removeItem('casecoach.requestedAccountType'); } catch { /* Ignore unavailable session storage. */ }
  if (authClient) authClient.logout({ logoutParams: { returnTo: window.location.origin } });
});

function beginSignup(accountType) {
  if (!authClient) return;
  authClient.loginWithRedirect({
    appState: { casecoachAccountType: accountType },
    authorizationParams: { screen_hint: 'signup' }
  }).catch(error => {
    console.error('Auth0 sign up failed', error);
    authStatus.textContent = `${accountType === 'faculty' ? 'Faculty' : 'Student'} account creation could not start. Check your connection and Auth0 settings.`;
  });
}

const authConfigured = authConfig.domain && authConfig.clientId &&
  !/YOUR_AUTH0_DOMAIN|YOUR_AUTH0_CLIENT_ID/.test(`${authConfig.domain} ${authConfig.clientId}`);

if (!authConfigured) {
  authStatus.textContent = 'Add your Auth0 tenant domain and SPA client ID to auth-config.js to enable secure sign in.';
  const authSetupMessage = 'Auth0 is not configured yet. Add your tenant domain and SPA client ID in auth-config.js.';
  signInButton.addEventListener('click', () => { authStatus.textContent = authSetupMessage; });
  studentSignUpButton.addEventListener('click', () => { authStatus.textContent = authSetupMessage; });
  facultySignUpButton.addEventListener('click', () => { authStatus.textContent = `${authSetupMessage} Faculty access also needs approval by your institution.`; });
} else if (!window.auth0?.createAuth0Client) {
  authStatus.textContent = 'Auth0 could not load. Check your network connection and reload this page.';
  signInButton.disabled = true;
  studentSignUpButton.disabled = true;
  facultySignUpButton.disabled = true;
} else {
  demoAccess.classList.add('hidden');
  signInButton.disabled = true;
  studentSignUpButton.disabled = true;
  facultySignUpButton.disabled = true;
  authStatus.textContent = 'Connecting securely to Auth0…';
  (async () => {
    try {
      authClient = await window.auth0.createAuth0Client({
        domain: authConfig.domain,
        clientId: authConfig.clientId,
        authorizationParams: { redirect_uri: window.location.origin }
      });
      let callbackState = null;
      if (window.location.search.includes('code=') && window.location.search.includes('state=')) {
        callbackState = await authClient.handleRedirectCallback();
        window.history.replaceState({}, document.title, window.location.pathname);
      }
      if (await authClient.isAuthenticated()) {
        showAuthenticatedApp(await authClient.getUser(), callbackState?.appState?.casecoachAccountType || null);
      } else {
        authStatus.textContent = 'Sign in or create an account to continue to your learning space.';
        signInButton.disabled = false;
        studentSignUpButton.disabled = false;
        facultySignUpButton.disabled = false;
      }
    } catch (error) {
      console.error('Auth0 initialization failed', error);
      signInButton.disabled = false;
      studentSignUpButton.disabled = false;
      facultySignUpButton.disabled = false;
      authStatus.textContent = 'Could not complete sign in. Check your Auth0 settings and allowed callback URLs, then try again.';
    }
  })();
  signInButton.addEventListener('click', async () => {
    try { await authClient.loginWithRedirect(); }
    catch (error) {
      console.error('Auth0 sign in failed', error);
      authStatus.textContent = 'Sign in could not start. Check your connection and Auth0 settings.';
    }
  });
  studentSignUpButton.addEventListener('click', () => beginSignup('student'));
  facultySignUpButton.addEventListener('click', () => beginSignup('faculty'));
}
