/* ═══════════════════════════════════════════════════════
   SafeSync — app.js
   전체 인터랙션, 데이터, AI 연동, DR Failover 시연
   ═══════════════════════════════════════════════════════ */

'use strict';

// ─────────────────────────────────────
// 백엔드 API 연동 설정
// ─────────────────────────────────────
// 로컬 개발: http://localhost:8000
// 서버 배포 시: 서버 IP 또는 도메인으로 변경
const API_BASE = 'http://localhost:8000';
let AUTH_TOKEN = null;   // 로그인 후 저장

async function apiCall(method, path, body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (AUTH_TOKEN) headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : null,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return await res.json();
  } catch (e) {
    // 네트워크 오류 시 로컬 데이터 폴백
    console.warn(`[API] ${method} ${path} 실패 (폴백 모드):`, e.message);
    return null;
  }
}

// ─────────────────────────────────────
// 0. 샘플 데이터
// ─────────────────────────────────────
const DISASTERS = [
  {
    id: 1,
    type: 'CHEMICAL',
    typeLabel: '화학 누출',
    typeEmoji: '☣️',
    title: '경기 수원시 영통구 아파트 단지 가스 누출',
    description: '영통구 매탄동 소재 대형 아파트 단지 지하 가스관 파손으로 LPG 누출이 확인되었습니다. 소방서와 가스안전공사가 현장 대응 중이며, 반경 500m 이내 주민은 즉시 대피 바랍니다.',
    region: '경기 수원시 영통구',
    severity: 'CRITICAL',
    status: 'ACTIVE',
    time: '15:12',
    aiGuide: '1. 즉시 창문을 열고 환기하십시오.\n2. 가스 밸브를 잠그고 전기 스위치를 건드리지 마십시오.\n3. 엘리베이터를 이용하지 말고 계단으로 건물 밖으로 대피하십시오.\n4. 안전한 곳으로 이동 후 119에 신고하십시오.\n5. 불꽃이나 점화장치를 사용하지 마십시오.'
  },
  {
    id: 2,
    type: 'FLOOD',
    typeLabel: '홍수/침수',
    typeEmoji: '🌊',
    title: '서울 마포구 홍수 경보 — 한강 수위 위험 수준',
    description: '집중호우로 인해 한강 수위가 위험 수위를 초과했습니다. 마포구 한강 인근 저지대 침수가 진행 중이며, 합정동, 망원동 일대 주민 대피 권고 중입니다.',
    region: '서울 마포구',
    severity: 'CRITICAL',
    status: 'ACTIVE',
    time: '14:58',
    aiGuide: '1. 지하층 및 반지하에 계신 분은 즉시 높은 곳으로 이동하십시오.\n2. 하천변, 저지대, 침수 위험 지역을 즉시 벗어나십시오.\n3. 하수구나 맨홀 근처를 피하십시오.\n4. 침수된 도로는 절대 통행하지 마십시오.\n5. 가까운 대피소로 이동 후 가족에게 연락하십시오.'
  },
  {
    id: 3,
    type: 'FIRE',
    typeLabel: '산불',
    typeEmoji: '🔥',
    title: '강원 속초시 설악산 인근 산불 2단계',
    description: '강원 속초시 설악산 국립공원 인근에서 산불이 발생하여 소방 2단계 대응 중입니다. 건조한 날씨와 강풍으로 인해 빠르게 확산되고 있습니다.',
    region: '강원 속초시',
    severity: 'HIGH',
    status: 'ACTIVE',
    time: '13:40',
    aiGuide: '1. 산불 발생 지역에서 즉시 바람이 불어오는 반대 방향으로 대피하십시오.\n2. 연기를 마시지 않도록 입과 코를 젖은 천으로 막으십시오.\n3. 차량으로 대피 시 창문을 닫고 에어컨은 내부 순환 모드로 설정하십시오.\n4. 지정된 대피소로 이동하십시오.\n5. 불가피한 상황에서는 불이 타고 지나간 곳으로 대피하십시오.'
  },
  {
    id: 4,
    type: 'TYPHOON',
    typeLabel: '태풍',
    typeEmoji: '🌀',
    title: '부산·경남 태풍 "카눈" 직접 영향권 진입',
    description: '제6호 태풍 카눈이 부산에 상륙 예정입니다. 최대 풍속 45m/s, 파고 7m 이상이 예상되며 해안가 접근 금지 및 비닐하우스 사전 고정 조치가 필요합니다.',
    region: '부산·경남 전역',
    severity: 'HIGH',
    status: 'ACTIVE',
    time: '12:30',
    aiGuide: '1. 외출을 삼가고 튼튼한 건물 안에 머무르십시오.\n2. 노후 주택이나 반지하 거주자는 사전에 대피소로 이동하십시오.\n3. 간판, 유리창, 외벽 시설물에서 멀리하십시오.\n4. 해안가, 하천변 접근을 금지하십시오.\n5. 비상용품(물, 식량, 손전등, 구급약)을 미리 준비하십시오.'
  },
  {
    id: 5,
    type: 'FLOOD',
    typeLabel: '침수',
    typeEmoji: '🌊',
    title: '전북 전주시 일부 도로 침수',
    description: '집중호우로 전주시 효자동, 삼천동 일대 도로 침수가 확인되었습니다. 차량 통행 시 주의가 필요합니다.',
    region: '전북 전주시',
    severity: 'MEDIUM',
    status: 'ACTIVE',
    time: '11:15',
    aiGuide: '1. 침수된 도로는 우회하십시오.\n2. 차량 운행 중 침수 구간에 진입했다면 즉시 차에서 나와 높은 곳으로 대피하십시오.\n3. 지하주차장 진입을 자제하십시오.\n4. 기상청 및 지자체 안전 안내 문자를 수시로 확인하십시오.'
  }
];

const SHELTERS = [
  { id: 1, name: '영통구청 민방위 대피소', address: '경기 수원시 영통구 영통로 224', capacity: 800, current: 342, status: 'OPEN', region: '경기 수원' },
  { id: 2, name: '망원동 주민센터 임시 대피소', address: '서울 마포구 월드컵로 190', capacity: 500, current: 498, status: 'FULL', region: '서울 마포' },
  { id: 3, name: '합정역 지하 대피소', address: '서울 마포구 합정역 3번 출구', capacity: 1200, current: 670, status: 'OPEN', region: '서울 마포' },
  { id: 4, name: '속초고등학교 임시 대피소', address: '강원 속초시 청초호반로 56', capacity: 600, current: 230, status: 'OPEN', region: '강원 속초' },
  { id: 5, name: '해운대구 민방위 대피소', address: '부산 해운대구 해운대로 875', capacity: 2000, current: 1100, status: 'OPEN', region: '부산 해운대' },
  { id: 6, name: '전주종합경기장 임시 대피소', address: '전북 전주시 덕진구 백제대로 900', capacity: 5000, current: 120, status: 'OPEN', region: '전북 전주' },
  { id: 7, name: '수원월드컵경기장 광역 대피소', address: '경기 수원시 팔달구 월드컵로 310', capacity: 10000, current: 2400, status: 'OPEN', region: '경기 수원' },
  { id: 8, name: '부산시민공원 야외 대피소', address: '부산 부산진구 시민공원로 73', capacity: 8000, current: 3100, status: 'OPEN', region: '부산 부산진' },
  { id: 9, name: '강릉아레나 임시 대피소', address: '강원 강릉시 종합운동장길 33', capacity: 3000, current: 0, status: 'CLOSED', region: '강원 강릉' }
];

// ─────────────────────────────────────
// 1. 앱 상태
// ─────────────────────────────────────
const state = {
  disasters: [...DISASTERS],
  shelters: [...SHELTERS],
  currentFilter: 'all',
  selectedType: null,
  selectedRegions: [],
  isAdminLoggedIn: false,
  drMode: 'normal', // 'normal' | 'failover' | 'failback'
  // 클라우드 상태 시뮬레이션
  ncp: { online: true, cpu: 23, latency: 45, traffic: 100 },
  aws: { online: true, cpu: 3, lag: 0.3, traffic: 0 }
};

// ─────────────────────────────────────
// 2. DOM 헬퍼
// ─────────────────────────────────────
const $ = id => document.getElementById(id);
const formatTime = () => {
  const now = new Date();
  return `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
};

function showToast(msg, type = 'info', duration = 4000) {
  const container = $('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'fadeIn 0.3s ease reverse';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function addLog(msg, type = 'info') {
  const logContent = $('dr-log-content');
  if (!logContent) return;
  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  line.textContent = `[${new Date().toLocaleString('ko-KR')}] ${msg}`;
  logContent.appendChild(line);
  logContent.scrollTop = logContent.scrollHeight;
}

// ─────────────────────────────────────
// 3. 네비게이션
// ─────────────────────────────────────
function initNav() {
  const links = document.querySelectorAll('.nav-link');
  links.forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const targetId = link.getAttribute('href').replace('#', '');
      navigateTo(targetId);
    });
  });
}

function navigateTo(sectionId) {
  // 섹션 전환
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  const target = $(sectionId);
  if (target) target.classList.add('active');

  // 네비 활성
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  const activeLink = $(`nav-${sectionId}`);
  if (activeLink) activeLink.classList.add('active');

  // 관리자 진입 시 로그인 확인
  if (sectionId === 'admin' && !state.isAdminLoggedIn) {
    $('admin-login-wall').classList.remove('hidden');
    $('admin-console').classList.add('hidden');
  }
}

// ─────────────────────────────────────
// 4. 재난 목록 렌더링
// ─────────────────────────────────────
function renderDisasters() {
  const list = $('disaster-list');
  const filter = state.currentFilter;
  const filtered = filter === 'all'
    ? state.disasters
    : state.disasters.filter(d => d.severity === filter);

  if (filtered.length === 0) {
    list.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-muted)">해당 조건의 재난이 없습니다</div>`;
    return;
  }

  list.innerHTML = filtered.map(d => `
    <div class="disaster-card severity-${d.severity}" data-id="${d.id}" onclick="openDetailModal(${d.id})">
      <div class="disaster-card-top">
        <div class="disaster-card-title">${d.typeEmoji} ${d.title}</div>
        <span class="severity-badge ${d.severity}">${severityLabel(d.severity)}</span>
      </div>
      <div class="disaster-card-meta">
        <span>📍 ${d.region}</span>
        <span>🕐 오늘 ${d.time}</span>
        <span>${d.typeLabel}</span>
      </div>
    </div>
  `).join('');
}

function severityLabel(s) {
  return { CRITICAL: '🔴 심각', HIGH: '🟠 경보', MEDIUM: '🟡 주의', LOW: '🟢 정보' }[s] || s;
}

function initFilterTabs() {
  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.currentFilter = tab.dataset.filter;
      renderDisasters();
    });
  });
}

// ─────────────────────────────────────
// 5. 재난 상세 모달
// ─────────────────────────────────────
function openDetailModal(id) {
  const d = state.disasters.find(x => x.id === id);
  if (!d) return;

  $('detail-modal-title').textContent = `${d.typeEmoji} ${d.typeLabel} 상세 정보`;

  const severityColors = {
    CRITICAL: 'background:rgba(255,59,59,0.2);color:#ff3b3b',
    HIGH:     'background:rgba(255,140,0,0.2);color:#ff8c00',
    MEDIUM:   'background:rgba(255,193,7,0.2);color:#ffc107'
  };

  $('detail-modal-content').innerHTML = `
    <span class="detail-type-badge" style="${severityColors[d.severity] || ''};padding:0.3rem 1rem;border-radius:100px;font-weight:700;font-size:0.8rem">
      ${severityLabel(d.severity)}
    </span>
    <h3 style="font-size:1rem;font-weight:700;margin-bottom:0.75rem">${d.title}</h3>
    <p class="detail-desc">${d.description}</p>
    <div class="detail-meta-grid">
      <div class="detail-meta-item"><div class="detail-meta-label">발생 지역</div><div class="detail-meta-value">📍 ${d.region}</div></div>
      <div class="detail-meta-item"><div class="detail-meta-label">신고 시각</div><div class="detail-meta-value">🕐 오늘 ${d.time}</div></div>
      <div class="detail-meta-item"><div class="detail-meta-label">재난 유형</div><div class="detail-meta-value">${d.typeEmoji} ${d.typeLabel}</div></div>
      <div class="detail-meta-item"><div class="detail-meta-label">현재 상태</div><div class="detail-meta-value" style="color:var(--accent-red)">● 대응 중</div></div>
    </div>
    <div class="detail-ai-guide">
      <div class="detail-ai-label">🤖 CLOVA AI 행동 요령</div>
      <div class="detail-ai-text">${d.aiGuide.split('\n').map(l => `<p style="margin-bottom:0.4rem">${l}</p>`).join('')}</div>
    </div>
  `;
  $('detail-modal-overlay').classList.remove('hidden');
}

function initDetailModal() {
  $('close-detail-modal').addEventListener('click', () => {
    $('detail-modal-overlay').classList.add('hidden');
  });
  $('detail-modal-overlay').addEventListener('click', e => {
    if (e.target === $('detail-modal-overlay')) $('detail-modal-overlay').classList.add('hidden');
  });
}

// ─────────────────────────────────────
// 6. 재난 신고 모달
// ─────────────────────────────────────
function initReportModal() {
  $('open-report-modal').addEventListener('click', () => {
    $('report-modal-overlay').classList.remove('hidden');
  });
  $('close-report-modal').addEventListener('click', () => {
    $('report-modal-overlay').classList.add('hidden');
  });
  $('modal-cancel-btn').addEventListener('click', () => {
    $('report-modal-overlay').classList.add('hidden');
  });
  $('report-modal-overlay').addEventListener('click', e => {
    if (e.target === $('report-modal-overlay')) $('report-modal-overlay').classList.add('hidden');
  });

  // 유형 칩 선택
  document.querySelectorAll('.type-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.type-chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      state.selectedType = chip.dataset.type;
    });
  });

  // 신고 폼 제출
  $('report-form').addEventListener('submit', e => {
    e.preventDefault();
    const title = $('report-title').value.trim();
    const desc  = $('report-desc').value.trim();
    const region = $('report-region').value.trim();
    const severity = $('report-severity').value;
    if (!title || !region || !state.selectedType) {
      showToast('유형, 제목, 지역은 필수 입력 항목입니다.', 'error');
      return;
    }
    const typeMap = {
      FIRE: { label: '화재', emoji: '🔥' },
      FLOOD: { label: '홍수/침수', emoji: '🌊' },
      EARTHQUAKE: { label: '지진', emoji: '🌍' },
      CHEMICAL: { label: '화학 누출', emoji: '☣️' },
      TYPHOON: { label: '태풍', emoji: '🌀' },
      OTHER: { label: '기타', emoji: '⚠️' }
    };
    const t = typeMap[state.selectedType] || { label: '기타', emoji: '⚠️' };
    const newDisaster = {
      id: Date.now(),
      type: state.selectedType,
      typeLabel: t.label,
      typeEmoji: t.emoji,
      title,
      description: desc || '현장 조사 중입니다.',
      region,
      severity,
      status: 'ACTIVE',
      time: `${String(new Date().getHours()).padStart(2,'0')}:${String(new Date().getMinutes()).padStart(2,'0')}`,
      aiGuide: '현재 AI 행동 요령 분석 중입니다. 잠시 후 업데이트됩니다.'
    };
    state.disasters.unshift(newDisaster);
    renderDisasters();
    renderAdminTable();
    updateStats();
    $('report-modal-overlay').classList.add('hidden');
    $('report-form').reset();
    state.selectedType = null;
    document.querySelectorAll('.type-chip').forEach(c => c.classList.remove('selected'));
    showToast(`✅ 재난 신고가 접수되었습니다: ${title}`, 'success');
  });
}

// ─────────────────────────────────────
// 7. 대피소 렌더링
// ─────────────────────────────────────
function renderShelters(keyword = '') {
  const grid = $('shelter-grid');
  const list = keyword
    ? state.shelters.filter(s => s.name.includes(keyword) || s.address.includes(keyword) || s.region.includes(keyword))
    : state.shelters;

  grid.innerHTML = list.map(s => {
    const pct = Math.round((s.current / s.capacity) * 100);
    const fillClass = pct >= 90 ? 'high' : pct >= 60 ? 'medium' : 'low';
    const statusLabels = { OPEN: '운영 중', FULL: '수용 완료', CLOSED: '운영 종료' };
    return `
      <div class="shelter-card">
        <div class="shelter-card-header">
          <div class="shelter-name">${s.name}</div>
          <span class="shelter-status-badge ${s.status}">${statusLabels[s.status]}</span>
        </div>
        <div class="shelter-address">📍 ${s.address}</div>
        <div class="shelter-capacity-bar-wrap">
          <div class="shelter-capacity-label">
            <span>수용 현황</span>
            <span><strong>${s.current.toLocaleString()}</strong> / ${s.capacity.toLocaleString()}명 (${pct}%)</span>
          </div>
          <div class="shelter-bar">
            <div class="shelter-bar-fill ${fillClass}" style="width:${pct}%"></div>
          </div>
        </div>
      </div>
    `;
  }).join('') || `<div style="color:var(--text-muted);padding:2rem;grid-column:1/-1;text-align:center">검색 결과가 없습니다.</div>`;
}

function initShelterSearch() {
  $('shelter-search').addEventListener('input', e => {
    renderShelters(e.target.value.trim());
  });
}

// ─────────────────────────────────────
// 8. AI 행동 요령 생성 (CLOVA Studio 시뮬레이션)
// ─────────────────────────────────────
const AI_RESPONSES = {
  '화재': ['즉시 화재경보기를 울리십시오.', '젖은 수건으로 코와 입을 막고 낮은 자세로 대피하십시오.', '엘리베이터 사용을 금지하고 비상구 계단을 이용하십시오.', '문손잡이가 뜨거우면 문을 열지 마십시오.', '119에 신고 후 안전한 장소에서 대기하십시오.'],
  '지진': ['책상 아래나 튼튼한 구조물 옆에 엎드려 머리를 보호하십시오.', '흔들림이 멈출 때까지 이동을 자제하십시오.', '가스 밸브를 잠그고 전기를 차단하십시오.', '건물 밖으로 나갈 때는 낙하물에 주의하십시오.', '야외에서는 건물, 전신주, 담장에서 멀리 이동하십시오.'],
  '홍수': ['즉시 높은 지대로 이동하십시오.', '하수구, 맨홀, 침수 도로 접근을 금지하십시오.', '전기 제품 및 가스 기기 사용을 중단하십시오.', '차량은 침수 지역에 주차하지 마십시오.', '기상청 재난 문자를 수시로 확인하십시오.'],
  '가스': ['즉시 가스 밸브를 잠그십시오.', '전기 스위치를 건드리지 마십시오.', '창문을 열어 환기하십시오.', '엘리베이터를 이용하지 말고 계단으로 대피하십시오.', '119 및 한국가스안전공사(1544-4500)에 신고하십시오.'],
  '태풍': ['외출을 삼가고 실내에 머무르십시오.', '창문을 테이프 등으로 보강하십시오.', '침수 위험 지역 주민은 사전 대피소로 이동하십시오.', '해안가 및 하천변 접근을 금지하십시오.', '비상용품을 미리 준비하십시오.'],
  '산불': ['바람 반대 방향으로 신속히 대피하십시오.', '연기를 피해 낮은 자세로 이동하십시오.', '젖은 수건으로 코와 입을 막으십시오.', '119 산림청 헬기 요청을 위해 주변 공터로 이동하십시오.', '차량으로 대피 시 창문을 닫고 실내 순환 모드를 사용하십시오.']
};

function getAIResponse(situation) {
  const keys = Object.keys(AI_RESPONSES);
  const matched = keys.find(k => situation.includes(k));
  if (matched) return AI_RESPONSES[matched];

  // 기본 응답
  return [
    '안전한 장소로 즉시 이동하십시오.',
    '주변 사람들에게 위험 상황을 알리십시오.',
    '119에 신고하고 지시에 따르십시오.',
    '귀중품보다 인명 대피를 우선하십시오.',
    '재난 문자 및 공식 기관의 안내를 확인하십시오.'
  ];
}

function initAI() {
  $('ai-generate-btn').addEventListener('click', async () => {
    const input = $('ai-situation-input').value.trim();
    if (!input) {
      showToast('상황을 입력해주세요.', 'warning');
      return;
    }
    const btn = $('ai-generate-btn');
    btn.classList.add('loading');
    btn.querySelector('.btn-text').textContent = '분석 중...';
    $('ai-result').innerHTML = `
      <div style="text-align:center;padding:2rem;color:var(--accent-cyan)">
        <div style="font-size:2rem;animation:spin 1s linear infinite;display:inline-block">⏳</div>
        <p style="margin-top:1rem;font-size:0.88rem">CLOVA Studio가 상황을 분석하고 있습니다...</p>
      </div>
      <style>@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}</style>
    `;

    // 실제 백엔드 API 호출 시도
    let steps = null;
    let model = 'rule-based-fallback';
    const apiResult = await apiCall('POST', '/ai/guide', { situation: input });
    if (apiResult && apiResult.steps) {
      steps = apiResult.steps;
      model = apiResult.model;
    } else {
      // API 연결 실패 시 로컈 폴백
      await new Promise(r => setTimeout(r, 1200));
      steps = getAIResponse(input);
    }

    $('ai-result').innerHTML = `
      <div class="ai-result-content">
        <div class="ai-result-label">🤖 AI 행동 요령 — "${input}"</div>
        <ol class="ai-result-steps">
          ${steps.map(s => `<li>${s}</li>`).join('')}
        </ol>
        <p style="font-size:0.72rem;color:var(--text-muted);margin-top:1rem">
          ⚡ Powered by ${model === 'HCX-003' ? 'CLOVA Studio HCX-003 (NCP)' : 'CLOVA Studio (Rule-based)'} | 생성 시각: ${formatTime()}
        </p>
      </div>
    `;
    btn.classList.remove('loading');
    btn.querySelector('.btn-text').textContent = 'AI 안내 생성';
    showToast('✅ AI 행동 요령이 생성되었습니다.', 'success');
  });

  // Enter 키로도 생성
  $('ai-situation-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('ai-generate-btn').click();
  });
}

// ─────────────────────────────────────
// 9. 구독 폼
// ─────────────────────────────────────
function initSubscribe() {
  // 지역 칩 선택
  document.querySelectorAll('.region-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      chip.classList.toggle('selected');
      const region = chip.dataset.region;
      if (chip.classList.contains('selected')) {
        state.selectedRegions.push(region);
      } else {
        state.selectedRegions = state.selectedRegions.filter(r => r !== region);
      }
    });
  });

  $('subscribe-form').addEventListener('submit', e => {
    e.preventDefault();
    const email = $('sub-email').value.trim();
    if (!email) { showToast('이메일을 입력해주세요.', 'error'); return; }
    if (state.selectedRegions.length === 0) { showToast('관심 지역을 선택해주세요.', 'error'); return; }

    $('subscribe-form').classList.add('hidden');
    $('subscribe-success').classList.remove('hidden');
    showToast(`✅ ${email} 구독 완료! (지역: ${state.selectedRegions.join(', ')})`, 'success', 5000);
  });
}

// ─────────────────────────────────────
// 10. 관리자 로그인
// ─────────────────────────────────────
function initAdminLogin() {
  $('admin-login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const id = $('admin-id').value.trim();
    const pw = $('admin-pw').value.trim();

    // 실제 백엔드 JWT 로그인 시도
    const result = await apiCall('POST', '/auth/login', { admin_id: id, password: pw });
    if (result && result.access_token) {
      AUTH_TOKEN = result.access_token;
      state.isAdminLoggedIn = true;
      $('admin-login-wall').classList.add('hidden');
      $('admin-console').classList.remove('hidden');
      renderAdminTable();
      showToast('✅ 관리자 콘솔에 로그인했습니다.', 'success');
      addLog('✅ 관리자 콘솔 접속 완료 (JWT 인증)', 'info');
      // DR 실시간 상태 폸링 시작
      startCloudStatusPolling();
    } else if (id === 'admin' && pw === 'safesync2024') {
      // 백엔드 미연결 시 로컈 폴백
      state.isAdminLoggedIn = true;
      $('admin-login-wall').classList.add('hidden');
      $('admin-console').classList.remove('hidden');
      renderAdminTable();
      showToast('✅ 관리자 콘솔에 로그인했습니다. (로컈 모드)', 'success');
      addLog('✅ 관리자 콘솔 접속 완료 (로컈 모드)', 'info');
    } else {
      showToast('❌ 로그인 정보가 올바르지 않습니다.', 'error');
    }
  });
}

// 백엔드 DR 상태 폰링 (30초마다)
function startCloudStatusPolling() {
  setInterval(async () => {
    if (!state.isAdminLoggedIn || state.drMode !== 'normal') return;
    const status = await apiCall('GET', '/system/status');
    if (!status) return;
    // NCP 지표 업데이트
    if ($('ncp-cpu') && status.ncp.cpu_usage !== null) {
      $('ncp-cpu').textContent = status.ncp.cpu_usage + '%';
    }
    if ($('ncp-latency') && status.ncp.latency_ms !== null) {
      $('ncp-latency').textContent = Math.round(status.ncp.latency_ms) + 'ms';
    }
    // AWS Replication Lag
    if ($('aws-lag') && status.aws.replication_lag_s !== null) {
      $('aws-lag').textContent = status.aws.replication_lag_s + 's';
    }
  }, 30000);
}

// ─────────────────────────────────────
// 11. 관리자 테이블
// ─────────────────────────────────────
function renderAdminTable() {
  const tbody = $('admin-table-body');
  if (!tbody) return;
  const typeLabels = { FIRE:'🔥 화재', FLOOD:'🌊 홍수', EARTHQUAKE:'🌍 지진', CHEMICAL:'☣️ 화학', TYPHOON:'🌀 태풍', OTHER:'⚠️ 기타' };
  tbody.innerHTML = state.disasters.map(d => `
    <tr>
      <td style="color:var(--text-muted)">#${d.id}</td>
      <td>${typeLabels[d.type] || d.type}</td>
      <td>${d.region}</td>
      <td><span class="severity-badge ${d.severity}" style="display:inline-block">${severityLabel(d.severity)}</span></td>
      <td style="color:${d.status==='ACTIVE'?'var(--accent-red)':'var(--accent-green)'}">${d.status==='ACTIVE'?'● 대응 중':'✓ 종료'}</td>
      <td style="color:var(--text-muted)">오늘 ${d.time}</td>
      <td>${d.status==='ACTIVE'?`<button class="resolve-btn" onclick="resolveDisaster(${d.id})">해제</button>`:'-'}</td>
    </tr>
  `).join('');
}

window.resolveDisaster = function(id) {
  const d = state.disasters.find(x => x.id === id);
  if (d) {
    d.status = 'RESOLVED';
    renderDisasters();
    renderAdminTable();
    updateStats();
    showToast(`✅ 재난 "${d.title.slice(0,20)}..." 이 해제되었습니다.`, 'success');
    addLog(`✅ 재난 해제: ${d.title.slice(0,30)}`, 'info');
  }
};

function initAdminTools() {
  $('btn-add-disaster').addEventListener('click', () => {
    navigateTo('dashboard');
    setTimeout(() => $('open-report-modal').click(), 100);
  });
  $('btn-resolve-all').addEventListener('click', () => {
    state.disasters.forEach(d => d.status = 'RESOLVED');
    renderDisasters();
    renderAdminTable();
    updateStats();
    showToast('✅ 모든 재난이 해제되었습니다.', 'success');
    addLog('✅ 전체 재난 해제 처리', 'info');
  });
}

// ─────────────────────────────────────
// 12. DR Failover 시연 ← 핵심 기능!
// ─────────────────────────────────────
window.triggerFailover = async function() {
  if (state.drMode !== 'normal') return;
  state.drMode = 'failover';

  const btnFailover = $('btn-failover');
  const btnRecover  = $('btn-recover');
  btnFailover.disabled = true;

  showToast('⚠️ NCP Primary 장애 시나리오 시작!', 'warning', 6000);

  // Step 1: NCP 장애 발생
  addLog('🔴 [장애 감지] NCP Primary 서버 응답 없음', 'error');
  await delay(1200);
  addLog('🔴 [장애 감지] Route 53 Health Check FAILED — NCP (timeout)', 'error');
  await delay(800);

  // NCP 카드 오프라인으로
  $('ncp-cloud-card').classList.add('offline');
  $('ncp-status-badge').className = 'cloud-status-badge offline';
  $('ncp-status-badge').textContent = '● OFFLINE';
  $('ncp-was').textContent = '0 / 2 (장애)';
  $('ncp-was').className = 'metric-val red';
  $('ncp-db').textContent = '접근 불가';
  $('ncp-db').className = 'metric-val red';
  $('ncp-cpu').textContent = '-';
  $('ncp-latency').textContent = 'Timeout';
  $('ncp-traffic').textContent = '0%';
  $('ncp-health-fill').style.width = '0%';

  // 헤더 배지 변경
  $('cloud-badge-primary').className = 'cloud-badge aws-active';
  $('cloud-badge-primary').querySelector('.badge-text').textContent = 'AWS DR (Failover)';

  await delay(1500);
  addLog('⚡ [DR 개시] AWS RDS Slave → Master 승격 중...', 'action');
  await delay(1200);

  // Step 2: AWS Failover
  addLog('✅ [DR 완료] AWS RDS Slave → Master 승격 완료 (데이터 유실 없음)', 'info');
  addLog('⚡ [DNS 전환] Route 53 Failover Routing → AWS ALB 엔드포인트로 전환 중...', 'action');
  await delay(1000);
  addLog('✅ [DNS 완료] 트래픽 100% AWS로 전환 완료', 'info');

  // AWS 카드 업데이트
  $('aws-status-badge').className = 'cloud-status-badge online';
  $('aws-status-badge').textContent = '● ACTIVE';
  $('aws-cloud-card').querySelector('.cloud-role-badge').textContent = 'PRIMARY (DR ACTIVE)';
  $('aws-cloud-card').querySelector('.cloud-role-badge').className = 'cloud-role-badge active';
  $('aws-was').textContent = '2 / 2 가동 중';
  $('aws-db').textContent = '정상 (R/W — Master)';
  $('aws-db').className = 'metric-val green';
  $('aws-cpu').textContent = '67%';
  $('aws-lag').textContent = '0ms';
  $('aws-traffic').textContent = '100%';
  $('aws-health-fill').style.width = '100%';

  // 화살표 레이블
  $('arrow-label').textContent = '🔄 FAILOVER 완료';
  $('arrow-label').style.color = 'var(--accent-orange)';

  // DR 상태 표시
  $('dr-status-indicator').querySelector('.dr-dot').className = 'dr-dot red-dot';
  $('dr-status-text').textContent = '🚨 DR 모드 — AWS Failover Active';

  // Footer 업데이트
  $('footer-cloud-info').textContent = '현재 서빙: AWS DR (Failover)';
  $('footer-cloud-info').style.color = 'var(--aws-color)';

  // 버튼 전환
  btnFailover.classList.add('hidden');
  btnRecover.classList.remove('hidden');

  showToast('✅ Failover 완료! AWS DR 환경에서 서비스가 지속됩니다.', 'success', 6000);
};

window.triggerRecover = async function() {
  if (state.drMode !== 'failover') return;
  state.drMode = 'failback';

  const btnRecover = $('btn-recover');
  const btnFailover = $('btn-failover');
  btnRecover.disabled = true;

  showToast('🔧 NCP Primary 복구 작업 시작...', 'info', 4000);

  addLog('🔧 [복구] NCP 서버 재시작 중...', 'warn');
  await delay(1500);
  addLog('✅ [복구] NCP WAS 서버 정상 가동 확인', 'info');
  addLog('🔧 [복구] NCP DB Replication 재동기화 중...', 'warn');
  await delay(1200);
  addLog('✅ [복구] DB 데이터 동기화 완료 (AWS Master → NCP Slave)', 'info');
  addLog('⚡ [Failback] 트래픽을 NCP Primary로 복구 중...', 'action');
  await delay(1000);
  addLog('✅ [Failback 완료] 서비스 정상화 — NCP Primary Active', 'info');

  // UI 복구
  $('ncp-cloud-card').classList.remove('offline');
  $('ncp-status-badge').className = 'cloud-status-badge online';
  $('ncp-status-badge').textContent = '● ONLINE';
  $('ncp-was').textContent = '2 / 2 가동 중';
  $('ncp-was').className = 'metric-val';
  $('ncp-db').textContent = '정상 (R/W)';
  $('ncp-db').className = 'metric-val green';
  $('ncp-cpu').textContent = '28%';
  $('ncp-latency').textContent = '47ms';
  $('ncp-traffic').textContent = '100%';
  $('ncp-health-fill').style.width = '100%';

  $('aws-status-badge').className = 'cloud-status-badge standby';
  $('aws-status-badge').textContent = '● STANDBY';
  $('aws-cloud-card').querySelector('.cloud-role-badge').textContent = 'DR BACKUP';
  $('aws-cloud-card').querySelector('.cloud-role-badge').className = 'cloud-role-badge dr';
  $('aws-was').textContent = '2 / 2 대기 중';
  $('aws-db').textContent = '복제 동기화 중';
  $('aws-db').className = 'metric-val yellow';
  $('aws-cpu').textContent = '4%';
  $('aws-lag').textContent = '0.3s';
  $('aws-traffic').textContent = '0%';
  $('aws-health-fill').style.width = '30%';

  $('arrow-label').textContent = '정상 운영 중';
  $('arrow-label').style.color = '';

  $('cloud-badge-primary').className = 'cloud-badge';
  $('cloud-badge-primary').querySelector('.badge-text').textContent = 'NCP Primary';

  $('dr-status-indicator').querySelector('.dr-dot').className = 'dr-dot green-dot';
  $('dr-status-text').textContent = '정상 운영 중 — NCP Primary Active';

  $('footer-cloud-info').textContent = '현재 서빙: NCP Primary';
  $('footer-cloud-info').style.color = '';

  btnRecover.classList.add('hidden');
  btnFailover.classList.remove('hidden');
  btnFailover.disabled = false;
  btnRecover.disabled = false;
  state.drMode = 'normal';

  showToast('✅ Failback 완료! NCP Primary가 서비스를 재개합니다.', 'success', 5000);
};

window.runHealthCheck = async function() {
  addLog('🔍 [Health Check] NCP Primary 상태 확인 중...', 'action');
  await delay(800);
  const ncpOk = state.drMode === 'normal';
  addLog(`${ncpOk ? '✅' : '🔴'} [Health Check] NCP: ${ncpOk ? 'OK ('+state.ncp.latency+'ms)' : 'FAILED'}`, ncpOk ? 'info' : 'error');
  await delay(400);
  addLog('✅ [Health Check] AWS: OK (Standby 정상)', 'info');
  await delay(400);
  addLog('✅ [Health Check] DB Replication: 동기화 정상', 'info');
  showToast('🔍 Health Check 완료', 'info');
};

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─────────────────────────────────────
// 13. 통계 업데이트
// ─────────────────────────────────────
function updateStats() {
  const active = state.disasters.filter(d => d.status === 'ACTIVE');
  $('stat-critical').textContent = active.filter(d => d.severity === 'CRITICAL').length;
  $('stat-warning').textContent  = active.filter(d => d.severity === 'HIGH').length;
  $('stat-info').textContent     = active.filter(d => d.severity === 'MEDIUM').length;
  const openShelters = state.shelters.filter(s => s.status === 'OPEN').length;
  $('stat-shelters').textContent = openShelters;
  const totalPeople = state.shelters.reduce((sum, s) => sum + s.current, 0);
  $('stat-people').textContent   = totalPeople.toLocaleString();
}

// ─────────────────────────────────────
// 14. 지도 마커 클릭
// ─────────────────────────────────────
function initMapMarkers() {
  document.querySelectorAll('.disaster-marker').forEach(marker => {
    marker.addEventListener('click', () => {
      const id = parseInt(marker.dataset.id);
      openDetailModal(id);
    });
  });
}

// ─────────────────────────────────────
// 15. 실시간 시뮬레이션 (CPU/응답속도 변동)
// ─────────────────────────────────────
function startRealtimeSimulation() {
  setInterval(() => {
    if (state.drMode !== 'normal') return;
    // NCP 지표 소폭 변동
    const ncpCpu = Math.max(15, Math.min(45, state.ncp.cpu + (Math.random() - 0.5) * 6));
    const ncpLat = Math.max(30, Math.min(80, state.ncp.latency + (Math.random() - 0.5) * 10));
    state.ncp.cpu = Math.round(ncpCpu);
    state.ncp.latency = Math.round(ncpLat);
    if ($('ncp-cpu')) $('ncp-cpu').textContent = state.ncp.cpu + '%';
    if ($('ncp-latency')) $('ncp-latency').textContent = state.ncp.latency + 'ms';

    const awsLag = Math.max(0.1, Math.min(1.0, state.aws.lag + (Math.random() - 0.5) * 0.2));
    state.aws.lag = Math.round(awsLag * 10) / 10;
    if ($('aws-lag')) $('aws-lag').textContent = state.aws.lag + 's';
  }, 3000);
}

// ─────────────────────────────────────
// 16. 앱 초기화
// ─────────────────────────────────────
function init() {
  initNav();
  renderDisasters();
  initFilterTabs();
  renderShelters();
  initShelterSearch();
  initAI();
  initSubscribe();
  initAdminLogin();
  initAdminTools();
  initReportModal();
  initDetailModal();
  initMapMarkers();
  updateStats();
  startRealtimeSimulation();

  // 기본 섹션 활성화
  navigateTo('dashboard');

  console.log('%cSafeSync 🚨 국가 재난·응급 알림 포털', 'color:#ff4444;font-size:18px;font-weight:bold');
  console.log('%c멀티 클라우드 DR 아키텍처: NCP Primary + AWS Backup', 'color:#03e099;font-size:12px');
}

document.addEventListener('DOMContentLoaded', init);
