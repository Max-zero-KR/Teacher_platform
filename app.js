    // =================================================================
    // 💡 Supabase 접속 정보 및 전역 상태
    // =================================================================
    const SB_URL = 'https://vmkfmwbzsdlietprgtyt.supabase.co';
    const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZta2Ztd2J6c2RsaWV0cHJndHl0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5MjQxMjIsImV4cCI6MjEwNTUwMDEyMn0.eqkdTi2LzOkVA715lyy2VMfiNio4umT-LwImPv7LaWQ';
    const supabaseClient = supabase.createClient(SB_URL, SB_KEY);

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
    
    let currentUser = null;
    let currentProfile = null;
    let currentCounselList = [];
    let activeClassNum = 2;
    let isGradeHeadOrAdmin = false;

    let lastGeneratedResults = [];
    let currentAlbumPhotos = [];
    let currentLightboxIdx = 0;
    let activeFolderId = null;

    let studentChartInstance = null;
    let teacherChartInstance = null;

    let currentSchedules = [];
    let activeScheduleFilter = 'all';

// [5단계 진단 알고리즘] 격차 = 내 산출내신 - 70%합격선 (등급은 낮을수록 우수)
function calculateAdmissionDiag(myScore, cutValue) {
  if (!myScore || !cutValue || isNaN(myScore) || isNaN(cutValue)) {
    return { text: '미진단', color: 'slate' };
  }
  const diff = parseFloat((parseFloat(myScore) - parseFloat(cutValue)).toFixed(2));

  // 1) 우주상향: 합격선보다 0.5등급 초과 부족 (내 점수가 +0.5 초과로 큼)
  if (diff > 0.5) {
    return { text: '우주상향', color: 'purple', diff: `+${diff}등급` };
  }
  // 2) 상향: 0.2 초과 ~ 0.5 이하 부족
  if (diff > 0.2) {
    return { text: '상향', color: 'amber', diff: `+${diff}등급` };
  }
  // 3) 소신: -0.2 ~ +0.2 이내 (적정 접전)
  if (diff >= -0.2) {
    return { text: '소신', color: 'blue', diff: `${diff > 0 ? '+' : ''}${diff}등급` };
  }
  // 4) 안정: -0.5 ~ -0.2 초과 우수 (내 점수가 더 낮음)
  if (diff >= -0.5) {
    return { text: '안정', color: 'emerald', diff: `${diff}등급` };
  }
  // 5) 과도하향: 합격선보다 0.5등급 초과 우수 (수시납치 주의)
  return { text: '과도하향', color: 'rose', diff: `${diff}등급` };
}

   // [정시 전용 5단계 진단 알고리즘] 격차 = 내 백분위 - 70%백분위컷 (높을수록 우수)
   function calculateJeongsiDiag(myPercentile, cutPercentile) {
     if (!myPercentile || !cutPercentile || isNaN(myPercentile) || isNaN(cutPercentile)) {
       return { text: '미진단', color: 'slate' };
     }
     const diff = parseFloat((parseFloat(myPercentile) - parseFloat(cutPercentile)).toFixed(2));

     if (diff < -2.0) {
       return { text: '우주상향', color: 'purple', diff: `${diff}%p` };
     }
     if (diff < -0.5) {
       return { text: '상향', color: 'amber', diff: `${diff}%p` };
     }
     if (diff <= 0.5) {
       return { text: '소신', color: 'blue', diff: `${diff > 0 ? '+' : ''}${diff}%p` };
     }
     if (diff <= 2.0) {
       return { text: '안정', color: 'emerald', diff: `+${diff}%p` };
     }
     return { text: '과도하향', color: 'rose', diff: `+${diff}%p` };
   }

    
function getDiagBadgeHtml(diag) {
  if (!diag || diag.text === '미진단') {
    return '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-500">진단대기</span>';
  }
  const colorMap = {
    purple: 'bg-purple-100 text-purple-700 border-purple-200',
    amber: 'bg-amber-100 text-amber-700 border-amber-200',
    blue: 'bg-blue-100 text-blue-700 border-blue-200',
    emerald: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    rose: 'bg-rose-100 text-rose-700 border-rose-200'
  };
  const cls = colorMap[diag.color] || 'bg-slate-100 text-slate-700 border-slate-200';
  return `<span class="px-2 py-0.5 rounded-full text-[10px] font-black border ${cls}">${diag.text}</span>`;
}

    
    function isCurrentTeacher() {
      return currentProfile && (currentProfile.role === 'teacher' || currentProfile.role === 'admin');
    }

    function toAuthEmail(rawId) {
      const clean = rawId.trim().toLowerCase();
      return clean.includes('@') ? clean : `${clean}@school.net`;
    }

    function autoDetectClassFromNo() {
      const val = document.getElementById('regStudentNo').value.trim();
      if (val.length >= 3 && val.startsWith('3')) {
        const cls = parseInt(val.substring(1, 3));
        if (cls >= 1 && cls <= 10) {
          document.getElementById('regClassNum').value = cls;
        }
      }
    }

    async function checkSession() {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (session) {
        currentUser = session.user;
        const { data: profile } = await supabaseClient.from('profiles').select('*').eq('id', currentUser.id).single();
        if (profile) {
          if (!profile.is_approved) {
            alert('선생님의 가입 승인이 아직 완료되지 않았습니다. 승인 후 다시 로그인해주세요!');
            await supabaseClient.auth.signOut();
            return;
          }
          currentProfile = profile;
          
          if (currentProfile.needs_pw_change) {
            document.getElementById('authScreen').classList.add('hidden');
            document.getElementById('firstLoginPwModal').classList.remove('hidden');
            lucide.createIcons();
            return;
          }

          enterPlatform();
        }
      }
    }

function toggleMobileMenu() {
  const drawer = document.getElementById('mobileMenuDrawer');
  if (drawer.classList.contains('hidden')) {
    drawer.classList.remove('hidden');
    // 교사일 때 모바일 회원관리 메뉴 노출 동기화
    const mobApp = document.getElementById('mobileTeacherApprovalWrapper');
    if (mobApp) {
      if (isCurrentTeacher()) mobApp.classList.remove('hidden');
      else mobApp.classList.add('hidden');
    }
  } else {
    drawer.classList.add('hidden');
  }
  lucide.createIcons();
}

// 메뉴 선택 시 화면 이동 후 드로어 닫기
function navAndClose(viewId) {
  toggleMobileMenu();
  changeView(viewId);
}
    
    function switchAuthTab(tab) {
      if (tab === 'login') {
        document.getElementById('loginForm').classList.remove('hidden');
        document.getElementById('registerForm').classList.add('hidden');
        document.getElementById('tabLoginBtn').className = 'flex-1 py-2.5 text-center font-bold tab-active';
        document.getElementById('tabRegisterBtn').className = 'flex-1 py-2.5 text-center font-medium text-slate-400';
      } else {
        document.getElementById('loginForm').classList.add('hidden');
        document.getElementById('registerForm').classList.remove('hidden');
        document.getElementById('tabRegisterBtn').className = 'flex-1 py-2.5 text-center font-bold tab-active';
        document.getElementById('tabLoginBtn').className = 'flex-1 py-2.5 text-center font-medium text-slate-400';
      }
    }

    function toggleRoleFields() {
      const role = document.getElementById('regRole').value;
      const sField = document.getElementById('studentNoField');
      const cField = document.getElementById('customIdField');
      const classField = document.getElementById('classSelectField');

      if (role === 'student') {
        sField.classList.remove('hidden');
        cField.classList.add('hidden');
        classField.classList.remove('hidden');
        document.getElementById('classAutoHint').classList.remove('hidden');
      } else if (role === 'head') {
        sField.classList.add('hidden');
        cField.classList.remove('hidden');
        classField.classList.add('hidden');
      } else {
        sField.classList.add('hidden');
        cField.classList.remove('hidden');
        classField.classList.remove('hidden');
        document.getElementById('classAutoHint').classList.add('hidden');
      }
    }

    async function handleRegister(e) {
      e.preventDefault();
      const role = document.getElementById('regRole').value;
      const name = document.getElementById('regName').value.trim();
      const pw = document.getElementById('regPw').value;
      
      let rawId = '';
      let studentNo = null;
      let classNum = parseInt(document.getElementById('regClassNum').value) || 2;

      if (role === 'student') {
        studentNo = document.getElementById('regStudentNo').value.trim();
        if (!studentNo) return alert('학번을 입력해주세요.');
        rawId = studentNo;
        if (studentNo.length >= 3 && studentNo.startsWith('3')) {
          classNum = parseInt(studentNo.substring(1, 3)) || classNum;
        }
      } else if (role === 'head') {
        rawId = document.getElementById('regCustomId').value.trim();
        if (!rawId) return alert('사용할 아이디를 입력해주세요.');
        classNum = 0;
      } else {
        rawId = document.getElementById('regCustomId').value.trim();
        if (!rawId) return alert('사용할 아이디를 입력해주세요.');
      }

      const regBtn = document.getElementById('regSubmitBtn');
      regBtn.innerText = '가입 신청 처리 중...';
      regBtn.disabled = true;

      const authEmail = toAuthEmail(rawId);
      const { data: authData, error: authError } = await supabaseClient.auth.signUp({ email: authEmail, password: pw });

      if (authError) {
        alert('가입 에러: 이미 등록된 아이디이거나 비밀번호 규격(6자 이상)을 확인해줘.');
        regBtn.innerText = '가입 신청 완료';
        regBtn.disabled = false;
        return;
      }

      if (authData.user) {
        await supabaseClient.from('profiles').insert([{
          id: authData.user.id,
          email: rawId,
          name: name,
          role: role === 'head' ? 'admin' : role,
          student_no: studentNo,
          class_num: classNum,
          is_approved: false,
          needs_pw_change: false
        }]);
        alert(`가입 신청 완료! [${classNum === 0 ? '전체' : classNum + '반'} / 아이디: ${rawId}] 담임선생님이 승인하면 로그인할 수 있습니다.`);
        switchAuthTab('login');
      }
      regBtn.innerText = '가입 신청 완료';
      regBtn.disabled = false;
    }

    async function handleLogin(e) {
      e.preventDefault();
      const rawId = document.getElementById('loginUserId').value.trim();
      const pw = document.getElementById('loginPw').value;
      const btn = document.getElementById('loginSubmitBtn');
      btn.innerText = '로그인 중...';
      btn.disabled = true;

      const authEmail = toAuthEmail(rawId);
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email: authEmail, password: pw });

      if (error) {
        alert('로그인 실패: 아이디(학번) 또는 비밀번호를 다시 확인해주세요.');
        btn.innerText = '로그인';
        btn.disabled = false;
        return;
      }

      const { data: profile } = await supabaseClient.from('profiles').select('*').eq('id', data.user.id).single();
      if (!profile || !profile.is_approved) {
        alert('선생님의 가입 승인이 아직 완료되지 않았습니다. 승인 후 다시 로그인해주세요!');
        await supabaseClient.auth.signOut();
        btn.innerText = '로그인';
        btn.disabled = false;
        return;
      }

      currentUser = data.user;
      currentProfile = profile;

      if (currentProfile.needs_pw_change) {
        document.getElementById('authScreen').classList.add('hidden');
        document.getElementById('firstLoginPwModal').classList.remove('hidden');
        btn.innerText = '로그인';
        btn.disabled = false;
        lucide.createIcons();
        return;
      }

      enterPlatform();
      btn.innerText = '로그인';
      btn.disabled = false;
    }

    async function handleFirstLoginPwChange(e) {
      e.preventDefault();
      const p1 = document.getElementById('firstNewPw').value;
      const p2 = document.getElementById('firstNewPwConfirm').value;
      const submitBtn = document.getElementById('firstPwSubmitBtn');

      if (p1 !== p2) return alert('입력한 두 비밀번호가 서로 일치하지 않습니다.');
      if (p1.length < 6) return alert('비밀번호는 최소 6자 이상이어야 합니다.');

      submitBtn.innerText = '비밀번호 변경 중...';
      submitBtn.disabled = true;

      const { error: authErr } = await supabaseClient.auth.updateUser({ password: p1 });
      if (authErr) {
        alert('비밀번호 변경 실패: ' + authErr.message);
        submitBtn.innerText = '비밀번호 변경 완료하고 시작하기';
        submitBtn.disabled = false;
        return;
      }

      await supabaseClient.from('profiles').update({ needs_pw_change: false }).eq('id', currentUser.id);
      currentProfile.needs_pw_change = false;

      alert('비밀번호가 안전하게 변경되었습니다! 플랫폼으로 이동합니다.');
      document.getElementById('firstLoginPwModal').classList.add('hidden');
      enterPlatform();
    }

    function enterPlatform() {
      document.getElementById('authScreen').classList.add('hidden');
      document.getElementById('mainScreen').classList.remove('hidden');

      isGradeHeadOrAdmin = (currentProfile.role === 'admin' || !currentProfile.class_num || currentProfile.class_num === 0);
      activeClassNum = (isGradeHeadOrAdmin && currentProfile.class_num === 0) ? 'all' : (currentProfile.class_num || 2);

      updateHeaderClassDisplay();

      document.getElementById('headerUserName').innerText = currentProfile.name;
      const roleText = currentProfile.role === 'admin' ? '관리자/부장교사' : (currentProfile.role === 'teacher' ? '담임교사' : (currentProfile.student_no ? `${currentProfile.student_no} 학생` : '회원'));
      document.getElementById('headerUserSub').innerText = roleText;

      const isTeacher = (currentProfile.role === 'admin' || currentProfile.role === 'teacher');

if (isTeacher) {
  document.getElementById('teacherApprovalMenuWrapper').classList.remove('hidden');
  document.getElementById('postNoticeBtn').classList.remove('hidden');
  document.getElementById('teacherHomeSummary').classList.remove('hidden');
  document.getElementById('studentHomeSummary').classList.add('hidden');
  document.getElementById('teacherSchedulePickerWrapper')?.classList.remove('hidden');
  document.getElementById('teacherMinCheckPickerWrapper')?.classList.remove('hidden');

  // [교사 전용 등록 버튼 활성화]
  document.getElementById('addCalendarEventBtn')?.classList.remove('hidden');
  document.getElementById('addAlbumFolderBtn')?.classList.remove('hidden');
  document.getElementById('addMaterialBtn')?.classList.remove('hidden');
  document.getElementById('addStudyMaterialBtn')?.classList.remove('hidden');
  document.getElementById('addMockFolderBtn')?.classList.remove('hidden');
  document.getElementById('addMockSampleBtn')?.classList.remove('hidden');
  document.getElementById('addForumFolderBtn')?.classList.remove('hidden');
  document.getElementById('addTeacherForumBtn')?.classList.remove('hidden');
  document.getElementById('addBriefingFolderBtn')?.classList.remove('hidden');
  document.getElementById('addBriefingBtn')?.classList.remove('hidden');
  document.getElementById('albumUploadLabel')?.classList.remove('hidden');

  loadUsersData();
  loadTeacherStudentSelects();
  loadTeacherCounselRequests();
} else {
  document.getElementById('teacherApprovalMenuWrapper').classList.add('hidden');
  document.getElementById('postNoticeBtn').classList.add('hidden');
  document.getElementById('teacherHomeSummary').classList.add('hidden');
  document.getElementById('studentHomeSummary').classList.remove('hidden');
  document.getElementById('teacherSchedulePickerWrapper')?.classList.add('hidden');
  document.getElementById('teacherMinCheckPickerWrapper')?.classList.add('hidden');

  // [학생 화면에서 등록 버튼 비활성화/숨김]
  document.getElementById('addCalendarEventBtn')?.classList.add('hidden');
  document.getElementById('addAlbumFolderBtn')?.classList.add('hidden');
  document.getElementById('addMaterialBtn')?.classList.add('hidden');
  document.getElementById('addStudyMaterialBtn')?.classList.add('hidden');
  document.getElementById('addMockFolderBtn')?.classList.add('hidden');
  document.getElementById('addMockSampleBtn')?.classList.add('hidden');
  document.getElementById('addForumFolderBtn')?.classList.add('hidden');
  document.getElementById('addTeacherForumBtn')?.classList.add('hidden');
  document.getElementById('addBriefingFolderBtn')?.classList.add('hidden');
  document.getElementById('addBriefingBtn')?.classList.add('hidden');
  document.getElementById('albumUploadLabel')?.classList.add('hidden');

  renderStudent12CardInputs();
        loadStudentExisting12Cards();
        loadMySurveyData();
        renderMockScoreInputs();
        loadStudentMockScoresForRound();
        renderMockChart(currentUser.id, 'studentMockChart');
      }
      
      const switcher = document.getElementById('adminClassSwitcher');
      if (isGradeHeadOrAdmin) {
        switcher.classList.remove('hidden');
        switcher.value = activeClassNum.toString();
      } else {
        switcher.classList.add('hidden');
      }

      changeView('home');
      loadHomeDashboardData();
      loadAlbumFolders();
      renderCalendar();
      loadExamSchedules();
      loadAdmissionMaterials();
      loadStudyMaterials();
      renderMinimumCheckAnalysis();
            initAdmissionSubPages();

      lucide.createIcons();
    }

    function updateHeaderClassDisplay() {
      const badge = document.getElementById('headerClassBadge');
      const title = document.getElementById('headerMainTitle');
      const roleBadge = document.getElementById('userRoleBadge');
      const homeLabel = document.getElementById('homeClassLabel');

      if (activeClassNum === 'all') {
        badge.innerText = '3-전체';
        badge.className = 'w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-black text-xs shadow-sm';
        title.innerText = '3학년 전체 진학 관리';
        roleBadge.innerText = '학년부장 / 총괄 교무실';
        homeLabel.innerText = '3학년 전체 포털';
      } else {
        badge.innerText = `3-${activeClassNum}`;
        badge.className = 'w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-black text-base shadow-sm';
        title.innerText = `3학년 ${activeClassNum}반 진학 플랫폼`;
        roleBadge.innerText = currentProfile.role === 'student' ? `3학년 ${activeClassNum}반 학생 포털` : `3학년 ${activeClassNum}반 교무실`;
        homeLabel.innerText = `3학년 ${activeClassNum}반 포털`;
      }

      document.getElementById('albumHeaderTitle').innerHTML = `<i data-lucide="camera" class="w-5 h-5 text-blue-600"></i> ${activeClassNum === 'all' ? '3학년 전체' : activeClassNum + '반'} 학급 앨범`;
   document.getElementById('calendarHeaderTitle').innerHTML = `<i data-lucide="calendar" class="w-5 h-5 text-blue-600"></i> ${activeClassNum === 'all' ? '3학년 학사' : activeClassNum + '반 학사'} & 상담 달력`;
    }

    function switchAdminViewClass(val) {
      activeClassNum = (val === 'all') ? 'all' : parseInt(val);
      updateHeaderClassDisplay();
      loadHomeDashboardData();
      loadTeacherStudentSelects();
      loadAlbumFolders();
      renderCalendar();
      loadUsersData();
      loadTeacherCounselRequests();
      loadExamSchedules();
      renderMinimumCheckAnalysis();
      lucide.createIcons();
    }

    async function handleLogout() {
      if (confirm('로그아웃 할까요?')) {
        await supabaseClient.auth.signOut();
        currentUser = null;
        currentProfile = null;
        document.getElementById('mainScreen').classList.add('hidden');
        document.getElementById('authScreen').classList.remove('hidden');
      }
    }
 
    function changeView(viewId) {
      document.querySelectorAll('.view-panel').forEach(el => el.classList.add('hidden'));
      const target = document.getElementById('view-' + viewId);
      if (target) target.classList.remove('hidden');

      if (viewId === 'counselRequests') {
        loadTeacherCounselRequests();
      } else if (viewId === 'schedules') {
        loadExamSchedules();
      } else if (viewId === 'minimumCheck') {
        renderMinimumCheckAnalysis();
      } else if (viewId === 'studyMaterials') {
        loadStudyMaterials();
      } else if (viewId === 'mockDocEval') {
        loadMockEvalsData();
      } else if (viewId === 'teacherForum') {
        loadTeacherForumsData();
      } else if (viewId === 'admissionBriefing') {
        loadBriefingFoldersData();
      }

      window.scrollTo({ top: 0, behavior: 'smooth' });
      lucide.createIcons();
    }

    // 수능 D-Day 자동 계산 (2027 수능일: 2026-11-19)
function getSuneungDate(year) {
  // 11월 1일의 요일을 구해서 셋째 주 목요일 계산
  const novFirst = new Date(year, 10, 1);
  const dayOfWeek = novFirst.getDay(); // 0(일) ~ 4(목) ~ 6(토)
  const firstThursday = 1 + ((4 - dayOfWeek + 7) % 7);
  const thirdThursday = firstThursday + 14;
  return new Date(year, 10, thirdThursday, 0, 0, 0);
}

function updateSuneungDday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  let targetYear = today.getFullYear();
  let suneungDate = getSuneungDate(targetYear);

  // 올해 수능이 이미 지났다면 자동으로 내년 수능일을 타겟으로 설정
  if (today > suneungDate) {
    targetYear += 1;
    suneungDate = getSuneungDate(targetYear);
  }

  // 상단 라벨 문구도 대입 학년도에 맞춰 자동 갱신 (예: 2026년 치르는 시험 = 2027 수능)
  const ddayLabel = document.querySelector('#homeDdayCount')?.previousElementSibling;
  if (ddayLabel) {
    ddayLabel.innerText = `${targetYear + 1} 수능 D-Day`;
  }

  const diffDays = Math.ceil((suneungDate - today) / (1000 * 60 * 60 * 24));
  const ddayEl = document.getElementById('homeDdayCount');
  
  if (!ddayEl) return;

  if (diffDays === 0) {
    ddayEl.innerText = 'D-DAY';
  } else if (diffDays > 0) {
    ddayEl.innerText = `D-${diffDays}`;
  } else {
    ddayEl.innerText = `D+${Math.abs(diffDays)}`;
  }
}

    
    // =================================================================
    // 💡 메인 홈 대시보드 데이터 로드
    // =================================================================
    async function loadHomeDashboardData() {
      updateSuneungDday();
      document.getElementById('homeWelcomeMessage').innerText = `반가워요, ${currentProfile.name} ${currentProfile.role === 'student' ? '학생' : '선생님'}!`;

      // 1. 공통 조회 쿼리 준비 (아직 서버에 보내지 않고 준비만 함)
      let noticeQuery = supabaseClient.from('class_notices').select('*').order('created_at', { ascending: false }).limit(5);
      if (activeClassNum !== 'all') {
        noticeQuery = noticeQuery.eq('class_num', activeClassNum);
      }

      let calQ = supabaseClient.from('calendar_events').select('*').order('event_date', { ascending: true }).limit(3);
      if (activeClassNum !== 'all') {
        calQ = calQ.or(`class_num.eq.${activeClassNum},class_num.eq.0,class_num.is.null`);
      }

      let folderQ = supabaseClient.from('album_folders').select('id');
      if (activeClassNum !== 'all') {
        folderQ = folderQ.or(`class_num.eq.${activeClassNum},class_num.is.null`);
      }

      // 2. [최적화 핵심] 3개의 기본 요청을 동시에 한꺼번에 서버로 전송 (대기시간 1/3 단축)
      const [noticeRes, calRes, folderRes] = await Promise.all([
        noticeQuery,
        calQ,
        folderQ
      ]);

      // 알림장 렌더링
      const notices = noticeRes.data;
      currentNoticeList = notices || [];
      const noticeListEl = document.getElementById('homeNoticeList');
      if (!notices || notices.length === 0) {
        noticeListEl.innerHTML = '<p class="text-center text-xs text-slate-400 py-6">등록된 담임 알림이 없습니다.</p>';
      } else {
        noticeListEl.innerHTML = notices.map(n => `
          <div onclick="openNoticeDetailModal('${n.id}')" class="p-3 bg-slate-50 hover:bg-blue-50/70 rounded-xl border border-slate-100 hover:border-blue-200 transition cursor-pointer group">
            <div class="flex justify-between items-center mb-1">
              <span class="font-bold text-slate-800 text-xs flex items-center gap-1.5 group-hover:text-blue-600 transition">
                <span class="w-1.5 h-1.5 rounded-full bg-blue-600"></span> ${escapeHtml(n.title)}
              </span>
              <span class="text-[10px] text-slate-400">${new Date(n.created_at).toLocaleDateString()}</span>
            </div>
            <p class="text-xs text-slate-600 line-clamp-2 pl-3 leading-relaxed">${escapeHtml(n.content)}</p>
          </div>
        `).join('');
      }

      // 학사 일정 렌더링
      const recentEvents = calRes.data;
      const calPreviewEl = document.getElementById('homeCalendarPreview');
      if (recentEvents && recentEvents.length > 0) {
        calPreviewEl.innerHTML = recentEvents.map(e => `
          <div class="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-100">
            <span class="font-bold text-slate-700 truncate max-w-[170px]">${escapeHtml(e.title)}</span>
            <span class="text-[11px] text-blue-600 font-semibold">${escapeHtml(e.event_date.substring(5))}</span>
          </div>
        `).join('');
      } else {
        calPreviewEl.innerHTML = '<p class="text-slate-400 py-3 text-center">등록된 일정이 없습니다.</p>';
      }

      // 3. 학생 / 교사별 맞춤 데이터 조회 병렬 처리
      if (currentProfile.role === 'student') {
        const [cardsRes, counselRes] = await Promise.all([
          supabaseClient.from('applications_12').select('*').eq('user_id', currentUser.id),
          supabaseClient.from('counsel_requests').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false }).limit(1)
        ]);

        const cards = cardsRes.data;
        const susiCount = cards ? cards.filter(c => c.slot_type === 'susi' && c.university).length : 0;
        const specCount = cards ? cards.filter(c => c.slot_type === 'special' && c.university).length : 0;
        const jeongsiCount = cards ? cards.filter(c => c.slot_type === 'jeongsi' && c.university).length : 0;

        document.getElementById('homeSusiFilledCount').innerText = susiCount;
        document.getElementById('homeSpecFilledCount').innerText = specCount;
        const jCntEl = document.getElementById('homeJeongsiFilledCount');
        if (jCntEl) jCntEl.innerText = jeongsiCount;

        const counsel = counselRes.data;
        const counselStatusEl = document.getElementById('homeMyCounselStatus');
        if (counsel && counsel.length > 0) {
          const c = counsel[0];
          if (c.status === 'confirmed') {
            counselStatusEl.innerHTML = `<span class="text-emerald-600 font-bold">${c.target_date} (${c.target_period}) [확정]</span>`;
          } else if (c.status === 'rejected') {
            counselStatusEl.innerHTML = `<span class="text-rose-600 font-bold" title="거절 사유가 등록되었습니다.">${c.target_date} [신청 거절됨]</span>`;
          } else {
            counselStatusEl.innerHTML = `<span class="text-amber-600 font-bold">${c.target_date} (${c.target_period}) [대기중]</span>`;
          }
        } else {
          counselStatusEl.innerText = '신청 내역 없음';
          counselStatusEl.className = 'mt-1 font-bold text-xs text-slate-500';
        }
      }

      if (currentProfile.role === 'admin' || currentProfile.role === 'teacher') {
        let studentQ = supabaseClient.from('profiles').select('id', { count: 'exact' }).eq('role', 'student').eq('is_approved', true);
        if (activeClassNum !== 'all') studentQ = studentQ.eq('class_num', activeClassNum);

        let counselQ = supabaseClient.from('counsel_requests').select('id', { count: 'exact' }).eq('status', 'pending');
        let pendingQ = supabaseClient.from('profiles').select('id', { count: 'exact' }).eq('is_approved', false);

        const [stdCntRes, cCntRes, pCntRes] = await Promise.all([studentQ, counselQ, pendingQ]);

        document.getElementById('homeTeacherStatStudents').innerText = (stdCntRes.count || 0) + '명';
        const cCount = cCntRes.count || 0;
        document.getElementById('homeTeacherStatCounsel').innerText = cCount + '건';

        const navBadge = document.getElementById('counselNavBadge');
        const dropBadge = document.getElementById('counselDropdownBadge');
        if (cCount > 0) {
          navBadge.innerText = cCount;
          navBadge.classList.remove('hidden');
          dropBadge.innerText = cCount;
          dropBadge.classList.remove('hidden');
        } else {
          navBadge.classList.add('hidden');
          dropBadge.classList.add('hidden');
        }

        document.getElementById('homeTeacherStatPending').innerText = (pCntRes.count || 0) + '명';
      }

      // 4. 학급 앨범 사진 불러오기
      const classFolders = folderRes.data;
      let recentPhotos = [];
      if (classFolders && classFolders.length > 0) {
        const folderIds = classFolders.map(f => f.id);
        const { data: photos } = await supabaseClient
          .from('album_photos')
          .select('*')
          .in('folder_id', folderIds)
          .order('created_at', { ascending: false })
          .limit(3);
        recentPhotos = photos || [];
      }

      const photoGrid = document.getElementById('homeAlbumPreview');
      if (recentPhotos && recentPhotos.length > 0) {
        photoGrid.innerHTML = recentPhotos.map(p => `
          <div class="aspect-square rounded-lg overflow-hidden bg-slate-100 border shadow-xs">
            <img src="${p.photo_url}" class="w-full h-full object-cover">
          </div>
        `).join('');
      } else {
        photoGrid.innerHTML = '<p class="col-span-3 text-slate-400 py-6 text-center text-xs">우리 반에 등록된 사진이 없습니다.</p>';
      }
    }


    let currentNoticeList = [];
    let selectedNoticeId = null;

    function openNewNoticeModal() {
      document.getElementById('noticeEditTargetId').value = '';
      document.getElementById('noticeModalTitle').innerHTML = '<i data-lucide="megaphone" class="w-4 h-4 text-blue-600"></i> 새 담임 알림 작성';
      document.getElementById('noticeTitleInput').value = '';
      document.getElementById('noticeContentInput').value = '';
      document.getElementById('newNoticeModal').classList.remove('hidden');
      lucide.createIcons();
    }

    function closeNewNoticeModal() {
      document.getElementById('newNoticeModal').classList.add('hidden');
    }

    function openNoticeDetailModal(id) {
      const notice = currentNoticeList.find(n => n.id === id);
      if (!notice) return;

      selectedNoticeId = id;
      document.getElementById('detailNoticeTitle').innerText = notice.title;
      document.getElementById('detailNoticeDate').innerText = new Date(notice.created_at).toLocaleString();
      document.getElementById('detailNoticeContent').innerText = notice.content;

      const teacherBtns = document.getElementById('noticeTeacherActionBtns');
      if (isCurrentTeacher()) {
        teacherBtns.classList.remove('hidden');
        teacherBtns.classList.add('flex');
      } else {
        teacherBtns.classList.add('hidden');
        teacherBtns.classList.remove('flex');
      }

      document.getElementById('noticeDetailModal').classList.remove('hidden');
      lucide.createIcons();
    }

    function closeNoticeDetailModal() {
      document.getElementById('noticeDetailModal').classList.add('hidden');
      selectedNoticeId = null;
    }

    function openEditNoticeFromDetail() {
      const notice = currentNoticeList.find(n => n.id === selectedNoticeId);
      if (!notice) return;

      closeNoticeDetailModal();

      document.getElementById('noticeEditTargetId').value = notice.id;
      document.getElementById('noticeModalTitle').innerHTML = '<i data-lucide="edit-3" class="w-4 h-4 text-blue-600"></i> 담임 알림 수정';
      document.getElementById('noticeTitleInput').value = notice.title;
      document.getElementById('noticeContentInput').value = notice.content;
      document.getElementById('newNoticeModal').classList.remove('hidden');
      lucide.createIcons();
    }

    async function deleteNoticeFromDetail() {
      if (!selectedNoticeId) return;
      if (!confirm('이 알림장 글을 완전히 삭제할까요?')) return;

      const { error } = await supabaseClient.from('class_notices').delete().eq('id', selectedNoticeId);
      if (error) {
        alert('삭제 실패: ' + error.message);
        return;
      }

      alert('알림장 글이 삭제되었습니다.');
      closeNoticeDetailModal();
      loadHomeDashboardData();
    }

    async function submitNoticeForm() {
      const editId = document.getElementById('noticeEditTargetId').value;
      const title = document.getElementById('noticeTitleInput').value.trim();
      const content = document.getElementById('noticeContentInput').value.trim();

      if (!title || !content) return alert('제목과 내용을 모두 입력해주세요.');

      const submitBtn = document.getElementById('noticeSubmitBtn');
      submitBtn.innerText = '저장 중...';
      submitBtn.disabled = true;

      const targetClass = (activeClassNum === 'all') ? (currentProfile.class_num || 2) : activeClassNum;

      if (editId) {
        const { error } = await supabaseClient.from('class_notices').update({
          title: title,
          content: content
        }).eq('id', editId);

        if (error) alert('수정 오류: ' + error.message);
        else alert('알림장이 성공적으로 수정되었습니다!');
      } else {
        const { error } = await supabaseClient.from('class_notices').insert([{
          class_num: targetClass,
          title: title,
          content: content,
          author_name: currentProfile.name
        }]);

        if (error) alert('등록 오류: ' + error.message);
        else alert('새 알림장이 등록되었습니다!');
      }

      submitBtn.innerText = '저장하기';
      submitBtn.disabled = false;
      closeNewNoticeModal();
      loadHomeDashboardData();
    }

    // =================================================================
    // 💡 [학급지도: 상담 신청 관리] 교사 승인 및 반려
    // =================================================================
async function loadTeacherCounselRequests() {
  const tbody = document.getElementById('teacherCounselTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-slate-400">내역을 불러오는 중...</td></tr>';

     let counselQuery = supabaseClient
       .from('counsel_requests')
       .select('*')
       .order('created_at', { ascending: false });

     // 담임선생님은 자기 반 학생 상담만 보이도록 안전 필터 적용
     if (activeClassNum !== 'all') {
       counselQuery = counselQuery.eq('class_num', activeClassNum);
     }
     const { data: list, error } = await counselQuery;

  if (error || !list || list.length === 0) {
    currentCounselList = [];
    tbody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-slate-400">접수된 상담 신청 내역이 없습니다.</td></tr>';
    return;
  }

  // 불러온 상담 목록을 보관함에 안전하게 저장
  currentCounselList = list;

  tbody.innerHTML = list.map(item => {
    const conflictCount = list.filter(x => 
      x.target_date === item.target_date && 
      x.target_period === item.target_period && 
      x.status !== 'rejected'
    ).length;

    let statusBadge = '';
    if (item.status === 'confirmed') {
      statusBadge = '<span class="inline-block px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-700 whitespace-nowrap">확인 완료</span>';
    } else if (item.status === 'rejected') {
      statusBadge = '<span class="inline-block px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-100 text-rose-700 whitespace-nowrap">거절(반려)</span>';
    } else {
      statusBadge = '<span class="inline-block px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-700 whitespace-nowrap">미확인</span>';
    }

    // ★ 핵심 변경: 버튼에 긴 글자를 넣지 않고 item.id(접수번호)만 깔끔하게 전달!
    let actionButtons = '';
    if (item.status === 'pending') {
      actionButtons = `
        <div class="inline-flex items-center gap-1.5 justify-center whitespace-nowrap">
          <button onclick="confirmCounselRequest('${item.id}')" class="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-xs font-bold transition shadow-sm whitespace-nowrap">접수</button>
          <button onclick="rejectCounselRequest('${item.id}')" class="px-2 py-1 bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-600 border border-slate-200 rounded-md text-xs font-bold transition whitespace-nowrap">거절</button>
        </div>
      `;
    } else {
      actionButtons = `<span class="text-slate-400 text-xs whitespace-nowrap">처리 완료</span>`;
    }

    const safeDetail = escapeHtml(item.detail || '-');
    let detailHtml = safeDetail;
    if (item.detail && item.detail.includes('[거절 사유:')) {
      detailHtml = safeDetail.replace(
        /\[거절 사유: (.*?)\]/g, 
        '<div class="mt-1.5 p-2 bg-rose-50 border border-rose-200 rounded text-rose-700 font-medium leading-relaxed">🚫 <b>거절 사유:</b> $1</div>'
      );
    }

    return `
      <tr class="hover:bg-slate-50 transition">
        <td class="p-3 font-bold text-slate-800 whitespace-nowrap">${escapeHtml(item.target_date) || '-'}</td>
        <td class="p-3 font-semibold text-blue-600 whitespace-nowrap">
          <div class="flex items-center gap-1.5">
            <span>${escapeHtml(item.target_period) || '-'}</span>
            ${conflictCount > 1 && item.status !== 'rejected' ? `<span class="inline-flex items-center text-[10px] font-bold bg-rose-50 text-rose-600 border border-rose-200 px-1.5 py-0.5 rounded">⚠️ 시간겹침(${conflictCount})</span>` : ''}
          </div>
        </td>
        <td class="p-3 font-bold text-slate-800 whitespace-nowrap">${escapeHtml(item.student_name) || '-'} <span class="text-slate-400 text-[11px] font-normal">(${escapeHtml(item.student_no) || '-'})</span></td>
        <td class="p-3 font-semibold text-slate-700 whitespace-nowrap">${escapeHtml(item.topic) || '-'}</td>
        <td class="p-3 text-slate-600 leading-relaxed min-w-[220px]">${detailHtml}</td>
        <td class="p-3 text-center whitespace-nowrap">${statusBadge}</td>
        <td class="p-3 text-center whitespace-nowrap">${actionButtons}</td>
      </tr>
    `;
  }).join('');
  lucide.createIcons();
}

async function confirmCounselRequest(requestId) {
  // 접수번호로 보관함에서 학생 정보 꺼내오기
  const targetItem = currentCounselList.find(c => c.id === requestId);
  if (!targetItem) return alert('해당 상담 정보를 찾을 수 없습니다.');

  const targetDate = targetItem.target_date;
  const targetPeriod = targetItem.target_period;
  const studentName = targetItem.student_name;

  const { data: existingConfirmed } = await supabaseClient
    .from('counsel_requests')
    .select('*')
    .eq('target_date', targetDate)
    .eq('target_period', targetPeriod)
    .eq('status', 'confirmed')
    .neq('id', requestId);

  const { data: existingEvents } = await supabaseClient
    .from('calendar_events')
    .select('*')
    .eq('event_date', targetDate);

  let conflictWarning = '';
  if (existingConfirmed && existingConfirmed.length > 0) {
    const studentNames = existingConfirmed.map(c => c.student_name).join(', ');
    conflictWarning += `⚠️ [상담 일정 중복 경고]\n이미 해당 시간(${targetDate} ${targetPeriod})에 [${studentNames}] 학생과의 상담 일정이 확정되어 있습니다!\n\n`;
  }

  if (existingEvents && existingEvents.length > 0) {
    const eventTitles = existingEvents.map(e => e.title).join(', ');
    conflictWarning += `📅 [학사 달력 알림]\n해당 날짜(${targetDate})에 "${eventTitles}" 일정이 있습니다.\n\n`;
  }

  if (conflictWarning) {
    const proceed = confirm(`${conflictWarning}그래도 [${studentName}] 학생의 상담을 확정 접수하고 달력에 등록할까요?`);
    if (!proceed) return;
  } else {
    if (!confirm(`[${studentName}] 학생의 ${targetDate} (${targetPeriod}) 상담 신청을 접수할까요?`)) return;
  }

  const { error } = await supabaseClient.from('counsel_requests').update({ status: 'confirmed' }).eq('id', requestId);
  if (error) {
    alert('상태 변경 실패: ' + error.message);
    return;
  }

  // 학생 학번(예: 30201 -> 2반) 또는 프로필에서 해당 학생의 실제 반 추출
  let studentClassNum = targetItem.class_num;
  if (!studentClassNum && targetItem.student_no && targetItem.student_no.length >= 3) {
    studentClassNum = parseInt(targetItem.student_no.substring(1, 3)) || 2;
  }
  if (!studentClassNum) {
    studentClassNum = (activeClassNum === 'all') ? (currentProfile.class_num || 2) : activeClassNum;
  }

  // 상담 일정 등록 시 학생 본인 ID(target_user_id)를 함께 기록하여 본인 달력에도 표시되게 함!
  await supabaseClient.from('calendar_events').insert([{
    event_date: targetDate,
    category: 'counsel',
    title: `[상담] ${studentName} (${targetPeriod})`,
    class_num: studentClassNum,
    target_user_id: targetItem.user_id
  }]);
  
  alert(`[${studentName}] 상담이 확정되었고, 학사 달력에도 자동으로 등록되었습니다!`);
  loadTeacherCounselRequests();
  loadHomeDashboardData();
  renderCalendar();
}

async function rejectCounselRequest(requestId) {
  const targetItem = currentCounselList.find(c => c.id === requestId);
  if (!targetItem) return alert('해당 상담 정보를 찾을 수 없습니다.');

  const studentName = targetItem.student_name;

  const reason = prompt(
    `[${studentName}] 학생의 상담 신청을 거절(반려)할까요?\n\n학생에게 전달할 사유를 입력해주세요:`, 
    '해당 시간대 다른 일정이 있어 접수가 어렵습니다. 다른 시간으로 재신청 바랍니다.'
  );

  if (reason === null) return;
  const trimmedReason = reason.trim() || '일정 조율 필요';

  const updatedDetail = (targetItem.detail ? targetItem.detail + '\n\n' : '') + `[거절 사유: ${trimmedReason}]`;

  const { error } = await supabaseClient.from('counsel_requests').update({
    status: 'rejected',
    detail: updatedDetail
  }).eq('id', requestId);

  if (error) {
    alert('거절 처리 실패: ' + error.message);
    return;
  }

  alert(`[${studentName}] 학생의 상담 신청을 거절 처리했습니다.`);
  loadTeacherCounselRequests();
  loadHomeDashboardData();
}

    // =================================================================
    // 💡 [입시지도: 입시일정정리] 면접 · 논술 · 실기 로직
    // =================================================================
// 한국 시간 기준 YYYY-MM-DD 생성 만능 도우미
function getTodayString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function openExamScheduleModal() {
  const todayStr = getTodayString(); // 아침 9시 이전에도 항상 정확한 오늘 날짜 반영!
  document.getElementById('schedUnivInput').value = '';
  document.getElementById('schedDeptInput').value = '';
  document.getElementById('schedTypeDetailInput').value = '';
  document.getElementById('schedDateInput').value = todayStr;
  document.getElementById('schedTimeInput').value = '';
  document.getElementById('schedLocationInput').value = '';
  document.getElementById('schedMemoInput').value = '';
  document.getElementById('examScheduleModal').classList.remove('hidden');
  lucide.createIcons();
}

    function closeExamScheduleModal() {
      document.getElementById('examScheduleModal').classList.add('hidden');
    }

    function filterExamSchedules(cat) {
      activeScheduleFilter = cat;
      ['all', 'interview', 'essay', 'practical', 'announcement'].forEach(c => {
        const btn = document.getElementById(`schedFilter_${c}`);
        if (btn) {
          if (c === cat) {
            btn.className = 'px-3 py-1.5 rounded-lg bg-blue-600 text-white font-bold transition';
          } else {
            btn.className = 'px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold transition flex items-center gap-1';
          }
        }
      });
      renderExamScheduleCards();
    }

async function loadExamSchedules() {
  let queryTargetUserId = currentUser ? currentUser.id : null;
  if (isCurrentTeacher()) {
    const selVal = document.getElementById('scheduleStudentSelect')?.value;
    if (selVal && selVal !== 'all') {
      queryTargetUserId = selVal;
    } else {
      queryTargetUserId = null;
    }
  }

  let q = supabaseClient.from('admission_schedules').select('*').order('exam_date', { ascending: true });
  if (queryTargetUserId) {
    q = q.eq('user_id', queryTargetUserId);
  } else if (isCurrentTeacher() && activeClassNum !== 'all') {
    // [수정] 특정 학급 모드일 때는 해당 학급 학생들의 일정만 가져옴
    q = q.eq('class_num', activeClassNum);
  }

  const { data, error } = await q;

  if (error) {
    console.error('일정 로드 실패:', error);
    currentSchedules = [];
  } else {
    currentSchedules = data || [];
  }

  renderExamScheduleCards();
}

async function submitExamSchedule() {
  const type = document.getElementById('schedTypeInput').value;
  const univ = document.getElementById('schedUnivInput').value.trim();
  const dept = document.getElementById('schedDeptInput').value.trim();
  const typeDetail = document.getElementById('schedTypeDetailInput').value.trim();
  const date = document.getElementById('schedDateInput').value;
  const time = document.getElementById('schedTimeInput').value.trim();
  const location = document.getElementById('schedLocationInput').value.trim();
  const memo = document.getElementById('schedMemoInput').value.trim();

  if (!univ || !date) return alert('대학교명과 고사 날짜를 입력해주세요.');

  const submitBtn = document.getElementById('schedSubmitBtn');
  submitBtn.innerText = '등록 중...';
  submitBtn.disabled = true;

  const newRecord = {
    user_id: currentUser.id,
    student_name: currentProfile.name,
    student_no: currentProfile.student_no || '',
    class_num: currentProfile.class_num || 2,
    schedule_type: type,
    university: univ,
    department: dept,
    admission_type: typeDetail,
    exam_date: date,
    exam_time: time,
    location: location,
    memo: memo
  };

  const { error } = await supabaseClient.from('admission_schedules').insert([newRecord]);

  submitBtn.innerText = '일정 등록 완료';
  submitBtn.disabled = false;

  if (error) {
    alert('입시 일정 저장에 실패했습니다. (원인: ' + error.message + ')\n잠시 후 다시 시도해 주세요.');
    return;
  }

  alert('입시 일정이 서버에 안전하게 등록되었습니다!');
  closeExamScheduleModal();
  loadExamSchedules();
}

async function deleteExamSchedule(id) {
  if (!confirm('이 입시 일정을 삭제할까요?')) return;

  const { error } = await supabaseClient.from('admission_schedules').delete().eq('id', id);
  if (error) {
    alert('삭제 실패: ' + error.message);
    return;
  }

  alert('일정이 삭제되었습니다.');
  loadExamSchedules();
}

    function calculateDday(dateStr) {
      if (!dateStr) return '';
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const target = new Date(dateStr);
      target.setHours(0, 0, 0, 0);
      const diff = Math.ceil((target - today) / (1000 * 60 * 60 * 24));
      if (diff === 0) return '<span class="bg-rose-600 text-white px-2 py-0.5 rounded-md font-black text-[11px] animate-pulse">D-DAY</span>';
      if (diff > 0) return `<span class="bg-blue-600 text-white px-2 py-0.5 rounded-md font-black text-[11px]">D-${diff}</span>`;
      return `<span class="bg-slate-300 text-slate-600 px-2 py-0.5 rounded-md font-bold text-[11px]">종료(D+${Math.abs(diff)})</span>`;
    }

    function getScheduleTypeBadge(type) {
      switch (type) {
        case 'interview': return '<span class="px-2 py-0.5 rounded bg-blue-100 text-blue-700 font-bold text-[10px]">🗣️ 면접고사</span>';
        case 'essay': return '<span class="px-2 py-0.5 rounded bg-purple-100 text-purple-700 font-bold text-[10px]">✍️ 논술시험</span>';
        case 'practical': return '<span class="px-2 py-0.5 rounded bg-rose-100 text-rose-700 font-bold text-[10px]">🎨 실기고사</span>';
        case 'announcement': return '<span class="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold text-[10px]">📢 합격발표</span>';
        default: return '<span class="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-bold text-[10px]">입시일정</span>';
      }
    }

    function renderExamScheduleCards() {
      const container = document.getElementById('examScheduleListContainer');
      if (!container) return;

      let list = currentSchedules || [];
      if (activeScheduleFilter !== 'all') {
        list = list.filter(s => s.schedule_type === activeScheduleFilter);
      }

      if (list.length === 0) {
        container.innerHTML = '<p class="col-span-full text-center text-slate-400 py-16">해당 조건에 등록된 일정이 없습니다.</p>';
        return;
      }

      list.sort((a, b) => new Date(a.exam_date) - new Date(b.exam_date));

      container.innerHTML = list.map(item => `
        <div class="bg-white rounded-xl border border-slate-200 p-4 shadow-sm hover:border-blue-300 hover:shadow-md transition space-y-3 relative group">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-1.5">
              ${getScheduleTypeBadge(item.schedule_type)}
              ${isCurrentTeacher() ? `<span class="text-[11px] font-bold text-slate-500">[${item.student_name || '학생'}]</span>` : ''}
            </div>
<div class="flex items-center gap-1.5">
  ${calculateDday(item.exam_date)}
  ${(isCurrentTeacher() || item.user_id === currentUser?.id) ? `
    <button onclick="deleteExamSchedule('${item.id}')" title="일정 삭제" class="text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition p-1">
      <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
    </button>
  ` : ''}
</div>
          </div>

          <div>
            <h4 class="font-black text-slate-800 text-base leading-tight">${escapeHtml(item.university)} ${escapeHtml(item.department) || ''}</h4>
            <p class="text-xs text-blue-600 font-bold mt-0.5">${escapeHtml(item.admission_type) || '-'}</p>
          </div>

          <div class="bg-slate-50 p-2.5 rounded-lg border border-slate-100 space-y-1 text-xs text-slate-600">
            <div class="flex items-center gap-1.5 font-semibold text-slate-800">
              <i data-lucide="calendar" class="w-3.5 h-3.5 text-blue-600"></i> ${item.exam_date} ${item.exam_time ? ' (' + item.exam_time + ')' : ''}
            </div>
            ${item.location ? `
              <div class="flex items-center gap-1.5 text-slate-600 text-[11px]">
                <i data-lucide="map-pin" class="w-3.5 h-3.5 text-rose-500"></i> ${escapeHtml(item.location)}
              </div>
            ` : ''}
          </div>

          ${escapeHtml(item.memo) ? `
            <div class="text-[11px] text-slate-500 bg-amber-50/50 p-2 rounded-lg border border-amber-100 leading-relaxed">
              💡 ${escapeHtml(item.memo)}
            </div>
          ` : ''}
        </div>
      `).join('');
      lucide.createIcons();
    }

    // =================================================================
    // 💡 [입시지도: 최저충족여부] 2합 · 3합 · 4합 / 버림 · 반올림 정밀 계산
    // =================================================================
    async function renderMinimumCheckAnalysis() {
      const tbody = document.getElementById('minCheckTableBody');
      const cardsGrid = document.getElementById('minCheckSusiCardsGrid');
      if (!tbody) return;

      let targetUserId = currentUser ? currentUser.id : null;
      if (isCurrentTeacher()) {
        const selVal = document.getElementById('minCheckStudentSelect')?.value;
        if (selVal) targetUserId = selVal;
      }

      if (!targetUserId) {
        tbody.innerHTML = '<tr><td colspan="12" class="p-8 text-center text-slate-400">학생을 먼저 선택해주세요.</td></tr>';
        if (cardsGrid) cardsGrid.innerHTML = '<p class="col-span-full text-center text-slate-400 py-8">학생을 선택하면 수시 6장 최저 충족 현황이 표시됩니다.</p>';
        return;
      }

      tbody.innerHTML = '<tr><td colspan="12" class="p-8 text-center text-slate-400">모의고사 성적을 정밀 분석하고 있습니다...</td></tr>';

      const { data: scores } = await supabaseClient.from('mock_scores').select('*').eq('user_id', targetUserId);
      const rounds = ['3월학평', '5월학평', '6월모평', '7월학평', '9월모평', '10월학평', '수능'];

      let rowsHtml = '';
      const roundAnalysisMap = {};

rounds.forEach(round => {
        const rScores = (scores || []).filter(s => s.exam_round === round);
        
        // 1~9등급 유효성 검사 함수
        const getValidGrade = (key) => {
          const val = rScores.find(s => s.subject_key === key)?.grade;
          if (val === null || val === undefined || val === '') return null;
          const num = parseInt(val, 10);
          return (!isNaN(num) && num >= 1 && num <= 9) ? num : null;
        };

        const kor = getValidGrade('korean');
        const mat = getValidGrade('math');
        const eng = getValidGrade('english');
        const his = getValidGrade('history');
        const t1 = getValidGrade('tam1');
        const t2 = getValidGrade('tam2');

        if (kor === null && mat === null && eng === null && t1 === null && t2 === null) {
          return;
        }

        let tamTop1 = null;
        if (t1 !== null && t2 !== null) tamTop1 = Math.min(t1, t2);
        else if (t1 !== null) tamTop1 = t1;
        else if (t2 !== null) tamTop1 = t2;

        let tamFloor = null;
        if (t1 !== null && t2 !== null) tamFloor = Math.floor((t1 + t2) / 2);
        else if (t1 !== null) tamFloor = t1;
        else if (t2 !== null) tamFloor = t2;

        let tamRound = null;
        if (t1 !== null && t2 !== null) tamRound = Math.round((t1 + t2) / 2);
        else if (t1 !== null) tamRound = t1;
        else if (t2 !== null) tamRound = t2;

        function calcBestSums(tamGrade) {
          const subjects = [];
          if (kor !== null) subjects.push({ name: '국', grade: Number(kor) });
          if (mat !== null) subjects.push({ name: '수', grade: Number(mat) });
          if (eng !== null) subjects.push({ name: '영', grade: Number(eng) });
          if (tamGrade !== null) subjects.push({ name: '탐', grade: Number(tamGrade) });

          subjects.sort((a, b) => a.grade - b.grade);

const sum2 = subjects.length >= 2 ? { val: subjects[0].grade + subjects[1].grade, desc: subjects[0].name + subjects[0].grade + '+' + subjects[1].name + subjects[1].grade } : null;
          const sum3 = subjects.length >= 3 ? { val: subjects[0].grade + subjects[1].grade + subjects[2].grade, desc: subjects[0].name + subjects[0].grade + '+' + subjects[1].name + subjects[1].grade + '+' + subjects[2].name + subjects[2].grade } : null;
          const sum4 = subjects.length >= 4 ? { val: subjects.reduce((acc, cur) => acc + cur.grade, 0), desc: subjects.map(s => s.name + s.grade).join('+') } : null;
          return { sum2, sum3, sum4 };
        }
  
        const top1Sums = calcBestSums(tamTop1);
        const floorSums = calcBestSums(tamFloor);
        const roundSums = calcBestSums(tamRound);

        roundAnalysisMap[round] = { kor, mat, eng, t1, t2, his, tamTop1, tamFloor, tamRound, top1Sums, floorSums, roundSums };

        rowsHtml += `
          <tr class="hover:bg-blue-50/30 transition border-t-2 border-slate-300">
            <td rowspan="3" class="p-3 font-black text-slate-800 border-r bg-slate-50 align-middle">
              <span class="text-sm text-blue-600 block">${round}</span>
            </td>
            <td rowspan="3" class="p-2 border-r font-bold text-slate-700 align-middle">${kor ?? '-'}</td>
            <td rowspan="3" class="p-2 border-r font-bold text-slate-700 align-middle">${mat ?? '-'}</td>
            <td rowspan="3" class="p-2 border-r font-bold text-slate-700 align-middle">${eng ?? '-'}</td>
            <td rowspan="3" class="p-2 border-r font-medium text-slate-600 align-middle">${t1 ?? '-'}</td>
            <td rowspan="3" class="p-2 border-r font-medium text-slate-600 align-middle">${t2 ?? '-'}</td>
            <td rowspan="3" class="p-2 border-r text-slate-400 align-middle">${his ?? '-'}</td>
            
            <td class="p-2 border-r text-xs font-semibold text-slate-700 text-left pl-3">
              <span class="inline-block w-2 h-2 rounded-full bg-blue-500 mr-1.5"></span>탐구 상위 1과목
            </td>
            <td class="p-2 border-r font-black text-blue-600 bg-blue-50/30">${tamTop1 !== null ? tamTop1 + '등급' : '-'}</td>
            <td class="p-2 border-r font-black text-emerald-700 bg-emerald-50/30">
              ${top1Sums.sum2 ? `<span class="text-sm font-black">${top1Sums.sum2.val}</span> <span class="text-[10px] text-slate-400 block font-normal">(${top1Sums.sum2.desc})</span>` : '-'}
            </td>
            <td class="p-2 border-r font-black text-emerald-700 bg-emerald-50/30">
              ${top1Sums.sum3 ? `<span class="text-sm font-black">${top1Sums.sum3.val}</span> <span class="text-[10px] text-slate-400 block font-normal">(${top1Sums.sum3.desc})</span>` : '-'}
            </td>
            <td class="p-2 font-black text-emerald-700 bg-emerald-50/30">
              ${top1Sums.sum4 ? `<span class="text-sm font-black">${top1Sums.sum4.val}</span>` : '-'}
            </td>
          </tr>

          <tr class="hover:bg-amber-50/30 transition border-t border-slate-100">
            <td class="p-2 border-r text-xs font-semibold text-slate-700 text-left pl-3">
              <span class="inline-block w-2 h-2 rounded-full bg-amber-500 mr-1.5"></span>탐구 2과목 <b class="text-amber-700">[버림]</b>
            </td>
            <td class="p-2 border-r font-black text-amber-600 bg-amber-50/20">
              ${tamFloor !== null ? tamFloor + '등급' : '-'}
              ${(t1 !== null && t2 !== null && (t1 + t2) % 2 !== 0) ? `<span class="text-[10px] text-amber-600 block">(${(t1+t2)/2}→${tamFloor})</span>` : ''}
            </td>
            <td class="p-2 border-r font-black text-emerald-700 bg-emerald-50/20">
              ${floorSums.sum2 ? `<span class="text-sm font-black">${floorSums.sum2.val}</span> <span class="text-[10px] text-slate-400 block font-normal">(${floorSums.sum2.desc})</span>` : '-'}
            </td>
            <td class="p-2 border-r font-black text-emerald-700 bg-emerald-50/20">
              ${floorSums.sum3 ? `<span class="text-sm font-black">${floorSums.sum3.val}</span> <span class="text-[10px] text-slate-400 block font-normal">(${floorSums.sum3.desc})</span>` : '-'}
            </td>
            <td class="p-2 font-black text-emerald-700 bg-emerald-50/20">
              ${floorSums.sum4 ? `<span class="text-sm font-black">${floorSums.sum4.val}</span>` : '-'}
            </td>
          </tr>

          <tr class="hover:bg-purple-50/30 transition border-t border-slate-100">
            <td class="p-2 border-r text-xs font-semibold text-slate-700 text-left pl-3">
              <span class="inline-block w-2 h-2 rounded-full bg-purple-500 mr-1.5"></span>탐구 2과목 <b class="text-purple-700">[반올림]</b>
            </td>
            <td class="p-2 border-r font-black text-purple-600 bg-purple-50/20">
              ${tamRound !== null ? tamRound + '등급' : '-'}
              ${(t1 !== null && t2 !== null && (t1 + t2) % 2 !== 0) ? `<span class="text-[10px] text-purple-600 block">(${(t1+t2)/2}→${tamRound})</span>` : ''}
            </td>
            <td class="p-2 border-r font-black text-emerald-700 bg-emerald-50/20">
              ${roundSums.sum2 ? `<span class="text-sm font-black">${roundSums.sum2.val}</span> <span class="text-[10px] text-slate-400 block font-normal">(${roundSums.sum2.desc})</span>` : '-'}
            </td>
            <td class="p-2 border-r font-black text-emerald-700 bg-emerald-50/20">
              ${roundSums.sum3 ? `<span class="text-sm font-black">${roundSums.sum3.val}</span> <span class="text-[10px] text-slate-400 block font-normal">(${roundSums.sum3.desc})</span>` : '-'}
            </td>
            <td class="p-2 font-black text-emerald-700 bg-emerald-50/20">
              ${roundSums.sum4 ? `<span class="text-sm font-black">${roundSums.sum4.val}</span>` : '-'}
            </td>
          </tr>
        `;
      });

      if (!rowsHtml) {
        tbody.innerHTML = '<tr><td colspan="12" class="p-8 text-center text-slate-400">등록된 모의고사 성적이 없습니다. [입시지도 > 모의고사 분석]에서 성적을 먼저 입력해주세요.</td></tr>';
      } else {
        tbody.innerHTML = rowsHtml;
      }

      const simRound = document.getElementById('minCheckSimRoundSelect')?.value || '9월모평';
      const tamMethod = document.getElementById('minCheckTamMethodSelect')?.value || 'top1';
      const roundData = roundAnalysisMap[simRound];

      const { data: cards } = await supabaseClient.from('applications_12').select('*').eq('user_id', targetUserId).eq('slot_type', 'susi');
      if (!cards || cards.length === 0 || !cards.some(c => c.university)) {
        cardsGrid.innerHTML = '<p class="col-span-full text-center text-slate-400 py-8">등록된 수시 지망 대학이 없습니다. [입시지도 > 입시상담카드]에서 대학을 등록해보세요.</p>';
        return;
      }

      // 탐구 반영 방식에 맞는 합산 객체 선택
      let chosenSums = roundData?.top1Sums;
      let tamMethodLabel = '탐구 1과목';
      if (tamMethod === 'floor') {
        chosenSums = roundData?.floorSums;
        tamMethodLabel = '탐구 2과목 버림';
      } else if (tamMethod === 'round') {
        chosenSums = roundData?.roundSums;
        tamMethodLabel = '탐구 2과목 반올림';
      }

      cardsGrid.innerHTML = cards.map(c => {
        if (!c.university) return '';
        const criteria = (c.min_criteria || '').trim();

        let statusHtml = '';
        if (!criteria || criteria === '없음' || criteria === '-') {
          statusHtml = '<span class="px-2 py-1 bg-slate-100 text-slate-500 rounded text-xs font-bold">수능최저 없음</span>';
        } else if (!roundData) {
          statusHtml = `<span class="px-2 py-1 bg-slate-100 text-slate-400 rounded text-xs">${simRound} 미응시</span>`;
        } else {
   const match = criteria.match(/([2-4])\s*(?:개\s*(?:영역\s*)?)?합\s*([0-9]{1,2})/);
          if (match) {
            const reqCount = parseInt(match[1]);
            const targetSum = parseInt(match[2]);

            const bestSumObj = reqCount === 2 ? chosenSums?.sum2 : (reqCount === 3 ? chosenSums?.sum3 : chosenSums?.sum4);

            if (bestSumObj && bestSumObj.val !== null) {
              const diff = targetSum - bestSumObj.val;
              if (diff >= 0) {
                statusHtml = `
                  <div class="space-y-1">
                    <span class="px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded-md text-xs font-black inline-flex items-center gap-1">
                      <i data-lucide="check-circle-2" class="w-3.5 h-3.5"></i> 최저 충족 (${bestSumObj.val}합)
                    </span>
                    <span class="text-[10px] text-emerald-600 block font-semibold">+${diff}등급 여유</span>
                  </div>
                `;
              } else {
                statusHtml = `
                  <div class="space-y-1">
                    <span class="px-2.5 py-1 bg-rose-100 text-rose-700 rounded-md text-xs font-black inline-flex items-center gap-1">
                      <i data-lucide="alert-circle" class="w-3.5 h-3.5"></i> 최저 미달 (${bestSumObj.val}합)
                    </span>
                    <span class="text-[10px] text-rose-600 block font-semibold">${Math.abs(diff)}등급 향상 필요</span>
                  </div>
                `;
              }
            } else {
              statusHtml = '<span class="px-2 py-1 bg-slate-100 text-slate-500 rounded text-xs">영역 수 부족</span>';
            }
          } else {
            statusHtml = `<span class="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-bold" title="${criteria}">기준: ${criteria}</span>`;
          }
        }

        return `
          <div class="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between space-y-2">
            <div>
  <div class="flex items-center justify-between">
    <span class="text-[11px] font-bold text-blue-600">${c.slot_num}지망</span>
    <span class="text-[10px] text-slate-400">${escapeHtml(c.admission_type) || '-'}</span>
  </div>
  <h4 class="font-black text-slate-800 text-sm mt-0.5">${escapeHtml(c.university)} ${escapeHtml(c.department) || ''}</h4>
  <p class="text-xs text-slate-500 mt-1">최저 기준: <b class="text-slate-800">${escapeHtml(criteria) || '없음'}</b></p>
            </div>
            <div class="pt-2 border-t flex justify-between items-center">
              <span class="text-[11px] text-slate-400 font-medium">${simRound} 결과:</span>
              <div>${statusHtml}</div>
            </div>
          </div>
        `;
      }).join('');
      lucide.createIcons();
    }

    // =================================================================
    // 💡 원서 15장 (수시 6 + 특목 6 + 정시 3) 및 모의고사, 기초조사서 기능들
    // =================================================================
   function renderStudent12CardInputs() {
     const sGrid = document.getElementById('studentSusiGrid');
     const spGrid = document.getElementById('studentSpecialGrid');
     const jGrid = document.getElementById('studentJeongsiGrid');

     // 1. 수시 6장
     sGrid.innerHTML = [1,2,3,4,5,6].map(i => `
       <div class="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm text-xs space-y-2.5">
         <div class="flex items-center justify-between">
           <span class="font-bold text-blue-600">수시 지원 ${i}지망</span>
           <span id="susi_diag_badge_${i}"><span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-400">진단대기</span></span>
         </div>
         <input type="text" id="susi_univ_${i}" placeholder="대학교 (예: 고려대)" class="w-full px-2 py-1.5 border rounded">
         <input type="text" id="susi_dept_${i}" placeholder="모집단위 (예: 국어교육과)" class="w-full px-2 py-1.5 border rounded">
         <input type="text" id="susi_type_${i}" placeholder="전형 (예: 학생부교과(학교장추천))" class="w-full px-2 py-1.5 border rounded">
         <input type="text" id="susi_min_${i}" placeholder="수능최저 (예: 3합 7)" class="w-full px-2 py-1.5 border rounded font-semibold text-emerald-700 bg-emerald-50/30">
         <div>
           <label class="block text-[11px] font-bold text-slate-600 mb-1">학교장 추천서 필요 여부</label>
           <select id="susi_rec_${i}" class="w-full px-2 py-1.5 border rounded-lg bg-slate-50 font-bold text-slate-700 outline-none">
             <option value="X">추천서 불필요 (X)</option>
             <option value="O">추천서 필요 (O - 고교별 추천인원 제한 전형)</option>
           </select>
         </div>

         <div class="pt-1 border-t">
           <button type="button" onclick="toggleCardDetailInputs('susi', ${i})" class="w-full py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-[11px] font-bold transition flex items-center justify-center gap-1">
             <i data-lucide="search" class="w-3.5 h-3.5"></i> 🔍 3개년 입결 및 산출내신 입력
           </button>
           <div id="susi_detail_box_${i}" class="hidden mt-2 p-2.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2.5">
             <div>
               <label class="block text-[11px] font-bold text-slate-700 mb-1">📊 3개년 경쟁률 (:1)</label>
               <div class="grid grid-cols-3 gap-1">
                 <input type="number" step="0.01" id="susi_comp1_${i}" placeholder="2년전" class="p-1 border rounded bg-white text-center">
                 <input type="number" step="0.01" id="susi_comp2_${i}" placeholder="작년" class="p-1 border rounded bg-white text-center">
                 <input type="number" step="0.01" id="susi_comp3_${i}" placeholder="올해" class="p-1 border rounded bg-white text-center font-bold text-blue-600">
               </div>
             </div>
             <div>
               <label class="block text-[11px] font-bold text-slate-700 mb-1">🎯 3개년 70%컷 (내신등급)</label>
               <div class="grid grid-cols-3 gap-1">
                 <input type="number" step="0.01" id="susi_cut1_${i}" oninput="updateLiveCardDiag('susi', ${i})" placeholder="2년전" class="p-1 border rounded bg-white text-center">
                 <input type="number" step="0.01" id="susi_cut2_${i}" oninput="updateLiveCardDiag('susi', ${i})" placeholder="작년" class="p-1 border rounded bg-white text-center">
                 <input type="number" step="0.01" id="susi_cut3_${i}" oninput="updateLiveCardDiag('susi', ${i})" placeholder="최근" class="p-1 border rounded bg-white text-center font-bold text-emerald-600">
               </div>
             </div>
             <div class="grid grid-cols-2 gap-2">
               <div>
                 <label class="block text-[10px] font-bold text-slate-600 mb-0.5">작년/올해 모집인원</label>
                 <div class="flex items-center gap-1">
                   <input type="number" id="susi_rec_last_${i}" placeholder="작년" class="w-1/2 p-1 border rounded bg-white text-center">
                   <input type="number" id="susi_rec_curr_${i}" placeholder="올해" class="w-1/2 p-1 border rounded bg-white text-center font-bold text-blue-700">
                 </div>
               </div>
               <div>
                 <label class="block text-[10px] font-bold text-slate-600 mb-0.5">학교별 산출 내신</label>
                 <input type="number" step="0.01" id="susi_myscore_${i}" oninput="updateLiveCardDiag('susi', ${i})" placeholder="예: 2.35" class="w-full p-1 border rounded bg-white text-center font-black text-indigo-600">
               </div>
             </div>
           </div>
         </div>
       </div>
     `).join('');

     // 2. 특수목적대 6장 (수시와 동일 기능)
     spGrid.innerHTML = [1,2,3,4,5,6].map(i => `
       <div class="bg-white p-3.5 rounded-xl border border-purple-200 shadow-sm text-xs space-y-2.5">
         <div class="flex items-center justify-between">
           <span class="font-bold text-purple-600">특목/전문대 ${i}지망</span>
           <span id="spec_diag_badge_${i}"><span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-400">진단대기</span></span>
         </div>
         <input type="text" id="spec_univ_${i}" placeholder="학교 (예: KAIST/육사)" class="w-full px-2 py-1.5 border rounded">
         <input type="text" id="spec_dept_${i}" placeholder="학과/계열" class="w-full px-2 py-1.5 border rounded">
         <input type="text" id="spec_type_${i}" placeholder="전형구분" class="w-full px-2 py-1.5 border rounded">
         <input type="text" id="spec_memo_${i}" placeholder="비고/특이사항" class="w-full px-2 py-1.5 border rounded">
         <div>
           <label class="block text-[11px] font-bold text-slate-600 mb-1">학교장 추천서 필요 여부</label>
           <select id="spec_rec_${i}" class="w-full px-2 py-1.5 border rounded-lg bg-slate-50 font-bold text-slate-700 outline-none">
             <option value="X">추천서 불필요 (X)</option>
             <option value="O">추천서 필요 (O - 고교별 추천 전형)</option>
           </select>
         </div>

         <div class="pt-1 border-t">
           <button type="button" onclick="toggleCardDetailInputs('spec', ${i})" class="w-full py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-lg text-[11px] font-bold transition flex items-center justify-center gap-1">
             <i data-lucide="search" class="w-3.5 h-3.5"></i> 🔍 3개년 입결 및 산출내신 입력
           </button>
           <div id="spec_detail_box_${i}" class="hidden mt-2 p-2.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2.5">
             <div>
               <label class="block text-[11px] font-bold text-slate-700 mb-1">📊 3개년 경쟁률 (:1)</label>
               <div class="grid grid-cols-3 gap-1">
                 <input type="number" step="0.01" id="spec_comp1_${i}" placeholder="2년전" class="p-1 border rounded bg-white text-center">
                 <input type="number" step="0.01" id="spec_comp2_${i}" placeholder="작년" class="p-1 border rounded bg-white text-center">
                 <input type="number" step="0.01" id="spec_comp3_${i}" placeholder="올해" class="p-1 border rounded bg-white text-center font-bold text-purple-600">
               </div>
             </div>
             <div>
               <label class="block text-[11px] font-bold text-slate-700 mb-1">🎯 3개년 70%컷 (내신등급)</label>
               <div class="grid grid-cols-3 gap-1">
                 <input type="number" step="0.01" id="spec_cut1_${i}" oninput="updateLiveCardDiag('spec', ${i})" placeholder="2년전" class="p-1 border rounded bg-white text-center">
                 <input type="number" step="0.01" id="spec_cut2_${i}" oninput="updateLiveCardDiag('spec', ${i})" placeholder="작년" class="p-1 border rounded bg-white text-center">
                 <input type="number" step="0.01" id="spec_cut3_${i}" oninput="updateLiveCardDiag('spec', ${i})" placeholder="최근" class="p-1 border rounded bg-white text-center font-bold text-emerald-600">
               </div>
             </div>
             <div class="grid grid-cols-2 gap-2">
               <div>
                 <label class="block text-[10px] font-bold text-slate-600 mb-0.5">작년/올해 모집인원</label>
                 <div class="flex items-center gap-1">
                   <input type="number" id="spec_rec_last_${i}" placeholder="작년" class="w-1/2 p-1 border rounded bg-white text-center">
                   <input type="number" id="spec_rec_curr_${i}" placeholder="올해" class="w-1/2 p-1 border rounded bg-white text-center font-bold text-purple-700">
                 </div>
               </div>
               <div>
                 <label class="block text-[10px] font-bold text-slate-600 mb-0.5">학교별 산출 내신</label>
                 <input type="number" step="0.01" id="spec_myscore_${i}" oninput="updateLiveCardDiag('spec', ${i})" placeholder="예: 2.10" class="w-full p-1 border rounded bg-white text-center font-black text-indigo-600">
               </div>
             </div>
           </div>
         </div>
       </div>
     `).join('');

     // 3. 정시 일반 3장 (모의고사 & 백분위 기반)
     const jeongsiLabels = [{ num: 1, name: '정시 (가군)' }, { num: 2, name: '정시 (나군)' }, { num: 3, name: '정시 (다군)' }];
     jGrid.innerHTML = jeongsiLabels.map(j => `
       <div class="bg-white p-3.5 rounded-xl border border-amber-200 shadow-sm text-xs space-y-2.5">
         <div class="flex items-center justify-between">
           <span class="font-bold text-amber-700 flex items-center gap-1.5">
             <span class="w-2 h-2 rounded-full bg-amber-500"></span> ${j.name}
           </span>
           <span id="jeongsi_diag_badge_${j.num}"><span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-400">진단대기</span></span>
         </div>
         <input type="text" id="jeongsi_univ_${j.num}" placeholder="대학교 (예: 연세대)" class="w-full px-2 py-1.5 border rounded">
         <input type="text" id="jeongsi_dept_${j.num}" placeholder="모집단위 (예: 경영학과)" class="w-full px-2 py-1.5 border rounded">
         <input type="text" id="jeongsi_type_${j.num}" placeholder="전형 (예: 수능 일반)" class="w-full px-2 py-1.5 border rounded">
         <input type="text" id="jeongsi_memo_${j.num}" placeholder="대학환산점수 / 비고 (예: 712.5점)" class="w-full px-2 py-1.5 border rounded bg-amber-50/30">
         <div>
           <label class="block text-[11px] font-bold text-slate-600 mb-1">학교장 추천서 필요 여부</label>
           <select id="jeongsi_rec_${j.num}" class="w-full px-2 py-1.5 border rounded-lg bg-slate-50 font-bold text-slate-700 outline-none">
             <option value="X">추천서 불필요 (X)</option>
             <option value="O">추천서 필요 (O - 서울대 지균 등)</option>
           </select>
         </div>

         <div class="pt-1 border-t">
           <button type="button" onclick="toggleCardDetailInputs('jeongsi', ${j.num})" class="w-full py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 rounded-lg text-[11px] font-bold transition flex items-center justify-center gap-1">
             <i data-lucide="search" class="w-3.5 h-3.5"></i> 🔍 3개년 백분위컷 & 모의고사 비교
           </button>
           <div id="jeongsi_detail_box_${j.num}" class="hidden mt-2 p-2.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2.5">
             <div>
               <label class="block text-[11px] font-bold text-slate-700 mb-1">📊 3개년 경쟁률 (:1)</label>
               <div class="grid grid-cols-3 gap-1">
                 <input type="number" step="0.01" id="jeongsi_comp1_${j.num}" placeholder="2년전" class="p-1 border rounded bg-white text-center">
                 <input type="number" step="0.01" id="jeongsi_comp2_${j.num}" placeholder="작년" class="p-1 border rounded bg-white text-center">
                 <input type="number" step="0.01" id="jeongsi_comp3_${j.num}" placeholder="올해" class="p-1 border rounded bg-white text-center font-bold text-amber-700">
               </div>
             </div>
             <div>
               <label class="block text-[11px] font-bold text-slate-700 mb-1">🎯 3개년 70% 백분위컷 (%)</label>
               <div class="grid grid-cols-3 gap-1">
                 <input type="number" step="0.01" id="jeongsi_cut1_${j.num}" oninput="updateLiveCardDiag('jeongsi', ${j.num})" placeholder="2년전" class="p-1 border rounded bg-white text-center">
                 <input type="number" step="0.01" id="jeongsi_cut2_${j.num}" oninput="updateLiveCardDiag('jeongsi', ${j.num})" placeholder="작년" class="p-1 border rounded bg-white text-center">
                 <input type="number" step="0.01" id="jeongsi_cut3_${j.num}" oninput="updateLiveCardDiag('jeongsi', ${j.num})" placeholder="최근" class="p-1 border rounded bg-white text-center font-bold text-emerald-600">
               </div>
             </div>
             <div class="grid grid-cols-2 gap-2">
               <div>
                 <label class="block text-[10px] font-bold text-slate-600 mb-0.5">작년/올해 모집인원</label>
                 <div class="flex items-center gap-1">
                   <input type="number" id="jeongsi_rec_last_${j.num}" placeholder="작년" class="w-1/2 p-1 border rounded bg-white text-center">
                   <input type="number" id="jeongsi_rec_curr_${j.num}" placeholder="올해" class="w-1/2 p-1 border rounded bg-white text-center font-bold text-amber-800">
                 </div>
               </div>
               <div>
                 <label class="block text-[10px] font-bold text-slate-600 mb-0.5">비교 기준 모의고사</label>
                 <select id="jeongsi_mock_round_${j.num}" onchange="autoFetchMockScoreForJeongsi(${j.num})" class="w-full p-1 border rounded bg-white text-center font-bold text-blue-700">
                   <option value="9월모평" selected>9월 모평</option>
                   <option value="6월모평">6월 모평</option>
                   <option value="7월학평">7월 학평</option>
                   <option value="5월학평">5월 학평</option>
                   <option value="3월학평">3월 학평</option>
                   <option value="10월학평">10월 학평</option>
                   <option value="수능">수능</option>
                 </select>
               </div>
             </div>
             <div>
               <label class="block text-[10px] font-bold text-slate-600 mb-0.5">내 모의고사 백분위(국·수·탐 평균 %)</label>
               <input type="number" step="0.01" id="jeongsi_myscore_${j.num}" oninput="updateLiveCardDiag('jeongsi', ${j.num})" placeholder="모평 선택 시 자동 입력 또는 직접 입력 (예: 91.5)" class="w-full p-1 border rounded bg-white text-center font-black text-indigo-600">
             </div>
           </div>
         </div>
       </div>
     `).join('');
     lucide.createIcons();
   }

   // 모의고사 성적표에서 국·수·탐 평균 백분위 자동 계산 함수
async function autoFetchMockScoreForJeongsi(slotNum) {
  const round = document.getElementById(`jeongsi_mock_round_${slotNum}`)?.value;
  if (!round || !currentUser) return;

  const { data: scores } = await supabaseClient.from('mock_scores').select('*').eq('user_id', currentUser.id).eq('exam_round', round);
  if (!scores || scores.length === 0) {
    alert(`[${round}]에 등록된 모의고사 성적이 없습니다. [입시지도 > 모의고사 분석]에서 성적을 먼저 입력하거나 직접 점수를 입력해주세요.`);
    return;
  }

  const k = scores.find(s => s.subject_key === 'korean')?.percentile;
  const m = scores.find(s => s.subject_key === 'math')?.percentile;
  const t1 = scores.find(s => s.subject_key === 'tam1')?.percentile;
  const t2 = scores.find(s => s.subject_key === 'tam2')?.percentile;

  // [수정] 숫자가 아닌 값(NaN)이나 빈 칸을 더 안전하게 걸러내어 계산 튕김 방지
  const pList = [k, m, t1, t2]
    .map(v => (v !== null && v !== undefined && v !== '') ? Number(v) : NaN)
    .filter(v => !isNaN(v) && v > 0);

  if (pList.length === 0) {
    alert(`[${round}]에 등록된 백분위 성적이 없습니다.`);
    return;
  }

  const avg = (pList.reduce((a, b) => a + b, 0) / pList.length).toFixed(2);
  const targetInput = document.getElementById(`jeongsi_myscore_${slotNum}`);
  if (targetInput) {
    targetInput.value = avg;
    updateLiveCardDiag('jeongsi', slotNum);
  }
}
    
function toggleCardDetailInputs(type, num) {
  const box = document.getElementById(`${type}_detail_box_${num}`);
  if (box) box.classList.toggle('hidden');
}

   function updateLiveCardDiag(type, num) {
     const cutVal = document.getElementById(`${type}_cut3_${num}`)?.value || document.getElementById(`${type}_cut2_${num}`)?.value;
     const myScore = document.getElementById(`${type}_myscore_${num}`)?.value;
     const badgeEl = document.getElementById(`${type}_diag_badge_${num}`);
     if (!badgeEl) return;

     let diag;
     if (type === 'jeongsi') {
       // 정시: 백분위 기준 (높을수록 우수)
       diag = calculateJeongsiDiag(myScore, cutVal);
     } else {
       // 수시 / 특목대: 등급 기준 (낮을수록 우수)
       diag = calculateAdmissionDiag(myScore, cutVal);
     }
     badgeEl.innerHTML = getDiagBadgeHtml(diag);
   }
    
   async function loadStudentExisting12Cards() {
     const { data: cards } = await supabaseClient.from('applications_12').select('*').eq('user_id', currentUser.id);
     if (cards) {
       cards.forEach(c => {
   const prefix = (c.slot_type === 'special') ? 'spec' : c.slot_type;
         const num = c.slot_num;

         const u = document.getElementById(`${prefix}_univ_${num}`);
         const d = document.getElementById(`${prefix}_dept_${num}`);
         const t = document.getElementById(`${prefix}_type_${num}`);
         const m = document.getElementById(`${prefix === 'susi' ? 'susi_min' : prefix + '_memo'}_${num}`);
         const r = document.getElementById(`${prefix}_rec_${num}`);

         if (u) u.value = c.university || '';
         if (d) d.value = c.department || '';
         if (t) t.value = c.admission_type || '';
         if (m) m.value = (prefix === 'susi' ? c.min_criteria : c.memo) || '';
         if (r) r.value = c.recommendation || 'X';

         // 3개년 경쟁률 복원
         if (c.comp_rates && Array.isArray(c.comp_rates)) {
           if (c.comp_rates[0]) document.getElementById(`${prefix}_comp1_${num}`).value = c.comp_rates[0];
           if (c.comp_rates[1]) document.getElementById(`${prefix}_comp2_${num}`).value = c.comp_rates[1];
           if (c.comp_rates[2]) document.getElementById(`${prefix}_comp3_${num}`).value = c.comp_rates[2];
         }
         // 3개년 입결컷 복원
         if (c.cutoffs && Array.isArray(c.cutoffs)) {
           if (c.cutoffs[0]) document.getElementById(`${prefix}_cut1_${num}`).value = c.cutoffs[0];
           if (c.cutoffs[1]) document.getElementById(`${prefix}_cut2_${num}`).value = c.cutoffs[1];
           if (c.cutoffs[2]) document.getElementById(`${prefix}_cut3_${num}`).value = c.cutoffs[2];
         }
         // 모집인원 및 내신/백분위 점수 복원
         if (c.recruit_last) document.getElementById(`${prefix}_rec_last_${num}`).value = c.recruit_last;
         if (c.recruit_curr) document.getElementById(`${prefix}_rec_curr_${num}`).value = c.recruit_curr;
         if (c.my_score) document.getElementById(`${prefix}_myscore_${num}`).value = c.my_score;

         updateLiveCardDiag(prefix, num);
       });
     }
   }

async function saveStudent12Cards() {
  const records = [];
  const types = [
    { type: 'susi', prefix: 'susi', count: 6 },
    { type: 'special', prefix: 'spec', count: 6 },
    { type: 'jeongsi', prefix: 'jeongsi', count: 3 }
  ];

  types.forEach(({ type, prefix, count }) => {
    for (let i = 1; i <= count; i++) {
      const comp1 = parseFloat(document.getElementById(`${prefix}_comp1_${i}`)?.value) || null;
      const comp2 = parseFloat(document.getElementById(`${prefix}_comp2_${i}`)?.value) || null;
      const comp3 = parseFloat(document.getElementById(`${prefix}_comp3_${i}`)?.value) || null;

      const cut1 = parseFloat(document.getElementById(`${prefix}_cut1_${i}`)?.value) || null;
      const cut2 = parseFloat(document.getElementById(`${prefix}_cut2_${i}`)?.value) || null;
      const cut3 = parseFloat(document.getElementById(`${prefix}_cut3_${i}`)?.value) || null;

      const recLast = parseInt(document.getElementById(`${prefix}_rec_last_${i}`)?.value) || null;
      const recCurr = parseInt(document.getElementById(`${prefix}_rec_curr_${i}`)?.value) || null;
      const myScore = parseFloat(document.getElementById(`${prefix}_myscore_${i}`)?.value) || null;

      let diag;
      if (type === 'jeongsi') {
        diag = calculateJeongsiDiag(myScore, cut3 || cut2 || cut1);
      } else {
        diag = calculateAdmissionDiag(myScore, cut3 || cut2 || cut1);
      }

      const record = {
        user_id: currentUser.id,
        student_no: currentProfile.student_no,
        student_name: currentProfile.name,
        slot_type: type,
        slot_num: i,
        university: document.getElementById(`${prefix}_univ_${i}`)?.value.trim() || '',
        department: document.getElementById(`${prefix}_dept_${i}`)?.value.trim() || '',
        admission_type: document.getElementById(`${prefix}_type_${i}`)?.value.trim() || '',
        recommendation: document.getElementById(`${prefix}_rec_${i}`)?.value || 'X',
        comp_rates: [comp1, comp2, comp3],
        cutoffs: [cut1, cut2, cut3],
        recruit_last: recLast,
        recruit_curr: recCurr,
        my_score: myScore,
        diag_result: diag.text
      };

      if (type === 'susi') {
        record.min_criteria = document.getElementById(`susi_min_${i}`)?.value.trim() || '';
      } else {
        record.memo = document.getElementById(`${prefix}_memo_${i}`)?.value.trim() || '';
      }

      records.push(record);
    }
  });

  try {
    const { error: upsertErr } = await supabaseClient
      .from('applications_12')
      .upsert(records, { onConflict: 'user_id,slot_type,slot_num' });

    if (upsertErr) throw upsertErr;

    alert('수시 6장, 특목대 6장, 정시 3장의 모든 입시카드와 심층 분석 데이터가 안전하게 저장되었습니다!');
    loadHomeDashboardData();
    renderMinimumCheckAnalysis();
  } catch (err) {
    alert('저장 도중 오류가 발생했습니다: ' + err.message);
  }
}
    
    async function submitCounselRequest(e) {
      e.preventDefault();
      const date = document.getElementById('counselDate').value;
      const period = document.getElementById('counselPeriod').value;
      const topic = document.getElementById('counselTopic').value;
      const detail = document.getElementById('counselDetail').value.trim();

      await supabaseClient.from('counsel_requests').insert([{
        user_id: currentUser.id,
        student_no: currentProfile.student_no,
        student_name: currentProfile.name,
        class_num: currentProfile.class_num || 2,
        target_date: date,
        target_period: period,
        topic: topic,
        detail: detail,
        status: 'pending'
      }]);

      alert('상담 신청서가 담임선생님께 제출되었습니다!');
      document.getElementById('counselDetail').value = '';
      loadHomeDashboardData();
    }

let currentTeacherCardsCache = [];
let modalCompChartInstance = null;
let modalCutChartInstance = null;

   async function loadStudent12CardsForTeacher(directStudentId) {
     const studentId = directStudentId || document.getElementById('teacherStudentSelect')?.value;
     const container = document.getElementById('teacherCardsContainer');
     if (!studentId) {
       container.innerHTML = '<p class="text-center text-slate-400 py-12 bg-white rounded-xl border">학생을 선택해주세요.</p>';
       return;
     }

     const { data: cards } = await supabaseClient.from('applications_12').select('*').eq('user_id', studentId);
     currentTeacherCardsCache = cards || [];

     const susiList = cards ? cards.filter(c => c.slot_type === 'susi') : [];
     const specList = cards ? cards.filter(c => c.slot_type === 'special') : [];
     const jeongsiList = cards ? cards.filter(c => c.slot_type === 'jeongsi') : [];
     const jeongsiNames = { 1: '정시 (가군)', 2: '정시 (나군)', 3: '정시 (다군)' };

     container.innerHTML = `
       <!-- 1. 수시 6장 -->
       <div class="bg-white p-5 rounded-xl border border-slate-200 space-y-2">
         <div class="flex items-center justify-between">
           <h3 class="font-bold text-blue-700 text-sm">일반 수시 6장 지망 현황</h3>
           <span class="text-[11px] text-slate-400">💡 카드를 클릭하면 3개년 선 그래프가 열립니다.</span>
         </div>
         <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
           ${[1,2,3,4,5,6].map(num => {
             const c = susiList.find(x => x.slot_num === num) || {};
             const isRecRequired = (c.recommendation === 'O');
             const cutVal = (c.cutoffs && c.cutoffs[2]) || (c.cutoffs && c.cutoffs[1]);
             const diag = calculateAdmissionDiag(c.my_score, cutVal);
             return `
               <div onclick="openCardDetailModal('susi', ${num})" class="p-3.5 rounded-xl border text-xs flex flex-col justify-between space-y-2 transition cursor-pointer hover:shadow-md hover:border-blue-400 ${isRecRequired ? 'bg-rose-50/40 border-rose-200' : 'bg-slate-50 border-slate-200'}">
                 <div>
                   <div class="flex items-center justify-between mb-1">
                     <span class="font-bold text-blue-600">${num}지망</span>
                     <div class="flex items-center gap-1">${getDiagBadgeHtml(diag)}${isRecRequired ? '<span class="px-1.5 py-0.5 bg-rose-600 text-white rounded font-black text-[9px]">추천 O</span>' : ''}</div>
                   </div>
                   <div class="font-black text-slate-800 text-sm mt-0.5">${c.university ? escapeHtml(c.university) : '<span class="text-slate-400 font-normal">미입력</span>'}</div>
                   <div class="text-slate-700 mt-1">학과: <b class="text-slate-800">${escapeHtml(c.department) || '-'}</b></div>
                   <div class="text-slate-500">전형: ${escapeHtml(c.admission_type) || '-'}</div>
                   <div class="text-emerald-700 font-semibold mt-1">최저: ${escapeHtml(c.min_criteria) || '-'}</div>
                 </div>
                 <div class="pt-2 border-t flex items-center justify-between text-[11px]">
                   <span class="text-slate-500">산출내신: <b class="text-indigo-600">${c.my_score ? c.my_score + '등급' : '-'}</b></span>
                   <span class="text-blue-600 font-bold">상세보기 →</span>
                 </div>
               </div>
             `;
           }).join('')}
         </div>
       </div>

       <!-- 2. 특수목적대 6장 (클릭 시 팝업 지원) -->
       <div class="bg-white p-5 rounded-xl border border-purple-200 space-y-2">
         <div class="flex items-center justify-between">
           <h3 class="font-bold text-purple-700 text-sm">특수목적대 / 전문대 6장 현황</h3>
           <span class="text-[11px] text-slate-400">💡 카드를 클릭하면 3개년 선 그래프가 열립니다.</span>
         </div>
         <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
           ${[1,2,3,4,5,6].map(num => {
             const c = specList.find(x => x.slot_num === num) || {};
             const isRecRequired = (c.recommendation === 'O');
             const cutVal = (c.cutoffs && c.cutoffs[2]) || (c.cutoffs && c.cutoffs[1]);
             const diag = calculateAdmissionDiag(c.my_score, cutVal);
             return `
               <div onclick="openCardDetailModal('special', ${num})" class="p-3.5 rounded-xl border text-xs flex flex-col justify-between space-y-2 transition cursor-pointer hover:shadow-md hover:border-purple-400 ${isRecRequired ? 'bg-purple-50/60 border-purple-300' : 'bg-slate-50 border-slate-200'}">
                 <div>
                   <div class="flex items-center justify-between mb-1">
                     <span class="font-bold text-purple-600">${num}지망</span>
                     <div class="flex items-center gap-1">${getDiagBadgeHtml(diag)}${isRecRequired ? '<span class="px-1.5 py-0.5 bg-purple-600 text-white rounded font-black text-[9px]">추천 O</span>' : ''}</div>
                   </div>
                   <div class="font-black text-slate-800 text-sm mt-0.5">${c.university ? escapeHtml(c.university) : '<span class="text-slate-400 font-normal">미입력</span>'}</div>
                   <div class="text-slate-700 mt-1">학과: <b class="text-slate-800">${escapeHtml(c.department) || '-'}</b></div>
                   <div class="text-slate-500">전형: ${escapeHtml(c.admission_type) || '-'}</div>
                   <div class="text-slate-500">비고: ${escapeHtml(c.memo) || '-'}</div>
                 </div>
                 <div class="pt-2 border-t flex items-center justify-between text-[11px]">
                   <span class="text-slate-500">산출내신: <b class="text-indigo-600">${c.my_score ? c.my_score + '등급' : '-'}</b></span>
                   <span class="text-purple-600 font-bold">상세보기 →</span>
                 </div>
               </div>
             `;
           }).join('')}
         </div>
       </div>

       <!-- 3. 정시 3장 (가·나·다군 - 백분위 기반 클릭 지원) -->
       <div class="bg-white p-5 rounded-xl border border-amber-200 space-y-2">
         <div class="flex items-center justify-between">
           <h3 class="font-bold text-amber-700 text-sm">정시 3장 (가 · 나 · 다 군) 지망 현황</h3>
           <span class="text-[11px] text-slate-400">💡 카드를 클릭하면 3개년 백분위컷 선 그래프가 열립니다.</span>
         </div>
         <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
           ${[1, 2, 3].map(num => {
             const c = jeongsiList.find(x => x.slot_num === num) || {};
             const isRecRequired = (c.recommendation === 'O');
             const cutVal = (c.cutoffs && c.cutoffs[2]) || (c.cutoffs && c.cutoffs[1]);
             const diag = calculateJeongsiDiag(c.my_score, cutVal);
             return `
               <div onclick="openCardDetailModal('jeongsi', ${num})" class="p-3.5 rounded-xl border text-xs flex flex-col justify-between space-y-2 transition cursor-pointer hover:shadow-md hover:border-amber-400 ${isRecRequired ? 'bg-amber-50 border-amber-300' : 'bg-amber-50/40 border-amber-200'}">
                 <div>
                   <div class="flex items-center justify-between mb-1">
                     <span class="font-bold text-amber-700">${jeongsiNames[num]}</span>
                     <div class="flex items-center gap-1">${getDiagBadgeHtml(diag)}${isRecRequired ? '<span class="px-1.5 py-0.5 bg-amber-600 text-white rounded font-black text-[9px]">추천 O</span>' : ''}</div>
                   </div>
                   <div class="font-black text-slate-800 text-sm mt-0.5">${c.university ? escapeHtml(c.university) : '<span class="text-slate-400 font-normal">미입력</span>'}</div>
                   <div class="text-slate-700 mt-1">학과: <b class="text-slate-800">${escapeHtml(c.department) || '-'}</b></div>
                   <div class="text-slate-500">전형: ${escapeHtml(c.admission_type) || '-'}</div>
                   <div class="text-slate-600">환산점수/비고: ${escapeHtml(c.memo) || '-'}</div>
                 </div>
                 <div class="pt-2 border-t flex items-center justify-between text-[11px]">
                   <span class="text-slate-500">모평백분위: <b class="text-indigo-600">${c.my_score ? c.my_score + '%' : '-'}</b></span>
                   <span class="text-amber-700 font-bold">상세보기 →</span>
                 </div>
               </div>
             `;
           }).join('')}
         </div>
       </div>
     `;
     lucide.createIcons();
   }

function openCardDetailModal(slotType, slotNum) {
  const card = currentTeacherCardsCache.find(c => c.slot_type === slotType && c.slot_num === slotNum);
  if (!card || !card.university) return alert('학생이 아직 대학 정보를 입력하지 않았습니다.');

  const typeLabels = { susi: '수시', special: '특목/전문', jeongsi: '정시' };
  const isJeongsi = (slotType === 'jeongsi');
  const jeongsiNames = { 1: '가군', 2: '나군', 3: '다군' };

  // 배지 라벨: 수시/특목은 지망 순서, 정시는 (가/나/다군) 표시
  document.getElementById('modalCardSlotBadge').innerText = isJeongsi 
    ? `정시 (${jeongsiNames[slotNum] || slotNum + '지망'})` 
    : `${typeLabels[slotType]} ${slotNum}지망`;

  document.getElementById('modalCardUnivTitle').innerText = `${card.university} ${card.department || ''}`;
  document.getElementById('modalCardTypeSub').innerText = `${card.admission_type || '전형 미입력'} | ${isJeongsi ? '비고: ' + (card.memo || '-') : '최저: ' + (card.min_criteria || '없음')}`;

  // 모집인원 변동 요약
  const rLast = card.recruit_last || null;
  const rCurr = card.recruit_curr || null;
  const rSummaryEl = document.getElementById('modalCardRecruitSummary');
  const rDiffEl = document.getElementById('modalCardRecruitDiff');
  if (rLast || rCurr) {
    rSummaryEl.innerText = `작년 ${rLast ?? '?'}명 → 올해 ${rCurr ?? '?'}명`;
    if (rLast && rCurr) {
      const diff = rCurr - rLast;
      rDiffEl.innerText = diff > 0 ? `(${diff}명 증원)` : (diff < 0 ? `(${Math.abs(diff)}명 감원)` : '(변동 없음)');
      rDiffEl.className = diff > 0 ? 'text-[11px] font-bold text-emerald-600' : (diff < 0 ? 'text-[11px] font-bold text-rose-600' : 'text-[11px] font-bold text-slate-400');
    }
  } else {
    rSummaryEl.innerText = '모집인원 미입력';
    rDiffEl.innerText = '';
  }

  // 70%컷 및 점수 진단
  const cutVal = (card.cutoffs && card.cutoffs[2]) || (card.cutoffs && card.cutoffs[1]) || (card.cutoffs && card.cutoffs[0]);
  let diag;
  if (isJeongsi) {
    diag = calculateJeongsiDiag(card.my_score, cutVal);
  } else {
    diag = calculateAdmissionDiag(card.my_score, cutVal);
  }

  document.getElementById('modalCardDiagBadge').innerHTML = getDiagBadgeHtml(diag);

  const scoreSummaryEl = document.getElementById('modalCardScoreSummary');
  const scoreDiffEl = document.getElementById('modalCardCutoffDiff');
  const unit = isJeongsi ? '%' : '등급';
  scoreSummaryEl.innerText = `내 점수: ${card.my_score ? card.my_score + unit : '미입력'}`;
  scoreDiffEl.innerText = (diag.diff) ? `(합격선 대비 ${diag.diff})` : '';

  // 팝업 내부 제목도 수시(내신) / 정시(백분위)에 맞추어 전환
  const scoreTitleEl = document.getElementById('modalCardScoreTitle');
  if (scoreTitleEl) {
    scoreTitleEl.innerText = isJeongsi ? '모의고사 백분위 vs 최근 합격선' : '학교별 산출 내신 vs 최근 합격선';
  }
  const cutChartTitleEl = document.getElementById('modalCardCutChartTitle');
  if (cutChartTitleEl) {
    cutChartTitleEl.innerHTML = `<i data-lucide="line-chart" class="w-4 h-4 text-emerald-600"></i> 3개년 70% ${isJeongsi ? '백분위컷 추이 (%)' : '합격컷 추이 (등급)'}`;
  }

  document.getElementById('cardDetailModal').classList.remove('hidden');
  renderModalCharts(card.comp_rates || [], card.cutoffs || [], card.my_score, isJeongsi);
  lucide.createIcons();
}

function closeCardDetailModal() {
  document.getElementById('cardDetailModal').classList.add('hidden');
}
    
   function renderModalCharts(compRates, cutoffs, myScore, isJeongsi = false) {
     const years = ['2025', '2026', '2027'];

     // 1) 경쟁률 차트
     const compCanvas = document.getElementById('cardCompChart');
     if (modalCompChartInstance) modalCompChartInstance.destroy();
     if (compCanvas) {
       modalCompChartInstance = new Chart(compCanvas, {
         type: 'line',
         data: {
           labels: years,
           datasets: [{
             label: '경쟁률 (:1)',
             data: compRates,
             borderColor: '#2563eb',
             backgroundColor: '#2563eb',
             borderWidth: 2,
             pointRadius: 4,
             tension: 0.2,
             spanGaps: true
           }]
         },
         options: {
           responsive: true,
           maintainAspectRatio: false,
           scales: { y: { beginAtZero: false } }
         }
       });
     }

     // 2) 입결컷 차트 (수시/특목: 등급 역정렬 / 정시: 백분위 0~100 정상정렬)
     const cutCanvas = document.getElementById('cardCutChart');
     if (modalCutChartInstance) modalCutChartInstance.destroy();
     if (cutCanvas) {
       const cutTitle = isJeongsi ? '70% 백분위컷 (%)' : '70% 입결컷 (등급)';
       const scoreTitle = isJeongsi ? '내 모의고사 백분위' : '내 산출내신';

       const datasets = [{
         label: cutTitle,
         data: cutoffs,
         borderColor: isJeongsi ? '#d97706' : '#059669',
         backgroundColor: isJeongsi ? '#d97706' : '#059669',
         borderWidth: 2,
         pointRadius: 4,
         tension: 0.2,
         spanGaps: true
       }];

       if (myScore && !isNaN(myScore)) {
         datasets.push({
           label: scoreTitle,
           data: [myScore, myScore, myScore],
           borderColor: '#7c3aed',
           borderDash: [4, 4],
           pointRadius: 0,
           borderWidth: 2
         });
       }

       modalCutChartInstance = new Chart(cutCanvas, {
         type: 'line',
         data: { labels: years, datasets },
         options: {
           responsive: true,
           maintainAspectRatio: false,
           scales: {
             y: {
               reverse: !isJeongsi, // 수시는 등급이므로 1등급이 상단(역정렬), 정시는 백분위이므로 100이 상단(정상)
               suggestedMin: isJeongsi ? 50 : 1.0,
               suggestedMax: isJeongsi ? 100 : 6.0
             }
           }
         }
       });
     }
   }
      
    const SUBJECT_ROWS = [
      { key: 'korean', name: '국어', options: ['화법과 작문', '언어와 매체'] },
      { key: 'math', name: '수학', options: ['확률과 통계', '미적분', '기하'] },
      { key: 'english', name: '영어', options: ['영어(절대)'] },
      { key: 'history', name: '한국사', options: ['한국사(절대)'] },
      { key: 'tam1', name: '탐구1', options: ['생활과 윤리','윤리와 사상','한국지리','세계지리','사회·문화','경제','정치와 법','동아시아사','세계사','물리학Ⅰ','화학Ⅰ','생명과학Ⅰ','지구과학Ⅰ','물리학II','화학II','생명과학II','지구과학II'] },
      { key: 'tam2', name: '탐구2', options: ['생활과 윤리','윤리와 사상','한국지리','세계지리','사회·문화','경제','정치와 법','동아시아사','세계사','물리학Ⅰ','화학Ⅰ','생명과학Ⅰ','지구과학Ⅰ','물리학II','화학II','생명과학II','지구과학II'] }
    ];

    function renderMockScoreInputs() {
      const tbody = document.getElementById('mockInputTableBody');
      tbody.innerHTML = SUBJECT_ROWS.map(s => `
        <tr>
          <td class="p-2.5 font-bold text-slate-700">${s.name}</td>
          <td class="p-2.5">
            <select id="mock_subj_${s.key}" class="px-2 py-1 border rounded bg-white font-medium">
              ${s.options.map(opt => `<option value="${opt}">${opt}</option>`).join('')}
            </select>
          </td>
          <td class="p-2.5"><input type="number" id="mock_raw_${s.key}" placeholder="0~100" class="w-full px-2 py-1 border rounded"></td>
          <td class="p-2.5"><input type="number" id="mock_std_${s.key}" placeholder="표점" class="w-full px-2 py-1 border rounded"></td>
          <td class="p-2.5"><input type="number" step="0.01" id="mock_pct_${s.key}" placeholder="백분위" class="w-full px-2 py-1 border rounded font-bold text-blue-600"></td>
          <td class="p-2.5"><input type="number" step="0.01" id="mock_cumpct_${s.key}" placeholder="누적" class="w-full px-2 py-1 border rounded"></td>
          <td class="p-2.5"><input type="number" id="mock_grd_${s.key}" placeholder="등급" min="1" max="9" class="w-full px-2 py-1 border rounded font-bold"></td>
        </tr>
      `).join('');
    }

    async function loadStudentMockScoresForRound() {
      const round = document.getElementById('mockRoundSelect').value;
      const { data: scores } = await supabaseClient.from('mock_scores').select('*').eq('user_id', currentUser.id).eq('exam_round', round);

      SUBJECT_ROWS.forEach(s => {
        document.getElementById(`mock_raw_${s.key}`).value = '';
        document.getElementById(`mock_std_${s.key}`).value = '';
        document.getElementById(`mock_pct_${s.key}`).value = '';
        document.getElementById(`mock_cumpct_${s.key}`).value = '';
        document.getElementById(`mock_grd_${s.key}`).value = '';
      });

      if (scores) {
        scores.forEach(row => {
          const s = SUBJECT_ROWS.find(item => item.key === row.subject_key);
          if (s) {
            const selSubj = document.getElementById(`mock_subj_${s.key}`);
            if (selSubj) selSubj.value = row.subject_name;
            document.getElementById(`mock_raw_${s.key}`).value = row.raw_score ?? '';
            document.getElementById(`mock_std_${s.key}`).value = row.standard_score ?? '';
            document.getElementById(`mock_pct_${s.key}`).value = row.percentile ?? '';
            document.getElementById(`mock_cumpct_${s.key}`).value = row.cum_percentile ?? '';
            document.getElementById(`mock_grd_${s.key}`).value = row.grade ?? '';
          }
        });
      }
    }

    async function saveMockScores() {
      const round = document.getElementById('mockRoundSelect').value;
      const records = [];

      SUBJECT_ROWS.forEach(s => {
        const subjName = document.getElementById(`mock_subj_${s.key}`).value;
        const raw = document.getElementById(`mock_raw_${s.key}`).value;
        const std = document.getElementById(`mock_std_${s.key}`).value;
        const pct = document.getElementById(`mock_pct_${s.key}`).value;
        const cumpct = document.getElementById(`mock_cumpct_${s.key}`).value;
        const grd = document.getElementById(`mock_grd_${s.key}`).value;

        if (raw || std || pct || grd) {
          records.push({
            user_id: currentUser.id,
            exam_round: round,
            subject_key: s.key,
            subject_name: subjName,
            raw_score: raw ? parseInt(raw) : null,
            standard_score: std ? parseInt(std) : null,
            percentile: pct ? parseFloat(pct) : null,
            cum_percentile: cumpct ? parseFloat(cumpct) : null,
            grade: grd ? parseInt(grd) : null
          });
        }
      });

      if (records.length === 0) return alert('입력된 점수가 없습니다.');

   const { error: mockErr } = await supabaseClient
     .from('mock_scores')
     .upsert(records, { onConflict: 'user_id,exam_round,subject_key' });

   if (mockErr) {
     alert('모의고사 성적 저장 실패: ' + mockErr.message);
     return;
   }
   alert(`${round} 모의고사 성적이 성공적으로 저장되었습니다!`);
      renderMockChart(currentUser.id, 'studentMockChart');
      renderMinimumCheckAnalysis();
    }

    async function renderMockChart(userId, canvasId) {
      const rounds = ['3월학평', '5월학평', '6월모평', '7월학평', '9월모평', '10월학평', '수능'];
      const { data: allScores } = await supabaseClient.from('mock_scores').select('*').eq('user_id', userId);

      const korData = [];
      const mathData = [];
      const totalAvgData = [];

      rounds.forEach(r => {
        const rScores = allScores ? allScores.filter(s => s.exam_round === r) : [];
        const k = rScores.find(s => s.subject_key === 'korean');
        const m = rScores.find(s => s.subject_key === 'math');
        const kPct = k && k.percentile !== null ? parseFloat(k.percentile) : null;
        const mPct = m && m.percentile !== null ? parseFloat(m.percentile) : null;

        korData.push(kPct);
        mathData.push(mPct);

        if (kPct !== null && mPct !== null) totalAvgData.push(parseFloat(((kPct + mPct) / 2).toFixed(2)));
        else totalAvgData.push(null);
      });

      const canvas = document.getElementById(canvasId);
      if (!canvas) return;

      if (canvasId === 'studentMockChart' && studentChartInstance) studentChartInstance.destroy();
      if (canvasId === 'teacherMockChartCanvas' && teacherChartInstance) teacherChartInstance.destroy();

      const newChart = new Chart(canvas, {
        type: 'line',
        data: {
          labels: rounds,
          datasets: [
            { label: '국어 백분위', data: korData, borderColor: '#2563eb', backgroundColor: '#2563eb', tension: 0.2, spanGaps: true },
            { label: '수학 백분위', data: mathData, borderColor: '#dc2626', backgroundColor: '#dc2626', tension: 0.2, spanGaps: true },
            { label: '국·수 평균', data: totalAvgData, borderColor: '#ea580c', backgroundColor: '#ea580c', borderWidth: 3, pointRadius: 4, tension: 0.2, spanGaps: true }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: { y: { min: 0, max: 100 } }
        }
      });

      if (canvasId === 'studentMockChart') studentChartInstance = newChart;
      else teacherChartInstance = newChart;
    }

    async function loadStudentMockForTeacher(directStudentId) {
const studentId = directStudentId || document.getElementById('mockStudentSelect')?.value;
      const container = document.getElementById('teacherMockContainer');
      if (!studentId) {
        container.innerHTML = '<p class="text-center text-slate-400 py-12 bg-white rounded-xl border">학생을 선택해주세요.</p>';
        return;
      }
      container.innerHTML = `
        <div class="bg-white p-6 rounded-2xl border shadow-sm space-y-4">
          <h3 class="font-bold text-slate-800 text-sm">회차별 백분위 변동 추이</h3>
          <div class="h-72 w-full"><canvas id="teacherMockChartCanvas"></canvas></div>
        </div>
      `;
      renderMockChart(studentId, 'teacherMockChartCanvas');
    }

    async function loadMySurveyData() {
      const { data } = await supabaseClient.from('student_surveys').select('*').eq('user_id', currentUser.id).single();
      if (data) {
        document.getElementById('surv_father_name').value = data.father_name || '';
        document.getElementById('surv_father_phone').value = data.father_phone || '';
        document.getElementById('surv_mother_name').value = data.mother_name || '';
        document.getElementById('surv_mother_phone').value = data.mother_phone || '';
        document.getElementById('surv_student_phone').value = data.student_phone || '';
        document.getElementById('surv_siblings').value = data.siblings || '';
        document.getElementById('surv_address').value = data.address || '';
        document.getElementById('surv_career').value = data.career_hope || '';
        document.getElementById('surv_notes').value = data.special_notes || '';

        // ★ [핵심 보강] 기존에 학생이 체크했던 2학년/3학년 과목 체크박스 복원!
        if (data.selected_subjects) {
          const g2 = data.selected_subjects.grade2 || [];
          const g3 = data.selected_subjects.grade3 || [];
          document.querySelectorAll('input[name="grade2_sub"]').forEach(cb => {
            cb.checked = g2.includes(cb.value);
          });
          document.querySelectorAll('input[name="grade3_sub"]').forEach(cb => {
            cb.checked = g3.includes(cb.value);
          });
        }
      }
    }

    async function saveStudentSurvey(e) {
      e.preventDefault();
      const g2Selected = Array.from(document.querySelectorAll('input[name="grade2_sub"]:checked')).map(c => c.value);
      const g3Selected = Array.from(document.querySelectorAll('input[name="grade3_sub"]:checked')).map(c => c.value);

      const surveyObj = {
        user_id: currentUser.id,
        father_name: document.getElementById('surv_father_name').value.trim(),
        father_phone: document.getElementById('surv_father_phone').value.trim(),
        mother_name: document.getElementById('surv_mother_name').value.trim(),
        mother_phone: document.getElementById('surv_mother_phone').value.trim(),
        student_phone: document.getElementById('surv_student_phone').value.trim(),
        siblings: document.getElementById('surv_siblings').value.trim(),
        address: document.getElementById('surv_address').value.trim(),
        career_hope: document.getElementById('surv_career').value.trim(),
        special_notes: document.getElementById('surv_notes').value.trim(),
        selected_subjects: { grade2: g2Selected, grade3: g3Selected },
        updated_at: new Date()
      };

      await supabaseClient.from('student_surveys').upsert(surveyObj);
      alert('기초조사서가 성공적으로 저장되었습니다!');
    }

    async function loadStudentSurveyForTeacher(targetStudentId) {
      const studentId = targetStudentId || document.getElementById('surveyStudentSelect')?.value;
      const card = document.getElementById('surveyTeacherDetailCard');
      if (!studentId || !card) return;

      card.innerHTML = '<p class="text-center text-slate-400 py-12">학생 기초조사서 및 이수 선택과목을 불러오는 중...</p>';

      const { data } = await supabaseClient.from('student_surveys').select('*').eq('user_id', studentId).single();
      if (!data) {
        card.innerHTML = '<p class="text-center text-slate-400 py-12">해당 학생이 아직 작성한 기초조사서가 없습니다.</p>';
        return;
      }

      // ★ 선택과목 배지 생성 (2학년: 초록 배지, 3학년: 파랑 배지)
      const g2Subjects = (data.selected_subjects && data.selected_subjects.grade2) ? data.selected_subjects.grade2 : [];
      const g3Subjects = (data.selected_subjects && data.selected_subjects.grade3) ? data.selected_subjects.grade3 : [];

      const g2Html = g2Subjects.length > 0
        ? g2Subjects.map(s => `<span class="px-2.5 py-1 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg text-xs font-bold inline-flex items-center gap-1 shadow-xs"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>${escapeHtml(s)}</span>`).join(' ')
        : '<span class="text-slate-400 text-xs italic">선택된 2학년 과목 없음</span>';

      const g3Html = g3Subjects.length > 0
        ? g3Subjects.map(s => `<span class="px-2.5 py-1 bg-blue-50 text-blue-800 border border-blue-200 rounded-lg text-xs font-bold inline-flex items-center gap-1 shadow-xs"><span class="w-1.5 h-1.5 rounded-full bg-blue-500"></span>${escapeHtml(s)}</span>`).join(' ')
        : '<span class="text-slate-400 text-xs italic">선택된 3학년 과목 없음</span>';

      card.innerHTML = `
        <div class="space-y-4 text-xs">
          <!-- 기본 인적사항 -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-100">
            <div>부모님 연락처: <b>${escapeHtml(data.father_name) || '-'}</b> (${escapeHtml(data.father_phone) || '-'}), <b>${escapeHtml(data.mother_name) || '-'}</b> (${escapeHtml(data.mother_phone) || '-'})</div>
            <div>학생 본인 연락처: <b class="text-blue-600 font-bold">${escapeHtml(data.student_phone) || '-'}</b></div>
            <div>형제/자매 관계: <b>${escapeHtml(data.siblings) || '-'}</b></div>
            <div class="md:col-span-2">실거주 주소: <b>${escapeHtml(data.address) || '-'}</b></div>
          </div>

          <!-- 진로희망 및 특이사항 -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div class="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
              <span class="text-[11px] font-bold text-slate-500 block mb-1">🎯 희망 진로 / 진학 희망 학과</span>
              <p class="text-sm font-black text-slate-800">${escapeHtml(data.career_hope) || '미입력'}</p>
            </div>
            <div class="bg-amber-50/60 p-3.5 rounded-xl border border-amber-200 shadow-xs">
              <span class="text-[11px] font-bold text-amber-800 block mb-1">💡 담임선생님 공유 특이사항 (건강, 배려사항 등)</span>
              <p class="text-xs text-slate-700 whitespace-pre-line leading-relaxed">${escapeHtml(data.special_notes) || '특이사항 없음'}</p>
            </div>
          </div>

          <!-- ★ [복구 완료] 선택과목 카드 영역 -->
          <div class="space-y-3 pt-2">
            <div class="bg-white p-4 rounded-xl border border-emerald-200 shadow-xs space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-black text-emerald-900 flex items-center gap-1.5">
                  <i data-lucide="check-square" class="w-4 h-4 text-emerald-600"></i> [2학년] 학교 이수 선택과목
                </span>
                <span class="text-[11px] text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">${g2Subjects.length}과목 이수</span>
              </div>
              <div class="flex flex-wrap gap-1.5 pt-1">${g2Html}</div>
            </div>

            <div class="bg-white p-4 rounded-xl border border-blue-200 shadow-xs space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-black text-blue-900 flex items-center gap-1.5">
                  <i data-lucide="check-square" class="w-4 h-4 text-blue-600"></i> [3학년] 현재 이수 중인 선택과목
                </span>
                <span class="text-[11px] text-blue-700 font-bold bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">${g3Subjects.length}과목 이수 중</span>
              </div>
              <div class="flex flex-wrap gap-1.5 pt-1">${g3Html}</div>
            </div>
          </div>
        </div>
      `;
      lucide.createIcons();
    }

// =================================================================
// 💡 [입시자료실] 드라이브 링크 & 유튜브 영상 연동 로직 (안정화 완료)
// 교체 방법: index.html 에서 "let currentMaterials = [];" 부터
// "closeYoutubePlayerModal() { ... }" 까지를 찾아서 아래 내용으로 통째로 교체하세요.
// =================================================================

    let currentMaterials = [];
    let activeMaterialFilter = 'all';
    let currentSearchKeyword = '';
    let activeMaterialSort = 'newest'; // 기본: 최신순

    function changeMaterialSort(val) {
      activeMaterialSort = val;
      renderMaterialCards();
    }

    function getYouTubeId(url) {
      if (!url) return null;
      const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
      const match = url.match(regExp);
      return (match && match[2].length === 11) ? match[2] : null;
    }

    function changeViewWithFilter(viewId, category) {
      changeView(viewId);
      filterMaterials(category);
    }

    function filterMaterials(cat) {
      activeMaterialFilter = cat;
      ['all', 'interview', 'eval_case', 'analysis', 'guideline'].forEach(c => {
        const btn = document.getElementById(`matFilter_${c}`);
        if (btn) {
          if (c === cat) {
            btn.className = 'px-3 py-1.5 rounded-lg bg-blue-600 text-white font-bold transition';
          } else {
            btn.className = 'px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold transition flex items-center gap-1';
          }
        }
      });
      renderMaterialCards();
    }

    function searchMaterials(keyword) {
      currentSearchKeyword = keyword.trim().toLowerCase();
      renderMaterialCards();
    }

    function openMaterialUploadModal() {
      document.getElementById('matTitleInput').value = '';
      document.getElementById('matTagsInput').value = '';
      document.getElementById('matDescInput').value = '';
      document.getElementById('matDriveUrlInput').value = '';
      document.getElementById('matYoutubeUrlInput').value = '';
      document.getElementById('matCategoryInput').value = activeMaterialFilter === 'all' ? 'interview' : activeMaterialFilter;
      document.getElementById('materialUploadModal').classList.remove('hidden');
      lucide.createIcons();
    }

    function closeMaterialUploadModal() {
      document.getElementById('materialUploadModal').classList.add('hidden');
    }

    async function loadAdmissionMaterials() {
      const { data, error } = await supabaseClient
        .from('admission_materials')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('자료 로드 실패:', error);
        currentMaterials = [];
      } else {
        currentMaterials = data || [];
      }
      renderMaterialCards();
    }

    async function submitNewMaterial() {
      const category = document.getElementById('matCategoryInput').value;
      const title = document.getElementById('matTitleInput').value.trim();
      const tags = document.getElementById('matTagsInput').value.trim();
      const desc = document.getElementById('matDescInput').value.trim();
      const driveUrl = document.getElementById('matDriveUrlInput').value.trim();
      const youtubeUrl = document.getElementById('matYoutubeUrlInput').value.trim();

      if (!title) return alert('자료 제목을 입력해주세요.');
      if (!driveUrl && !youtubeUrl) return alert('구글 드라이브 링크 또는 유튜브 링크 중 최소 하나는 입력해야 합니다.');

      const submitBtn = document.getElementById('matSubmitBtn');
      submitBtn.innerText = '등록 중...';
      submitBtn.disabled = true;

      const newRecord = {
        category: category,
        title: title,
        tags: tags,
        description: desc,
        drive_url: driveUrl,
        youtube_url: youtubeUrl,
        author_name: currentProfile ? currentProfile.name : '선생님'
      };

      const { error } = await supabaseClient.from('admission_materials').insert([newRecord]);

      submitBtn.innerText = '등록 완료';
      submitBtn.disabled = false;

      if (error) {
        alert('자료 등록 실패: ' + error.message);
        return;
      }

      alert('입시자료가 성공적으로 등록되었습니다!');
      closeMaterialUploadModal();
      loadAdmissionMaterials();
    }

    async function deleteMaterial(id) {
      if (!confirm('이 자료를 삭제할까요?')) return;

      const { error } = await supabaseClient.from('admission_materials').delete().eq('id', id);
      if (error) {
        alert('삭제 실패: ' + error.message);
        return;
      }

      alert('자료가 삭제되었습니다.');
      loadAdmissionMaterials();
    }

    function getMaterialBadge(cat) {
      switch (cat) {
        case 'interview': return '<span class="px-2 py-0.5 rounded bg-blue-100 text-blue-700 font-bold text-[10px] flex items-center gap-1"><i data-lucide="mic" class="w-3 h-3"></i> 면접 자료</span>';
        case 'eval_case': return '<span class="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold text-[10px] flex items-center gap-1"><i data-lucide="file-check-2" class="w-3 h-3"></i> 학종 평가 사례</span>';
        case 'analysis': return '<span class="px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 font-bold text-[10px] flex items-center gap-1"><i data-lucide="bar-chart-3" class="w-3 h-3"></i> 학종 결과 분석</span>';
        case 'guideline': return '<span class="px-2 py-0.5 rounded bg-amber-100 text-amber-700 font-bold text-[10px] flex items-center gap-1"><i data-lucide="folder-kanban" class="w-3.5 h-3.5"></i> 입학전형 모음</span>';
        default: return '<span class="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-bold text-[10px]">입시자료</span>';
      }
    }

    function renderMaterialCards() {
      const container = document.getElementById('materialsGrid');
      if (!container) return;

      let list = [...(currentMaterials || [])];

      if (activeMaterialFilter !== 'all') {
        list = list.filter(m => m.category === activeMaterialFilter);
      }

      if (currentSearchKeyword) {
        list = list.filter(m => 
          (m.title && m.title.toLowerCase().includes(currentSearchKeyword)) ||
          (m.tags && m.tags.toLowerCase().includes(currentSearchKeyword)) ||
          (m.description && m.description.toLowerCase().includes(currentSearchKeyword))
        );
      }

      // ★ 정렬 로직 (날짜순 / 가나다순)
      if (activeMaterialSort === 'newest') {
        list.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      } else if (activeMaterialSort === 'oldest') {
        list.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
      } else if (activeMaterialSort === 'name') {
        list.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ko'));
      }

      if (list.length === 0) {
        container.innerHTML = '<p class="col-span-full text-center text-slate-400 py-16">해당 조건에 일치하는 입시자료가 없습니다.</p>';
        return;
      }

      container.innerHTML = list.map(item => {
        const ytId = getYouTubeId(item.youtube_url);
        const tagBadges = item.tags 
          ? item.tags.split(',').map(t => `<span class="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded text-[10px] font-medium">#${escapeHtml(t.trim())}</span>`).join(' ')
          : '';

        return `
          <div class="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-blue-300 transition flex flex-col justify-between overflow-hidden group">
            ${ytId ? `
              <div class="relative aspect-video bg-slate-900 overflow-hidden cursor-pointer" onclick="openYoutubePlayerById('${item.id}')">
                <img src="https://img.youtube.com/vi/${ytId}/hqdefault.jpg" class="w-full h-full object-cover group-hover:scale-105 transition duration-300">
                <div class="absolute inset-0 bg-black/40 flex items-center justify-center group-hover:bg-black/20 transition">
                  <div class="w-12 h-12 rounded-full bg-rose-600 text-white flex items-center justify-center shadow-lg transform group-hover:scale-110 transition">
                    <i data-lucide="play" class="w-6 h-6 fill-current pl-0.5"></i>
                  </div>
                </div>
                <span class="absolute bottom-2 right-2 bg-black/70 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">유튜브 해설영상</span>
              </div>
            ` : ''}
            <div class="p-5 flex-1 space-y-3">
              <div class="flex items-center justify-between">
                <div>${getMaterialBadge(item.category)}</div>
                <div class="flex items-center gap-1.5">
                  <span class="text-[10px] text-slate-400">${item.created_at ? new Date(item.created_at).toLocaleDateString() : ''}</span>
                  ${isCurrentTeacher() ? `
                    <button onclick="deleteMaterial('${item.id}')" title="자료 삭제" class="text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition p-1">
                      <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                    </button>
                  ` : ''}
                </div>
              </div>
              <div>
                <h4 class="font-bold text-slate-800 text-sm leading-snug group-hover:text-blue-600 transition">${escapeHtml(item.title)}</h4>
                ${escapeHtml(item.description) ? `<p class="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">${escapeHtml(item.description)}</p>` : ''}
              </div>
              ${tagBadges ? `<div class="flex flex-wrap gap-1 pt-1">${tagBadges}</div>` : ''}
            </div>
            <div class="p-3 bg-slate-50 border-t border-slate-100 flex items-center gap-2">
              ${item.drive_url ? `
                <a href="${item.drive_url}" target="_blank" rel="noopener noreferrer" class="flex-1 py-2 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-sm">
                  <i data-lucide="external-link" class="w-3.5 h-3.5"></i> 구글 드라이브 자료 열기
                </a>
              ` : ''}
              ${ytId ? `
                <button onclick="openYoutubePlayerById('${item.id}')" class="py-2 px-3 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1">
                  <i data-lucide="video" class="w-3.5 h-3.5"></i> 영상 보기
                </button>
              ` : ''}
            </div>
          </div>
        `;
      }).join('');

      lucide.createIcons();
    }

    function openYoutubePlayerById(materialId) {
      const item = currentMaterials.find(m => m.id === materialId);
      if (!item) return;
      const ytId = getYouTubeId(item.youtube_url);
      if (!ytId) return alert('유효한 유튜브 영상 링크가 없습니다.');

      document.getElementById('ytModalTitle').innerText = item.title || '관련 입시 영상';
      document.getElementById('ytIframe').src = `https://www.youtube.com/embed/${ytId}?autoplay=1`;
      document.getElementById('youtubePlayerModal').classList.remove('hidden');
      lucide.createIcons();
    }

    function closeYoutubePlayerModal() {
      document.getElementById('ytIframe').src = '';
      document.getElementById('youtubePlayerModal').classList.add('hidden');
    }

    // =================================================================
    // 💡 [학습자료실] 교과별(국·수·영·탐) 드라이브 & 유튜브 연동 로직
    // =================================================================
    let currentStudyMaterials = [];
    let activeStudyFilter = 'all';
    let currentStudySearchKeyword = '';
    let activeStudySort = 'newest'; // 기본: 최신순

    function changeStudyMaterialSort(val) {
      activeStudySort = val;
      renderStudyCards();
    }

    function changeViewWithStudyFilter(viewId, category) {
      changeView(viewId);
      filterStudyMaterials(category);
    }

    function filterStudyMaterials(cat) {
      activeStudyFilter = cat;
   ['all', 'korean', 'math', 'english', 'inquiry', 'etc'].forEach(c => {
        const btn = document.getElementById(`studyFilter_${c}`);
        if (btn) {
          if (c === cat) {
            btn.className = 'px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold transition';
          } else {
            btn.className = 'px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold transition flex items-center gap-1';
          }
        }
      });
      renderStudyCards();
    }

    function searchStudyMaterials(keyword) {
      currentStudySearchKeyword = keyword.trim().toLowerCase();
      renderStudyCards();
    }

    function openStudyMaterialUploadModal() {
      document.getElementById('studyMatTitleInput').value = '';
      document.getElementById('studyMatTagsInput').value = '';
      document.getElementById('studyMatDescInput').value = '';
      document.getElementById('studyMatDriveUrlInput').value = '';
      document.getElementById('studyMatYoutubeUrlInput').value = '';
      document.getElementById('studyMatCategoryInput').value = activeStudyFilter === 'all' ? 'korean' : activeStudyFilter;
      document.getElementById('studyMaterialUploadModal').classList.remove('hidden');
      lucide.createIcons();
    }

    function closeStudyMaterialUploadModal() {
      document.getElementById('studyMaterialUploadModal').classList.add('hidden');
    }

    async function loadStudyMaterials() {
      const { data, error } = await supabaseClient
        .from('study_materials')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('학습자료 로드 실패:', error);
        currentStudyMaterials = [];
      } else {
        currentStudyMaterials = data || [];
      }
      renderStudyCards();
    }

    async function submitNewStudyMaterial() {
      const category = document.getElementById('studyMatCategoryInput').value;
      const title = document.getElementById('studyMatTitleInput').value.trim();
      const tags = document.getElementById('studyMatTagsInput').value.trim();
      const desc = document.getElementById('studyMatDescInput').value.trim();
      const driveUrl = document.getElementById('studyMatDriveUrlInput').value.trim();
      const youtubeUrl = document.getElementById('studyMatYoutubeUrlInput').value.trim();

      if (!title) return alert('자료 제목을 입력해주세요.');
      if (!driveUrl && !youtubeUrl) return alert('구글 드라이브 링크 또는 유튜브 링크 중 최소 하나는 입력해야 합니다.');

      const submitBtn = document.getElementById('studyMatSubmitBtn');
      submitBtn.innerText = '등록 중...';
      submitBtn.disabled = true;

      const newRecord = {
        category,
        title,
        tags,
        description: desc,
        drive_url: driveUrl,
        youtube_url: youtubeUrl,
        author_name: currentProfile ? currentProfile.name : '선생님'
      };

      const { error } = await supabaseClient.from('study_materials').insert([newRecord]);
      submitBtn.innerText = '등록 완료';
      submitBtn.disabled = false;

      if (error) {
        alert('자료 등록 실패: ' + error.message);
        return;
      }

      alert('새 학습자료가 등록되었습니다!');
      closeStudyMaterialUploadModal();
      loadStudyMaterials();
    }

    async function deleteStudyMaterial(id) {
      if (!confirm('이 학습자료를 삭제할까요?')) return;
      const { error } = await supabaseClient.from('study_materials').delete().eq('id', id);
      if (error) {
        alert('삭제 실패: ' + error.message);
        return;
      }
      alert('자료가 삭제되었습니다.');
      loadStudyMaterials();
    }

    function getStudyBadge(cat) {
      switch (cat) {
        case 'korean': return '<span class="px-2 py-0.5 rounded bg-blue-100 text-blue-700 font-bold text-[10px]">📘 국어</span>';
        case 'math': return '<span class="px-2 py-0.5 rounded bg-rose-100 text-rose-700 font-bold text-[10px]">📐 수학</span>';
        case 'english': return '<span class="px-2 py-0.5 rounded bg-amber-100 text-amber-700 font-bold text-[10px]">🔤 영어</span>';
        case 'inquiry': return '<span class="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold text-[10px]">🔬 탐구영역</span>';
                  case 'etc': return '<span class="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-bold text-[10px]">📁 기타</span>';

        default: return '<span class="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-bold text-[10px]">학습자료</span>';
      }
    }

    function renderStudyCards() {
      const container = document.getElementById('studyMaterialsGrid');
      if (!container) return;

      let list = [...(currentStudyMaterials || [])];

      if (activeStudyFilter !== 'all') {
        list = list.filter(m => m.category === activeStudyFilter);
      }
      if (currentStudySearchKeyword) {
        list = list.filter(m => 
          (m.title && m.title.toLowerCase().includes(currentStudySearchKeyword)) ||
          (m.tags && m.tags.toLowerCase().includes(currentStudySearchKeyword)) ||
          (m.description && m.description.toLowerCase().includes(currentStudySearchKeyword))
        );
      }

      // ★ 정렬 로직 (날짜순 / 가나다순)
      if (activeStudySort === 'newest') {
        list.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      } else if (activeStudySort === 'oldest') {
        list.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
      } else if (activeStudySort === 'name') {
        list.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ko'));
      }

      if (list.length === 0) {
        container.innerHTML = '<p class="col-span-full text-center text-slate-400 py-16">해당 조건에 일치하는 학습자료가 없습니다.</p>';
        return;
      }

      container.innerHTML = list.map(item => {
        const ytId = getYouTubeId(item.youtube_url);
        const tagBadges = item.tags 
          ? item.tags.split(',').map(t => `<span class="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded text-[10px] font-medium">#${escapeHtml(t.trim())}</span>`).join(' ')
          : '';

        return `
          <div class="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-emerald-300 transition flex flex-col justify-between overflow-hidden group">
            ${ytId ? `
              <div class="relative aspect-video bg-slate-900 overflow-hidden cursor-pointer" onclick="openYoutubePlayerForStudy('${item.id}')">
                <img src="https://img.youtube.com/vi/${ytId}/hqdefault.jpg" class="w-full h-full object-cover group-hover:scale-105 transition duration-300">
                <div class="absolute inset-0 bg-black/40 flex items-center justify-center group-hover:bg-black/20 transition">
                  <div class="w-12 h-12 rounded-full bg-rose-600 text-white flex items-center justify-center shadow-lg transform group-hover:scale-110 transition">
                    <i data-lucide="play" class="w-6 h-6 fill-current pl-0.5"></i>
                  </div>
                </div>
                <span class="absolute bottom-2 right-2 bg-black/70 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">유튜브 해설강의</span>
              </div>
            ` : ''}

            <div class="p-5 flex-1 space-y-3">
              <div class="flex items-center justify-between">
                <div>${getStudyBadge(item.category)}</div>
                <div class="flex items-center gap-1.5">
                  <span class="text-[10px] text-slate-400">${item.created_at ? new Date(item.created_at).toLocaleDateString() : ''}</span>
                  ${isCurrentTeacher() ? `
                    <button onclick="deleteStudyMaterial('${item.id}')" title="자료 삭제" class="text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition p-1">
                      <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                    </button>
                  ` : ''}
                </div>
              </div>

              <div>
                <h4 class="font-bold text-slate-800 text-sm leading-snug group-hover:text-emerald-600 transition">${escapeHtml(item.title)}</h4>
                ${escapeHtml(item.description) ? `<p class="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">${escapeHtml(item.description)}</p>` : ''}
              </div>

              ${tagBadges ? `<div class="flex flex-wrap gap-1 pt-1">${tagBadges}</div>` : ''}
            </div>

            <div class="p-3 bg-slate-50 border-t border-slate-100 flex items-center gap-2">
              ${item.drive_url ? `
                <a href="${item.drive_url}" target="_blank" rel="noopener noreferrer" class="flex-1 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-sm">
                  <i data-lucide="external-link" class="w-3.5 h-3.5"></i> 구글 드라이브 자료 열기
                </a>
              ` : ''}

              ${ytId ? `
                <button onclick="openYoutubePlayerForStudy('${item.id}')" class="py-2 px-3 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1">
                  <i data-lucide="video" class="w-3.5 h-3.5"></i> 강의 보기
                </button>
              ` : ''}
            </div>
          </div>
        `;
      }).join('');

      lucide.createIcons();
    }

    function openYoutubePlayerForStudy(materialId) {
      const item = currentStudyMaterials.find(m => m.id === materialId);
      if (!item) return;
      const ytId = getYouTubeId(item.youtube_url);
      if (!ytId) return alert('유효한 유튜브 영상 링크가 없습니다.');

      document.getElementById('ytModalTitle').innerText = item.title || '교과 해설 영상';
      document.getElementById('ytIframe').src = `https://www.youtube.com/embed/${ytId}?autoplay=1`;
      document.getElementById('youtubePlayerModal').classList.remove('hidden');
      lucide.createIcons();
    }

    // =================================================================
    // 💡 [신규] 학급 폴더형 학생 선택 컴포넌트 시스템 (5개 화면 확장 완료)
    // =================================================================
    let allGrade3Students = []; // 전체 3학년 학생 목록 캐시
    let pickerCurrentClass = { survey: 2, counsel: 2, mock: 2, schedules: 2, minCheck: 2 };
    let pickerSelectedStudentId = { survey: null, counsel: null, mock: null, schedules: 'all', minCheck: null };

    // 학급 폴더 렌더링 및 학생 아이콘 출력 함수
    function renderFolderStudentPicker(pickerType) {
      const container = document.getElementById(`pickerContainer_${pickerType}`);
      if (!container) return;

      // 1. 현재 모드에 따른 기본 반 결정
      const isAllMode = (activeClassNum === 'all');
      let targetClass = isAllMode 
        ? (pickerCurrentClass[pickerType] || 1) 
        : parseInt(activeClassNum || 2);
      
      pickerCurrentClass[pickerType] = targetClass;

      // 2. '3학년 전체' 모드일 때만 나타나는 10개 학급 큰 폴더 탭
      let foldersHtml = '';
      if (isAllMode) {
        const folderButtons = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(c => {
          const isSelected = (c === targetClass);
          const count = allGrade3Students.filter(s => (s.class_num || 2) === c).length;
          return `
            <button type="button" onclick="selectPickerClass('${pickerType}', ${c})" 
              class="px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shrink-0 ${
                isSelected 
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-200 scale-105' 
                  : 'bg-white border border-slate-200 text-slate-700 hover:bg-blue-50 hover:border-blue-300'
              }">
              <i data-lucide="${isSelected ? 'folder-open' : 'folder'}" class="w-4 h-4"></i>
              <span>3-${c}반</span>
              <span class="text-[10px] px-1.5 py-0.2 rounded-full ${isSelected ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-500'} font-semibold">${count}명</span>
            </button>
          `;
        }).join('');

        foldersHtml = `
          <div class="space-y-1.5 bg-slate-50 p-3 rounded-xl border border-slate-200">
            <span class="text-[11px] font-bold text-slate-500 flex items-center gap-1">
              <i data-lucide="folders" class="w-3.5 h-3.5 text-blue-600"></i> 학급 폴더 선택 (3학년 전체 모드)
            </span>
            <div class="flex items-center gap-2 overflow-x-auto pb-1 pt-1 no-scrollbar">
              ${folderButtons}
            </div>
          </div>
        `;
      }

      // 3. 해당 학급 학생 명단 필터링
      const classStudents = allGrade3Students.filter(s => (s.class_num || 2) === targetClass);

      // 입시일정 전용: 맨 앞에 '전체 일정 모아보기' 명찰 카드 추가
      let allScheduleCardHtml = '';
      if (pickerType === 'schedules') {
        const isAllSelected = (pickerSelectedStudentId['schedules'] === 'all' || !pickerSelectedStudentId['schedules']);
        allScheduleCardHtml = `
          <button type="button" onclick="selectPickerStudent('schedules', 'all')"
            class="p-2.5 rounded-xl border text-left transition flex items-center gap-2.5 group ${
              isAllSelected
                ? 'bg-amber-50 border-amber-500 ring-2 ring-amber-400/40 shadow-sm'
                : 'bg-white border-slate-200 hover:border-amber-400 hover:shadow-xs'
            }">
            <div class="w-8 h-8 rounded-lg flex items-center justify-center font-black text-xs shrink-0 transition ${
              isAllSelected
                ? 'bg-amber-500 text-white'
                : 'bg-amber-100 text-amber-700 group-hover:bg-amber-200'
            }">
              🌐
            </div>
            <div class="min-w-0 flex-1">
              <div class="font-bold text-xs truncate ${isAllSelected ? 'text-amber-900 font-black' : 'text-slate-800'}">
                전체 일정
              </div>
              <div class="text-[10px] text-amber-600 font-semibold leading-none mt-0.5 truncate">
                학급 전체 모아보기
              </div>
            </div>
          </button>
        `;
      }

      let studentsHtml = '';
      if (classStudents.length === 0 && pickerType !== 'schedules') {
        studentsHtml = `
          <div class="p-6 text-center text-xs text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
            3학년 ${targetClass}반에 등록 및 승인된 학생이 없습니다.
          </div>
        `;
      } else {
        studentsHtml = `
          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
            ${allScheduleCardHtml}
            ${classStudents.map(s => {
              const isSelected = (pickerSelectedStudentId[pickerType] === s.id);
              const numOnly = s.student_no ? s.student_no.slice(-2) : '•';
              return `
                <button type="button" onclick="selectPickerStudent('${pickerType}', '${s.id}')"
                  class="p-2.5 rounded-xl border text-left transition flex items-center gap-2.5 group ${
                    isSelected
                      ? 'bg-blue-50 border-blue-600 ring-2 ring-blue-500/40 shadow-sm'
                      : 'bg-white border-slate-200 hover:border-blue-400 hover:shadow-xs'
                  }">
                  <div class="w-8 h-8 rounded-lg flex items-center justify-center font-black text-xs shrink-0 transition ${
                    isSelected
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-700 group-hover:bg-blue-100 group-hover:text-blue-700'
                  }">
                    ${numOnly}
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="font-bold text-xs truncate ${isSelected ? 'text-blue-900 font-black' : 'text-slate-800'}">
                      ${escapeHtml(s.name)}
                    </div>
                    <div class="text-[10px] text-slate-400 font-mono leading-none mt-0.5 truncate">
                      ${s.student_no || ''}
                    </div>
                  </div>
                </button>
              `;
            }).join('')}
          </div>
        `;
      }

      container.innerHTML = `
        <div class="space-y-3">
          ${foldersHtml}
          <div class="space-y-1.5">
            <div class="flex items-center justify-between">
              <span class="text-[11px] font-bold text-slate-600 flex items-center gap-1.5">
                <i data-lucide="users" class="w-3.5 h-3.5 text-blue-600"></i>
                <span>3학년 ${targetClass}반 학생 명찰 (${classStudents.length}명)</span>
              </span>
              <span class="text-[10px] text-slate-400">※ 학생 아이콘을 누르면 데이터가 실시간 로드됩니다.</span>
            </div>
            ${studentsHtml}
          </div>
        </div>
      `;

      lucide.createIcons();
    }

    // 학급 폴더 클릭 시
function selectPickerClass(pickerType, classNum) {
  pickerCurrentClass[pickerType] = classNum;
  if (pickerType === 'schedules') {
    pickerSelectedStudentId['schedules'] = 'all';
    const scSelect = document.getElementById('scheduleStudentSelect');
    if (scSelect) scSelect.value = 'all';
    loadExamSchedules();
  } else {
    pickerSelectedStudentId[pickerType] = null; // 반 변경 시 선택 초기화
    
    // [수정] 반 폴더 이동 시 이전 학생 화면 잔상 즉시 초기화
    if (pickerType === 'survey') {
      const card = document.getElementById('surveyTeacherDetailCard');
      if (card) card.innerHTML = '<p class="text-center text-slate-400 py-12">위 명단에서 학생 아이콘을 누르면 인적사항과 선택과목이 표시됩니다.</p>';
    } else if (pickerType === 'counsel') {
      const cont = document.getElementById('teacherCardsContainer');
      if (cont) cont.innerHTML = '<p class="text-center text-slate-400 py-12 bg-white rounded-xl border">위 명단에서 학생 아이콘을 누르면 입시상담카드가 나타납니다.</p>';
    } else if (pickerType === 'mock') {
      const cont = document.getElementById('teacherMockContainer');
      if (cont) cont.innerHTML = '<p class="text-center text-slate-400 py-12 bg-white rounded-xl border">학생을 선택해주세요.</p>';
    } else if (pickerType === 'minCheck') {
      renderMinimumCheckAnalysis();
    }
  }
  renderAllFolderPickers();
}

    // 학생 아이콘 카드 클릭 시
    function selectPickerStudent(pickerType, studentId) {
      pickerSelectedStudentId[pickerType] = studentId;
      renderAllFolderPickers();

      // 화면별 실제 로드 함수 실행
      if (pickerType === 'survey') {
        const sSelect = document.getElementById('surveyStudentSelect');
        if (sSelect) sSelect.value = studentId;
        loadStudentSurveyForTeacher(studentId);
      } else if (pickerType === 'counsel') {
        const cSelect = document.getElementById('teacherStudentSelect');
        if (cSelect) cSelect.value = studentId;
        loadStudent12CardsForTeacher(studentId);
      } else if (pickerType === 'mock') {
        const mSelect = document.getElementById('mockStudentSelect');
        if (mSelect) mSelect.value = studentId;
        loadStudentMockForTeacher(studentId);
      } else if (pickerType === 'schedules') {
        const scSelect = document.getElementById('scheduleStudentSelect');
        if (scSelect) scSelect.value = studentId;
        loadExamSchedules();
      } else if (pickerType === 'minCheck') {
        const mcSelect = document.getElementById('minCheckStudentSelect');
        if (mcSelect) mcSelect.value = studentId;
        renderMinimumCheckAnalysis();
      }
    }

    // 5개 선택기 일괄 갱신
    function renderAllFolderPickers() {
      renderFolderStudentPicker('survey');
      renderFolderStudentPicker('counsel');
      renderFolderStudentPicker('mock');
      renderFolderStudentPicker('schedules');
      renderFolderStudentPicker('minCheck');
    }

    
    // =================================================================
    // 💡 회원 및 학생 선택자 관리
    // =================================================================
    async function loadTeacherStudentSelects() {
      // 1. 전체 3학년 승인 학생 목록을 한 번에 가져와 캐싱
      const { data: allStudents } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('role', 'student')
        .eq('is_approved', true)
        .order('student_no');

      allGrade3Students = allStudents || [];

      // 2. 현재 선택된 학급 모드에 맞게 내부 select 옵션 채우기 (기존 호환 유지)
      let filtered = allGrade3Students;
      if (activeClassNum !== 'all') {
        filtered = allGrade3Students.filter(s => s.class_num === activeClassNum);
      }

      const optHtml = '<option value="">학생을 선택하세요</option>' + filtered.map(s => `
        <option value="${s.id}">${s.student_no ? s.student_no + ' ' : ''}${s.name} (${s.class_num || 2}반)</option>
      `).join('');

      const tSel = document.getElementById('teacherStudentSelect');
      const sSel = document.getElementById('surveyStudentSelect');
      const mSel = document.getElementById('mockStudentSelect');
      const minSel = document.getElementById('minCheckStudentSelect');
      const schedSel = document.getElementById('scheduleStudentSelect');

      if (tSel) tSel.innerHTML = optHtml;
      if (sSel) sSel.innerHTML = optHtml;
      if (mSel) mSel.innerHTML = optHtml;
      if (minSel) minSel.innerHTML = optHtml;
      if (schedSel) {
        schedSel.innerHTML = '<option value="all">🌐 학급 전체 모아보기</option>' + filtered.map(s => `
          <option value="${s.id}">${s.student_no ? s.student_no + ' ' : ''}${s.name}</option>
        `).join('');
      }

      // 3. ★ 신규 학급 폴더 및 학생 아이콘 UI 즉시 렌더링!
      renderAllFolderPickers();
    }

    async function loadUsersData() {
      let pendingQuery = supabaseClient.from('profiles').select('*').eq('is_approved', false).order('created_at', { ascending: false });
      if (activeClassNum !== 'all') {
        pendingQuery = pendingQuery.eq('class_num', activeClassNum);
      }
      const { data: pendingList } = await pendingQuery;
      const pendingTbody = document.getElementById('pendingUserTableBody');
      const badge = document.getElementById('pendingCountBadge');

      if (!pendingList || pendingList.length === 0) {
        pendingTbody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-slate-400">대기 중인 회원이 없습니다.</td></tr>';
        badge.classList.add('hidden');
      } else {
        badge.classList.remove('hidden');
        badge.innerText = pendingList.length;
pendingTbody.innerHTML = pendingList.map(u => `
  <tr class="hover:bg-slate-50">
    <td class="p-3 text-xs text-slate-400">${new Date(u.created_at).toLocaleDateString()}</td>
    <td class="p-3 font-bold text-blue-600">${u.class_num ? u.class_num + '반' : '전체'}</td>
    <td class="p-3 font-bold text-slate-800">${escapeHtml(u.student_no || u.email)}</td>
    <td class="p-3 font-bold text-slate-800">${escapeHtml(u.name)}</td>
    <td class="p-3"><span class="px-2 py-0.5 bg-slate-100 rounded text-xs">${escapeHtml(u.role)}</span></td>
            <td class="p-3">
              <select id="roleSelect_${u.id}" class="text-xs border rounded px-2 py-1 bg-white">
                <option value="student" ${u.role==='student'?'selected':''}>학생</option>
                <option value="teacher" ${u.role==='teacher'?'selected':''}>담임교사</option>
                <option value="admin" ${u.role==='admin'?'selected':''}>학년부장/관리자</option>
                <option value="parent" ${u.role==='parent'?'selected':''}>학부모</option>
              </select>
            </td>
            <td class="p-3 text-right space-x-1">
              <button onclick="approveUser('${u.id}')" class="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold transition">승인</button>
              <button onclick="rejectUser('${u.id}')" class="px-2 py-1 bg-slate-200 hover:bg-rose-100 text-slate-600 hover:text-rose-600 rounded text-xs transition">반려</button>
            </td>
          </tr>
        `).join('');
      }

      let approvedQuery = supabaseClient.from('profiles').select('*').eq('is_approved', true).order('class_num');
      if (activeClassNum !== 'all') {
        approvedQuery = approvedQuery.eq('class_num', activeClassNum);
      }
      const { data: approvedList } = await approvedQuery;
      currentApprovedUserList = approvedList || []; // 안전 보관함에 저장
      const approvedTbody = document.getElementById('approvedUserTableBody');

      if (!approvedList || approvedList.length === 0) {
        approvedTbody.innerHTML = '<tr><td colspan="5" class="p-6 text-center text-slate-400">등록된 회원이 없습니다.</td></tr>';
      } else {
        approvedTbody.innerHTML = approvedList.map(u => `
          <tr class="hover:bg-slate-50">
            <td class="p-3 font-bold text-blue-600">${u.class_num ? u.class_num + '반' : '전체(관리자)'}</td>
            <td class="p-3">
              <span class="px-2 py-0.5 rounded text-xs font-semibold ${
                u.role === 'admin'
                  ? 'bg-amber-100 text-amber-800'
                  : (u.role === 'student'
                      ? 'bg-blue-100 text-blue-800'
                      : (u.role === 'teacher' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'))
              }">
                ${u.role === 'admin' ? '부장/관리자' : (u.role === 'student' ? '학생' : (u.role === 'teacher' ? '담임교사' : '학부모'))}
              </span>
            </td>
            <td class="p-3 font-bold text-slate-800">${escapeHtml(u.student_no || u.email)}</td>
            <td class="p-3 font-semibold text-slate-700">${escapeHtml(u.name)}</td>
            <td class="p-3 text-right space-x-1">
              <button onclick="openEditUserModal('${u.id}')" class="px-3 py-1 bg-slate-100 hover:bg-blue-50 text-blue-600 border border-slate-200 rounded text-xs font-bold transition inline-flex items-center gap-1">
                <i data-lucide="key" class="w-3 h-3"></i> 수정
              </button>
              <button onclick="deleteUserByTeacher('${u.id}')" class="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded text-xs font-bold transition inline-flex items-center gap-1" title="회원 탈퇴 처리">
                <i data-lucide="user-x" class="w-3.5 h-3.5"></i> 탈퇴
              </button>
            </td>
          </tr>
        `).join('');
      }
      lucide.createIcons();
    }

    async function approveUser(userId) {
      const selectedRole = document.getElementById(`roleSelect_${userId}`).value;
      await supabaseClient.from('profiles').update({ is_approved: true, role: selectedRole }).eq('id', userId);
      alert('승인 및 역할 부여가 완료되었습니다.');
      loadUsersData();
      loadTeacherStudentSelects();
    }
    async function rejectUser(userId) {
      if (confirm('이 회원을 삭제(반려)할까요?')) {
        await supabaseClient.from('profiles').delete().eq('id', userId);
        loadUsersData();
      }
    }

let currentApprovedUserList = []; // 승인 회원 보관용 전역 변수

// [선생님 전용] 회원 강제 탈퇴 및 데이터 영구 정리 함수 (보관함 ID 기반 안전 처리)
async function deleteUserByTeacher(userId) {
  if (currentUser && currentUser.id === userId) {
    alert('현재 로그인 중인 선생님 본인 계정은 삭제할 수 없습니다.');
    return;
  }

  const targetUser = currentApprovedUserList.find(u => u.id === userId);
  const userName = targetUser ? targetUser.name : '해당 회원';
  const userIdent = targetUser ? (targetUser.student_no || targetUser.email) : '';

  const confirmMsg = `[${userName}] (${userIdent}) 회원을 정말로 탈퇴 처리하시겠습니까?\n\n탈퇴 시 학생이 입력한 수시/정시 원서, 모의고사 성적 등 모든 데이터가 함께 영구 삭제됩니다.`;
  if (!confirm(confirmMsg)) return;

  const inputName = prompt(`실수 방지를 위해 탈퇴시킬 회원의 이름 [${userName}]을 정확히 입력해 주세요:`);
  if (inputName !== userName) {
    alert('입력하신 이름이 일치하지 않아 취소되었습니다.');
    return;
  }

  try {
    const { error } = await supabaseClient.rpc('admin_delete_user', { target_user_id: userId });
    if (error) throw error;

    alert(`[${userName}] 회원이 완전히 탈퇴 처리되었습니다.`);
    loadUsersData();
    loadTeacherStudentSelects();
    loadHomeDashboardData();
  } catch (err) {
    console.error('탈퇴 실패:', err);
    alert('회원 탈퇴 처리 중 오류가 발생했습니다: ' + err.message);
  }
}

// 회원 수정 모달 열기 (보관함에서 깔끔하게 정보 추출)
function openEditUserModal(userId) {
  const u = currentApprovedUserList.find(item => item.id === userId);
  if (!u) return alert('회원 정보를 찾을 수 없습니다.');

  document.getElementById('modalUserId').value = u.id;
  document.getElementById('modalUserRawId').value = u.student_no || u.email || '';
  document.getElementById('modalUserClassNum').value = (u.class_num !== null && u.class_num !== undefined) ? u.class_num : 2;
  document.getElementById('modalUserRole').value = u.role || 'student';
  document.getElementById('modalUserPw').value = '';
  document.getElementById('modalUserName').innerText = `[${u.name}] 계정 수정`;
  document.getElementById('editUserModal').classList.remove('hidden');
  lucide.createIcons();
}

    function closeEditUserModal() {
      document.getElementById('editUserModal').classList.add('hidden');
    }

    async function submitUserEdit() {
      const userId = document.getElementById('modalUserId').value;
      const newRawId = document.getElementById('modalUserRawId').value.trim();
      const newClassNum = parseInt(document.getElementById('modalUserClassNum').value) || 0;
      const newRole = document.getElementById('modalUserRole').value;
      const newPw = document.getElementById('modalUserPw').value.trim();
      const saveBtn = document.getElementById('modalSaveBtn');

      saveBtn.innerText = '저장 중...';
      saveBtn.disabled = true;

      const updateFields = {
        class_num: newClassNum,
        role: newRole
      };
      if (newRole === 'student') {
        updateFields.student_no = newRawId;
      }

      const { error: profileError } = await supabaseClient.from('profiles').update(updateFields).eq('id', userId);
      if (profileError) {
        alert('회원 프로필 수정 실패: ' + profileError.message);
        saveBtn.innerText = '저장하기';
        saveBtn.disabled = false;
        return;
      }

      const { error: rpcError } = await supabaseClient.rpc('admin_update_user_credentials', {
        target_user_id: userId,
        new_raw_id: newRawId,
        new_password: newPw || null
      });

      if (rpcError) {
        alert('계정 로그인 정보 수정 오류: ' + rpcError.message);
      } else {
        alert('회원 구분, 학급 및 계정 정보가 성공적으로 변경되었습니다!');
        closeEditUserModal();
        loadUsersData();
        loadTeacherStudentSelects();
      }
      saveBtn.innerText = '저장하기';
      saveBtn.disabled = false;
    }

    async function handleBulkStudentCreate() {
      const rawText = document.getElementById('bulkStudentInput').value.trim();
      if (!rawText) return alert('학번과 이름 명렬표를 입력해주세요.');

      const lines = rawText.split('\n');
      const students = [];

      for (let line of lines) {
        line = line.trim();
        if (!line) continue;
        const parts = line.split(/\s+/);
        if (parts.length >= 2) {
          const sNo = parts[0].trim();
          let cls = (activeClassNum === 'all') ? 2 : activeClassNum;
          if (sNo.length >= 3 && sNo.startsWith('3')) {
            cls = parseInt(sNo.substring(1, 3)) || cls;
          }
          students.push({
            student_no: sNo,
            name: parts.slice(1).join(' ').trim(),
            class_num: cls
          });
        }
      }

      if (students.length === 0) return alert('유효한 명렬표 형식을 찾을 수 없습니다.');

      const btn = document.getElementById('bulkCreateBtn');
      btn.innerText = '생성 중...';
      btn.disabled = true;

      const { data: results, error } = await supabaseClient.rpc('admin_bulk_create_students', { students: students });

      if (error) alert('일괄 생성 실패: ' + error.message);
      else {
        lastGeneratedResults = results || [];
        renderBulkResultTable(lastGeneratedResults);
        alert(`학생 계정 생성이 완료되었습니다!`);
        document.getElementById('bulkStudentInput').value = '';
        loadUsersData();
        loadTeacherStudentSelects();
      }

      btn.innerHTML = '<i data-lucide="sparkles" class="w-4 h-4"></i> 일괄 계정 생성 및 임시 비밀번호 발급';
      btn.disabled = false;
      lucide.createIcons();
    }

    function renderBulkResultTable(list) {
      const container = document.getElementById('bulkResultContainer');
      const copyBtn = document.getElementById('copyResultBtn');

      if (!list || list.length === 0) {
        container.innerHTML = '<p class="text-center py-6 text-slate-400">생성 결과가 없습니다.</p>';
        copyBtn.classList.add('hidden');
        return;
      }

      copyBtn.classList.remove('hidden');
      container.innerHTML = `
        <table class="w-full text-left text-xs border-collapse">
          <thead>
            <tr class="border-b font-bold text-slate-700 bg-white">
              <th class="p-1.5">학번</th>
              <th class="p-1.5">이름</th>
              <th class="p-1.5 text-blue-600">임시 비밀번호</th>
              <th class="p-1.5 text-right">상태</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-200">
            ${list.map(s => `
              <tr class="hover:bg-white/80">
                <td class="p-1.5 font-bold text-slate-800">${s.student_no}</td>
                <td class="p-1.5">${s.name}</td>
                <td class="p-1.5 font-mono font-bold text-blue-600">${s.temp_pw}</td>
                <td class="p-1.5 text-right"><span class="px-1.5 py-0.5 rounded text-[10px] ${s.status === '성공' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}">${s.status}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }

    function copyBulkResultText() {
      if (!lastGeneratedResults || lastGeneratedResults.length === 0) return;
      let text = `=== 3학년 ${activeClassNum === 'all' ? '' : activeClassNum + '반'} 진학 플랫폼 학생 계정 안내 ===\n\n`;
      lastGeneratedResults.forEach(s => {
        text += `[${s.student_no}] ${s.name} | 아이디: ${s.student_no} | 임시비번: ${s.temp_pw}\n`;
      });
      navigator.clipboard.writeText(text).then(() => {
        alert('학생 배포용 명단 및 임시비밀번호가 복사되었습니다!');
      });
    }

    // =================================================================
    // 💡 학급 앨범 로직
    // =================================================================
    async function loadAlbumFolders() {
      let fQuery = supabaseClient.from('album_folders').select('*').order('created_at', { ascending: true });
      if (activeClassNum !== 'all') {
        fQuery = fQuery.or(`class_num.eq.${activeClassNum},class_num.eq.0,class_num.is.null`);
      }
      const { data: folders } = await fQuery;
      const tabContainer = document.getElementById('albumFolderTabs');
      
      if (!folders || folders.length === 0) {
        const cls = (activeClassNum === 'all') ? 2 : activeClassNum;
        const { data: newF } = await supabaseClient.from('album_folders').insert([{ name: '기본 앨범', class_num: cls }]).select().single();
        if (newF) activeFolderId = newF.id;
        loadAlbumFolders();
        return;
      }

      if (!activeFolderId || !folders.some(f => f.id === activeFolderId)) {
        activeFolderId = folders[0].id;
      }

currentFolderList = folders || []; // 폴더 보관함에 보관

tabContainer.innerHTML = folders.map(f => `
  <div class="inline-flex items-center rounded-xl border transition ${f.id === activeFolderId ? 'bg-blue-600 text-white border-blue-600 shadow' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}">
    <button onclick="selectAlbumFolder('${f.id}')" class="px-3.5 py-2 font-bold whitespace-nowrap flex items-center gap-1.5 text-xs">
      <i data-lucide="folder" class="w-3.5 h-3.5"></i> ${escapeHtml(f.name)}
    </button>
    ${isCurrentTeacher() ? `
      <button onclick="deleteAlbumFolder('${f.id}')" title="폴더 삭제" class="pr-2.5 pl-1 py-2 opacity-60 hover:opacity-100 hover:text-rose-300 transition">
        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
      </button>
    ` : ''}
  </div>
`).join('');
      lucide.createIcons();
      loadAlbumPhotos();
    }

    function selectAlbumFolder(folderId) {
      activeFolderId = folderId;
      loadAlbumFolders();
    }

    let activeAlbumSort = 'newest';

    function changeAlbumSort(val) {
      activeAlbumSort = val;
      renderAlbumPhotos();
    }

    async function loadAlbumPhotos() {
      if (!activeFolderId) return;
      const { data: photos } = await supabaseClient.from('album_photos').select('*').eq('folder_id', activeFolderId);
      currentAlbumPhotos = photos || [];
      renderAlbumPhotos();
    }

    function renderAlbumPhotos() {
      const grid = document.getElementById('albumPhotosGrid');
      if (!grid) return;

      if (!currentAlbumPhotos || currentAlbumPhotos.length === 0) {
        grid.innerHTML = '<p class="col-span-full text-center text-slate-400 py-16">이 폴더에 등록된 사진이 없습니다. [사진 여러 장 올리기]를 눌러 업로드하세요.</p>';
        return;
      }

// ★ 앨범 사진 정렬 (화면 표시와 확대 팝업 순서 100% 일치)
      if (activeAlbumSort === 'newest') {
        currentAlbumPhotos.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      } else if (activeAlbumSort === 'oldest') {
        currentAlbumPhotos.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
      } else if (activeAlbumSort === 'name') {
        currentAlbumPhotos.sort((a, b) => (a.caption || '').localeCompare(b.caption || '', 'ko'));
      }

      grid.innerHTML = currentAlbumPhotos.map((p, idx) => `
      <div class="group relative aspect-square bg-slate-100 rounded-xl overflow-hidden border shadow-sm hover:shadow-md transition">
          <img src="${p.photo_url}" onclick="openPhotoLightbox(${idx})" loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition duration-300 cursor-pointer">
          ${isCurrentTeacher() ? `
            <button onclick="event.stopPropagation(); deleteAlbumPhoto('${p.id}', '${p.photo_url}')" title="사진 삭제" class="absolute top-2 right-2 p-1.5 bg-black/60 hover:bg-rose-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition shadow">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            </button>
          ` : ''}
          <div onclick="openPhotoLightbox(${idx})" class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition flex items-end p-2 cursor-pointer">
            <span class="text-[11px] text-white font-medium truncate">${p.caption || new Date(p.created_at).toLocaleDateString()}</span>
          </div>
        </div>
      `).join('');

      lucide.createIcons();
    }

    function openNewFolderModal() {
      document.getElementById('newFolderName').value = '';
      document.getElementById('newFolderModal').classList.remove('hidden');
    }
    function closeNewFolderModal() {
      document.getElementById('newFolderModal').classList.add('hidden');
    }
    async function createAlbumFolder() {
      const name = document.getElementById('newFolderName').value.trim();
      if (!name) return alert('폴더 이름을 입력해주세요.');
      const cls = (activeClassNum === 'all') ? 2 : activeClassNum;
      const { data } = await supabaseClient.from('album_folders').insert([{ name, class_num: cls }]).select().single();
      if (data) {
        activeFolderId = data.id;
        closeNewFolderModal();
        loadAlbumFolders();
      }
    }

let currentFolderList = []; // 전역 폴더 목록 보관함

async function deleteAlbumFolder(folderId) {
  const f = currentFolderList.find(x => x.id === folderId);
  const folderName = f ? f.name : '해당';
  if (!confirm(`'${folderName}' 폴더와 폴더에 담긴 모든 사진을 완전히 삭제할까요?`)) return;

      const { data: photos } = await supabaseClient.from('album_photos').select('*').eq('folder_id', folderId);
      if (photos && photos.length > 0) {
        const filePaths = [];
        photos.forEach(p => {
          if (p.photo_url && p.photo_url.includes('/class-album/')) {
            const parts = p.photo_url.split('/class-album/');
            if (parts[1]) filePaths.push(decodeURIComponent(parts[1]));
          }
        });
        if (filePaths.length > 0) {
          await supabaseClient.storage.from('class-album').remove(filePaths);
        }
        await supabaseClient.from('album_photos').delete().eq('folder_id', folderId);
      }

      const { error } = await supabaseClient.from('album_folders').delete().eq('id', folderId);
      if (error) {
        alert('폴더 삭제 실패: ' + error.message);
        return;
      }

      alert(`'${folderName}' 폴더가 삭제되었습니다.`);
      if (activeFolderId === folderId) {
        activeFolderId = null;
      }
      loadAlbumFolders();
      loadHomeDashboardData();
    }

    async function deleteAlbumPhoto(photoId, photoUrl) {
      if (!confirm('이 사진을 정말 삭제할까요?')) return;
      
      const { error } = await supabaseClient.from('album_photos').delete().eq('id', photoId);
      if (error) {
        alert('사진 삭제 실패: ' + error.message);
        return;
      }

      try {
        if (photoUrl && photoUrl.includes('/class-album/')) {
          const parts = photoUrl.split('/class-album/');
          if (parts[1]) {
            const filePath = decodeURIComponent(parts[1]);
            await supabaseClient.storage.from('class-album').remove([filePath]);
          }
        }
      } catch (err) {
        console.warn('스토리지 파일 삭제 예외 무시:', err);
      }

      alert('사진이 삭제되었습니다!');
      loadAlbumPhotos();
      loadHomeDashboardData();
    }

    async function deleteCurrentLightboxPhoto() {
      if (currentAlbumPhotos.length === 0) return;
      const photo = currentAlbumPhotos[currentLightboxIdx];
      if (!confirm('현재 확대 중인 이 사진을 삭제할까요?')) return;

      const { error } = await supabaseClient.from('album_photos').delete().eq('id', photo.id);
      if (error) {
        alert('삭제 실패: ' + error.message);
        return;
      }

      try {
        if (photo.photo_url && photo.photo_url.includes('/class-album/')) {
          const parts = photo.photo_url.split('/class-album/');
          if (parts[1]) {
            const filePath = decodeURIComponent(parts[1]);
            await supabaseClient.storage.from('class-album').remove([filePath]);
          }
        }
      } catch (err) {
        console.warn('스토리지 파일 삭제 예외 무시:', err);
      }

      alert('사진이 삭제되었습니다!');
      closePhotoLightbox();
      loadAlbumPhotos();
      loadHomeDashboardData();
    }

// [신규] 브라우저 Canvas 기반 자동 리사이징 및 압축 함수
function compressImage(file, maxWidth = 1920, maxHeight = 1920, quality = 0.8) {
  return new Promise((resolve) => {
    // 이미지 파일이 아니면 원본 그대로 반환
    if (!file.type.startsWith('image/')) {
      return resolve(file);
    }

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let width = img.width;
      let height = img.height;

      // 비율 유지하며 최대 해상도 이내로 축소
      if (width > maxWidth || height > maxHeight) {
        if (width > height) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        } else {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      // 이미지 부드럽게 렌더링
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);

      // JPEG 80% 품질 Blob으로 변환
      canvas.toBlob(
        (blob) => {
          // 압축본이 원본보다 작은 경우에만 압축본 채택
          if (blob && blob.size < file.size) {
            resolve(blob);
          } else {
            resolve(file);
          }
        },
        'image/jpeg',
        quality
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file); // 파싱 실패 시 원본 그대로 진행
    };

    img.src = objectUrl;
  });
}
    
// [보완 완료] 라벨/버튼 손실 방지 및 try-finally 안전 복구 적용
async function handleMultiPhotoUpload(e) {
  const files = e.target.files;
  if (!files || files.length === 0) return;
  if (!activeFolderId) return alert('사진을 올릴 폴더를 먼저 선택해주세요.');

  const btnText = document.getElementById('albumUploadBtnText');
  const fileInput = e.target;
  fileInput.disabled = true;

  let successCount = 0;

  try {
    if (btnText) btnText.innerText = '업로드 중 (0/' + files.length + ')...';

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      if (btnText) btnText.innerText = '압축 및 업로드 중 (' + (i + 1) + '/' + files.length + ')...';
      const uploadBlob = await compressImage(file, 1920, 1920, 0.8);

      const randomStr = Math.random().toString(36).substring(2, 8);
      const safeFilePath = activeFolderId + '/' + Date.now() + '_' + randomStr + '.jpg';

      const { error: upErr } = await supabaseClient.storage
        .from('class-album')
        .upload(safeFilePath, uploadBlob, {
          contentType: 'image/jpeg',
          cacheControl: '3600',
          upsert: true
        });

      if (upErr) {
        console.error('업로드 실패:', upErr);
        continue;
      }

      const { data: { publicUrl } } = supabaseClient.storage.from('class-album').getPublicUrl(safeFilePath);
      await supabaseClient.from('album_photos').insert([{
        folder_id: activeFolderId,
        photo_url: publicUrl,
        caption: file.name
      }]);

      successCount++;
    }

    alert(successCount + '장의 사진이 최적화 압축되어 안전하게 업로드되었습니다!');
    loadAlbumPhotos();
    loadHomeDashboardData();

  } catch (err) {
    console.error('업로드 전체 에러:', err);
    alert('업로드 도중 오류가 발생했습니다.');
  } finally {
    if (btnText) btnText.innerText = '사진 여러 장 올리기';
    fileInput.disabled = false;
    fileInput.value = '';
  }
}   
    
function openPhotoLightbox(index) {
  currentLightboxIdx = index;
  updateLightboxContent();

  const lbDeleteBtn = document.querySelector('#photoLightboxModal button[onclick="deleteCurrentLightboxPhoto()"]');
  if (lbDeleteBtn) {
    if (isCurrentTeacher()) {
      lbDeleteBtn.classList.remove('hidden');
    } else {
      lbDeleteBtn.classList.add('hidden');
    }
  }

  document.getElementById('photoLightboxModal').classList.remove('hidden');
  lucide.createIcons();
}
    function closePhotoLightbox() {
      document.getElementById('photoLightboxModal').classList.add('hidden');
    }
    function navigateLightbox(step) {
      if (currentAlbumPhotos.length === 0) return;
      currentLightboxIdx = (currentLightboxIdx + step + currentAlbumPhotos.length) % currentAlbumPhotos.length;
      updateLightboxContent();
    }
    function updateLightboxContent() {
      if (currentAlbumPhotos.length === 0) return;
      const photo = currentAlbumPhotos[currentLightboxIdx];
      document.getElementById('lightboxImage').src = photo.photo_url;
      document.getElementById('lightboxCounter').innerText = `${currentLightboxIdx + 1} / ${currentAlbumPhotos.length}`;
    }

    window.addEventListener('keydown', (e) => {
      const modal = document.getElementById('photoLightboxModal');
      if (!modal.classList.contains('hidden')) {
        if (e.key === 'Escape') closePhotoLightbox();
        if (e.key === 'ArrowLeft') navigateLightbox(-1);
        if (e.key === 'ArrowRight') navigateLightbox(1);
      }
    });

    // =================================================================
    // 💡 학사 & 상담 달력 로직
    // =================================================================
function openNewEventModal() {
  const todayStr = getTodayString(); // 아침 9시 이전에도 정확한 오늘 날짜 반영!
  document.getElementById('eventTitleInput').value = '';
  document.getElementById('eventStartDateInput').value = todayStr;
  document.getElementById('eventEndDateInput').value = todayStr;
  document.getElementById('newEventModal').classList.remove('hidden');
  lucide.createIcons();
}
    function closeNewEventModal() {
      document.getElementById('newEventModal').classList.add('hidden');
    }
    function syncCalendarEndDate() {
      const startVal = document.getElementById('eventStartDateInput').value;
      const endInput = document.getElementById('eventEndDateInput');
      if (!endInput.value || endInput.value < startVal) {
        endInput.value = startVal;
      }
    }

    async function submitCalendarEvent() {
      const startDate = document.getElementById('eventStartDateInput').value;
      let endDate = document.getElementById('eventEndDateInput').value;
      const cat = document.getElementById('eventCatInput').value;
      const title = document.getElementById('eventTitleInput').value.trim();

      if (!startDate || !title) return alert('시작 날짜와 일정 내용을 입력해주세요.');
      if (!endDate) endDate = startDate;

      if (startDate > endDate) {
        return alert('종료일은 시작일보다 이전일 수 없습니다.');
      }

      const submitBtn = document.getElementById('eventSubmitBtn');
      submitBtn.innerText = '등록 중...';
      submitBtn.disabled = true;

            const scope = document.getElementById('eventScopeInput')?.value || 'class';
      let cls = 0; // 기본 전체
      if (scope === 'class') {
        cls = (activeClassNum === 'all') ? (currentProfile.class_num || 2) : activeClassNum;
      }

      const records = [];
   let cur = new Date(startDate + 'T00:00:00');
   const end = new Date(endDate + 'T23:59:59');

      while (cur <= end) {
        const y = cur.getFullYear();
        const m = String(cur.getMonth() + 1).padStart(2, '0');
        const d = String(cur.getDate()).padStart(2, '0');
        records.push({
          event_date: `${y}-${m}-${d}`,
          category: cat,
          title: title,
          class_num: cls
        });
        cur.setDate(cur.getDate() + 1);
      }

      const { error } = await supabaseClient.from('calendar_events').insert(records);
      if (error) {
        alert('일정 등록 실패: ' + error.message);
        submitBtn.innerText = '추가';
        submitBtn.disabled = false;
        return;
      }

      alert(records.length > 1 ? `${records.length}일간의 일정이 등록되었습니다!` : '일정이 등록되었습니다!');
      submitBtn.innerText = '추가';
      submitBtn.disabled = false;
      closeNewEventModal();
      renderCalendar();
      loadHomeDashboardData();
    }

async function deleteCalendarEvent(id) {
  if (!confirm('이 일정을 달력에서 삭제할까요?')) return;
  await supabaseClient.from('calendar_events').delete().eq('id', id);
  renderCalendar();
  loadHomeDashboardData();
}

   let calViewDate = new Date();
   calViewDate.setDate(1);

    function changeCalMonth(delta) {
      calViewDate.setMonth(calViewDate.getMonth() + delta);
      renderCalendar();
    }

let currentMonthCalendarEvents = [];

async function renderCalendar() {
  const grid = document.getElementById('calendarGrid');
  if (!grid) return;

  const year = calViewDate.getFullYear();
  const month = calViewDate.getMonth();

  const labelEl = document.getElementById('calendarCurrentMonthLabel');
  if (labelEl) {
    labelEl.innerText = year + '. ' + String(month + 1).padStart(2, '0');
  }

  let calQuery = supabaseClient.from('calendar_events').select('*');
  if (activeClassNum !== 'all') {
    calQuery = calQuery.or('class_num.eq.' + activeClassNum + ',class_num.eq.0,class_num.is.null');
  }
  const { data: events } = await calQuery;
  currentMonthCalendarEvents = events || [];

  const firstDayIndex = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month + 1, 0).getDate();

  let cells = '';

  for (let b = 0; b < firstDayIndex; b++) {
    cells += '<div class="bg-slate-50/50 min-h-[55px] md:min-h-[115px] p-1.5 md:p-2 rounded border border-slate-100"></div>';
  }

  for (let day = 1; day <= lastDate; day++) {
    const dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    const dayEvents = currentMonthCalendarEvents.filter(e => e.event_date === dateStr);
    
    const dayOfWeek = new Date(year, month, day).getDay(); 
    let dayColor = 'text-slate-700';
    if (dayOfWeek === 0) dayColor = 'text-rose-500 font-bold';
    else if (dayOfWeek === 6) dayColor = 'text-blue-500 font-bold';

    let pcEventsHtml = '';
    let mobileDotsHtml = '';

    if (dayEvents.length > 0) {
      dayEvents.forEach(e => {
        const isCounsel = (e.category === 'counsel');
        const isExam = (e.category === 'exam');
        const isAllSchool = (!e.class_num || e.class_num === 0);

        let bgClass = 'bg-blue-50 text-blue-800 border-blue-100 hover:bg-blue-100';
        let badgeText = isAllSchool 
          ? '<span class="text-[9px] px-1 bg-slate-200 text-slate-700 rounded font-bold mr-1 shrink-0">전체</span>' 
          : '<span class="text-[9px] px-1 bg-blue-200 text-blue-800 rounded font-bold mr-1 shrink-0">학급</span>';
        let dotColor = 'bg-blue-500';

        let displayTitle = e.title;
        if (isCounsel) {
          bgClass = 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100';
          badgeText = '<span class="text-[9px] px-1 bg-emerald-200 text-emerald-900 rounded font-bold mr-1 shrink-0">상담</span>';
          dotColor = 'bg-emerald-500';
          if (!isCurrentTeacher() && e.target_user_id !== currentUser?.id) {
            displayTitle = '[상담 예약완료]';
          }
        } else if (isExam) {
          bgClass = 'bg-rose-50 text-rose-800 border-rose-200 font-bold hover:bg-rose-100';
          badgeText = '<span class="text-[9px] px-1 bg-rose-200 text-rose-900 rounded font-bold mr-1 shrink-0">시험</span>';
          dotColor = 'bg-rose-500';
        }

        // PC 화면: 일정 텍스트 바 (클릭 시 팝업)
        pcEventsHtml += `
          <div onclick="openCalendarEventDetail('${e.id}')" class="cursor-pointer px-1.5 py-0.5 rounded text-[11px] leading-tight font-medium truncate flex items-center justify-between gap-1 border transition shadow-2xs ${bgClass}" title="${escapeHtml(displayTitle)}">
            <div class="flex items-center gap-0.5 min-w-0">
              ${badgeText}
              <span class="truncate">${escapeHtml(displayTitle)}</span>
            </div>
          </div>
        `;

        // 모바일 화면: 작은 원형 점 Dot (터치 시 팝업)
        mobileDotsHtml += `
          <button type="button" onclick="event.stopPropagation(); openCalendarEventDetail('${e.id}')" class="w-2.5 h-2.5 rounded-full ${dotColor} transition-transform active:scale-125" title="${escapeHtml(displayTitle)}"></button>
        `;
      });
    }

    const countBadge = dayEvents.length > 0 
      ? '<span class="text-[9px] px-1 bg-slate-100 text-slate-500 rounded font-semibold hidden md:inline-block">' + dayEvents.length + '</span>' 
      : '';

    cells += `
      <div class="bg-white min-h-[55px] md:min-h-[115px] p-1.5 md:p-2 border border-slate-100 rounded-lg flex flex-col justify-start gap-1 shadow-sm hover:border-blue-300 transition">
        <div class="flex items-center justify-between">
          <span class="text-xs ${dayColor}">${day}</span>
          ${countBadge}
        </div>
        <div class="flex flex-wrap gap-1 md:hidden mt-0.5">
          ${mobileDotsHtml}
        </div>
        <div class="hidden md:flex flex-col space-y-1 overflow-y-auto max-h-[85px] pr-0.5">
          ${pcEventsHtml}
        </div>
      </div>
    `;
  }

  grid.innerHTML = cells;
  lucide.createIcons();
}

function openCalendarEventDetail(eventId) {
  const event = currentMonthCalendarEvents.find(e => e.id === eventId);
  if (!event) return;

  const isCounsel = (event.category === 'counsel');
  const isExam = (event.category === 'exam');
  const isAllSchool = (!event.class_num || event.class_num === 0);

  const badgeEl = document.getElementById('calDetailBadge');
  if (isCounsel) {
    badgeEl.innerText = '학생 상담';
    badgeEl.className = 'inline-block px-2 py-0.5 rounded text-[10px] font-bold mb-1 bg-emerald-100 text-emerald-800';
  } else if (isExam) {
    badgeEl.innerText = '시험 / 모의평가';
    badgeEl.className = 'inline-block px-2 py-0.5 rounded text-[10px] font-bold mb-1 bg-rose-100 text-rose-800';
  } else {
    badgeEl.innerText = '학사 일정';
    badgeEl.className = 'inline-block px-2 py-0.5 rounded text-[10px] font-bold mb-1 bg-blue-100 text-blue-800';
  }

  let title = event.title;
  if (isCounsel && !isCurrentTeacher() && event.target_user_id !== currentUser?.id) {
    title = '[상담 예약완료]';
  }
  document.getElementById('calDetailTitle').innerText = title;
  document.getElementById('calDetailDate').innerText = event.event_date;
  document.getElementById('calDetailScope').innerText = isAllSchool ? '3학년 전체 학사 일정' : `${event.class_num || 2}반 전용 일정`;

  const delBtn = document.getElementById('calDetailDeleteBtn');
  if (delBtn) {
    if (isCurrentTeacher()) {
      delBtn.classList.remove('hidden');
      delBtn.onclick = async () => {
        closeCalendarEventDetail();
        await deleteCalendarEvent(event.id);
      };
    } else {
      delBtn.classList.add('hidden');
    }
  }

  document.getElementById('calendarEventDetailModal').classList.remove('hidden');
  lucide.createIcons();
}

function closeCalendarEventDetail() {
  const modal = document.getElementById('calendarEventDetailModal');
  if (modal) modal.classList.add('hidden');
}


    // =================================================================
    // 💡 [입시자료 확장 3종] 모의평가 · 간담회 · 입학설명회 전체 인터랙션 로직
    // =================================================================

    // 0. 모바일 메뉴 전환 헬퍼 함수
    function navAndCloseWithFilter(viewId, category) {
      toggleMobileMenu();
      changeViewWithFilter(viewId, category);
    }

    // =============================================================
    // 💡 [구글 드라이브 동영상 임베드 URL 자동 변환기]
    // =============================================================
    function getDriveEmbedUrl(url) {
      if (!url) return null;
      const m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      if (m && m[1]) {
        return `https://drive.google.com/file/d/${m[1]}/preview`;
      }
      return url;
    }

    function openDriveVideoModal(url, title) {
      const previewUrl = getDriveEmbedUrl(url);
      if (!previewUrl) return alert('유효한 구글 드라이브 파일 링크가 아닙니다.');
      document.getElementById('driveModalTitle').innerHTML = `<i data-lucide="hard-drive" class="w-4 h-4 text-blue-400"></i> ${escapeHtml(title) || '구글 드라이브 녹화 영상'}`;
      document.getElementById('driveIframe').src = previewUrl;
      document.getElementById('driveVideoModal').classList.remove('hidden');
      lucide.createIcons();
    }

    function closeDriveVideoModal() {
      document.getElementById('driveIframe').src = '';
      document.getElementById('driveVideoModal').classList.add('hidden');
    }

    // -------------------------------------------------------------
    // [1] 모의서류평가 데이터 및 Supabase DB 연동 인터랙션
    // -------------------------------------------------------------
    let currentMockEvals = [];
    let selectedMockUnivId = "";
    let selectedMockSampleIdx = 0;

    async function loadMockEvalsData() {
      const { data, error } = await supabaseClient
        .from('mock_eval_folders')
        .select('*')
        .order('created_at', { ascending: true });

      if (error) {
        console.error('모의평가 로드 실패:', error);
        currentMockEvals = [];
      } else {
        currentMockEvals = data || [];
      }

      if (!selectedMockUnivId && currentMockEvals.length > 0) {
        selectedMockUnivId = currentMockEvals[0].id;
      }
      renderMockEvalUnivBadges();
      renderMockEvalDetails();
    }

    function renderMockEvalUnivBadges() {
      const container = document.getElementById('mockEvalUnivBadgeContainer');
      if (!container) return;

      if (!currentMockEvals.some(x => x.id === selectedMockUnivId)) {
        selectedMockUnivId = currentMockEvals[0]?.id || "";
      }

      container.innerHTML = currentMockEvals.map(item => {
        const isSelected = (item.id === selectedMockUnivId);
        return `
          <button type="button" onclick="selectMockEvalUniv('${item.id}')" class="px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shrink-0 ${
            isSelected
              ? 'bg-blue-600 text-white shadow-md shadow-blue-200 scale-105'
              : 'bg-white border border-slate-200 text-slate-700 hover:bg-blue-50 hover:border-blue-300'
          }">
            <i data-lucide="school" class="w-3.5 h-3.5"></i>
            <span>${escapeHtml(item.univ)}</span>
            <span class="text-[10px] px-1.5 py-0.2 rounded-full ${isSelected ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'} font-semibold">${item.samples?.length || 0}</span>
          </button>
        `;
      }).join('');
      lucide.createIcons();
    }

    function selectMockEvalUniv(id) {
      selectedMockUnivId = id;
      selectedMockSampleIdx = 0;
      renderMockEvalUnivBadges();
      renderMockEvalDetails();
    }

    function renderMockEvalDetails() {
      const targetUniv = currentMockEvals.find(x => x.id === selectedMockUnivId) || currentMockEvals[0];
      const tabsEl = document.getElementById('mockEvalSampleTabs');
      const videoBtnsEl = document.getElementById('mockEvalVideoBtns');
      const contentEl = document.getElementById('mockEvalContentArea');
      const actionBtnsEl = document.getElementById('mockEvalUnivActionBtns');

      if (!targetUniv) {
        if (contentEl) contentEl.innerHTML = '<p class="col-span-2 text-center text-slate-400 py-16">등록된 모의평가 대학 폴더가 없습니다. 상단의 [+ 새 대학 폴더 생성]을 눌러보세요.</p>';
        if (tabsEl) tabsEl.innerHTML = '';
        if (videoBtnsEl) videoBtnsEl.innerHTML = '';
        if (actionBtnsEl) actionBtnsEl.innerHTML = '';
        return;
      }

      if (tabsEl) {
        if (!targetUniv.samples || targetUniv.samples.length === 0) {
          tabsEl.innerHTML = '<span class="text-xs text-slate-400 py-1">등록된 생기부 샘플이 없습니다. 우측 [+ 이 대학에 샘플 추가] 버튼을 눌러주세요.</span>';
        } else {
          tabsEl.innerHTML = targetUniv.samples.map((s, idx) => `
            <button type="button" onclick="selectMockEvalSample(${idx})" class="px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              idx === selectedMockSampleIdx ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }">
              ${escapeHtml(s.title || `샘플 ${idx+1}`)}
            </button>
          `).join('');
        }
      }

      if (videoBtnsEl) {
        let vHtml = '';
        if (targetUniv.drive_video_url) {
          vHtml += `
            <button type="button" onclick="openMockDriveVideoSafe()" class="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-xs font-bold transition flex items-center gap-1">
              <i data-lucide="hard-drive" class="w-3.5 h-3.5"></i> 드라이브 영상
            </button>
          `;
        }
        if (targetUniv.youtube_url) {
          vHtml += `
            <button type="button" onclick="openMockYoutubeVideoSafe()" class="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-lg text-xs font-bold transition flex items-center gap-1">
              <i data-lucide="video" class="w-3.5 h-3.5"></i> 유튜브 영상
            </button>
          `;
        }
        videoBtnsEl.innerHTML = vHtml;
      }

      if (actionBtnsEl) {
        actionBtnsEl.innerHTML = isCurrentTeacher() ? `
          <button type="button" onclick="openEditMockFolderModal('${targetUniv.id}')" class="px-2.5 py-1 bg-slate-100 hover:bg-blue-50 text-blue-700 border border-slate-200 rounded-lg text-xs font-bold transition flex items-center gap-1">
            <i data-lucide="edit-3" class="w-3.5 h-3.5"></i> 폴더 수정
          </button>
          <button type="button" onclick="deleteMockEvalUniv('${targetUniv.id}')" class="px-2.5 py-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg text-xs font-semibold transition flex items-center gap-1">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i> 폴더 삭제
          </button>
        ` : '';
      }

      const sample = (targetUniv.samples && targetUniv.samples[selectedMockSampleIdx]) ? targetUniv.samples[selectedMockSampleIdx] : null;

      if (!sample) {
        if (contentEl) {
          contentEl.innerHTML = `
            <div class="col-span-2 text-center py-16 bg-slate-50 rounded-xl border border-dashed border-slate-200 space-y-2">
              <p class="text-xs font-bold text-slate-600">[${escapeHtml(targetUniv.univ)}] 대학 폴더가 선택되었습니다.</p>
              <p class="text-xs text-slate-400">상단의 [+ 이 대학에 샘플 추가] 버튼을 눌러 첫 번째 생기부 발췌문과 사정관 채점표를 등록해주세요!</p>
            </div>
          `;
        }
        lucide.createIcons();
        return;
      }

      if (contentEl) {
        contentEl.innerHTML = `
          <div class="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs">
            <div class="flex items-center justify-between border-b pb-2">
              <h3 class="font-bold text-slate-800 flex items-center gap-1.5 text-sm">
                <i data-lucide="book-open" class="w-4 h-4 text-blue-600"></i> ${escapeHtml(targetUniv.univ)} - ${escapeHtml(sample.title)}
              </h3>
              <span class="text-blue-600 font-bold bg-blue-50 px-2 py-0.5 rounded text-[11px]">${escapeHtml(targetUniv.type || '')}</span>
            </div>
            <div class="space-y-3 max-h-[500px] overflow-y-auto pr-1">
              <div class="bg-white p-3 rounded-lg border border-slate-200 space-y-1">
                <span class="font-bold text-blue-700 block">■ 교과 이수 현황 및 내신 성적</span>
                <p class="text-slate-700 leading-relaxed">${escapeHtml(sample.subjects || '이수과목 미입력')}</p>
              </div>
              <div class="bg-white p-3 rounded-lg border border-slate-200 space-y-1">
                <span class="font-bold text-blue-700 block">■ 교과세부능력 및 특기사항(세특)</span>
                <p class="text-slate-700 leading-relaxed whitespace-pre-line">${escapeHtml(sample.setek || '세특 미입력')}</p>
              </div>
              <div class="bg-white p-3 rounded-lg border border-slate-200 space-y-1">
                <span class="font-bold text-blue-700 block">■ 창의적 체험활동(동아리/진로)</span>
                <p class="text-slate-700 leading-relaxed whitespace-pre-line">${escapeHtml(sample.changche || '창체 미입력')}</p>
              </div>
            </div>
          </div>

          <div class="space-y-4 text-xs">
            <div class="flex items-center justify-between bg-blue-50/60 p-3 rounded-xl border border-blue-100">
              <span class="font-bold text-blue-900">현재 샘플: [${escapeHtml(sample.title)}]</span>
              ${isCurrentTeacher() ? `
                <div class="flex items-center gap-1.5">
                  <button type="button" onclick="openEditMockSampleModal(${selectedMockSampleIdx})" class="px-2.5 py-1 bg-white hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg font-bold transition flex items-center gap-1">
                    <i data-lucide="edit-3" class="w-3.5 h-3.5"></i> 샘플 내용 수정
                  </button>
                  <button type="button" onclick="deleteMockEvalSample(${selectedMockSampleIdx})" class="px-2 py-1 text-rose-600 hover:bg-rose-50 rounded-lg font-bold transition flex items-center gap-0.5">
                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i> 샘플 삭제
                  </button>
                </div>
              ` : ''}
            </div>

            <div class="bg-white p-4 rounded-xl border border-blue-200 shadow-xs space-y-3">
              <span class="font-bold text-slate-800 block text-sm flex items-center gap-1.5">
                <i data-lucide="edit-3" class="w-4 h-4 text-blue-600"></i> 선생님 모의 평가 입력
              </span>
              <div class="grid grid-cols-3 gap-2">
                <div>
                  <label class="block text-slate-600 font-semibold mb-1">학업역량</label>
                  <select class="w-full p-1.5 border rounded bg-white font-bold text-blue-600 outline-none">
                    <option>S (탁월)</option><option selected>A (우수)</option><option>B (보통)</option><option>C (미흡)</option>
                  </select>
                </div>
                <div>
                  <label class="block text-slate-600 font-semibold mb-1">진로역량</label>
                  <select class="w-full p-1.5 border rounded bg-white font-bold text-emerald-600 outline-none">
                    <option selected>S (탁월)</option><option>A (우수)</option><option>B (보통)</option><option>C (미흡)</option>
                  </select>
                </div>
                <div>
                  <label class="block text-slate-600 font-semibold mb-1">공동체역량</label>
                  <select class="w-full p-1.5 border rounded bg-white font-bold text-amber-600 outline-none">
                    <option selected>S (탁월)</option><option>A (우수)</option><option>B (보통)</option><option>C (미흡)</option>
                  </select>
                </div>
              </div>
              <textarea rows="3" placeholder="선생님의 정성평가 의견 및 합격/불합격 예측 코멘트를 적어보세요." class="w-full p-2.5 border rounded-lg text-xs outline-none leading-relaxed"></textarea>
            </div>

            <div class="bg-emerald-50 border border-emerald-200 p-4 rounded-xl space-y-2.5 shadow-xs">
              <div class="flex items-center justify-between">
                <span class="font-bold text-emerald-900 text-sm flex items-center gap-1.5">
                  <i data-lucide="check-circle" class="w-4 h-4 text-emerald-600"></i> 대학의 실제 평가 결과
                </span>
                <span class="px-2.5 py-0.5 bg-emerald-600 text-white rounded-md text-[11px] font-black">${escapeHtml(sample.result || '결과 미등록')}</span>
              </div>
              <div class="bg-white p-3 rounded-lg border border-emerald-100 space-y-1.5 leading-relaxed text-slate-700">
                <p class="font-semibold text-emerald-900">• 입학사정관 실제 총평 및 선발 요인:</p>
                <p class="whitespace-pre-line text-xs">${escapeHtml(sample.actualComment || '사정관 총평이 등록되지 않았습니다.')}</p>
              </div>
            </div>
          </div>
        `;
      }
      lucide.createIcons();
    }

    function selectMockEvalSample(idx) {
      selectedMockSampleIdx = idx;
      renderMockEvalDetails();
    }

    function openNewMockFolderModal() {
      document.getElementById('mockFolderEditId').value = '';
      document.getElementById('mockFolderModalTitle').innerHTML = '<i data-lucide="folder-plus" class="w-4 h-4 text-blue-600"></i> 새 모의평가 대학 폴더 생성';
      document.getElementById('mockFolderUniv').value = '';
      document.getElementById('mockFolderType').value = '학생부종합(활동우수형)';
      document.getElementById('mockFolderDriveVideo').value = '';
      document.getElementById('mockFolderYoutube').value = '';
      document.getElementById('mockFolderSubmitBtn').innerText = '폴더 생성 완료';
      document.getElementById('mockFolderModal').classList.remove('hidden');
      lucide.createIcons();
    }

    function openEditMockFolderModal(id) {
      const target = currentMockEvals.find(x => x.id === id);
      if (!target) return;
      document.getElementById('mockFolderEditId').value = target.id;
      document.getElementById('mockFolderModalTitle').innerHTML = '<i data-lucide="edit-3" class="w-4 h-4 text-blue-600"></i> 대학 폴더 정보 수정';
      document.getElementById('mockFolderUniv').value = target.univ || '';
      document.getElementById('mockFolderType').value = target.type || '';
      document.getElementById('mockFolderDriveVideo').value = target.drive_video_url || '';
      document.getElementById('mockFolderYoutube').value = target.youtube_url || '';
      document.getElementById('mockFolderSubmitBtn').innerText = '수정사항 저장';
      document.getElementById('mockFolderModal').classList.remove('hidden');
      lucide.createIcons();
    }

    function closeMockFolderModal() {
      document.getElementById('mockFolderModal').classList.add('hidden');
    }

    async function saveMockEvalFolder() {
      const editId = document.getElementById('mockFolderEditId').value;
      const univ = document.getElementById('mockFolderUniv').value.trim();
      const type = document.getElementById('mockFolderType').value.trim();
      const driveVideo = document.getElementById('mockFolderDriveVideo').value.trim();
      const youtubeUrl = document.getElementById('mockFolderYoutube').value.trim();

      if (!univ) return alert('대학교명을 입력해주세요.');

      const record = {
        univ: univ,
        type: type || '학생부종합전형',
        drive_video_url: driveVideo,
        youtube_url: youtubeUrl
      };

      if (editId) {
        const { error } = await supabaseClient.from('mock_eval_folders').update(record).eq('id', editId);
        if (error) return alert('수정 실패: ' + error.message);
        alert(`[${univ}] 대학 폴더가 성공적으로 수정되었습니다!`);
      } else {
        record.id = 'mock_' + Date.now();
        record.samples = [];
        const { error } = await supabaseClient.from('mock_eval_folders').insert([record]);
        if (error) return alert('생성 실패: ' + error.message);
        selectedMockUnivId = record.id;
        selectedMockSampleIdx = 0;
        alert(`[${univ}] 새 대학 폴더가 DB에 생성되었습니다!`);
      }

      closeMockFolderModal();
      loadMockEvalsData();
    }

    async function deleteMockEvalUniv(id) {
      if (!isCurrentTeacher()) return alert('선생님만 삭제할 수 있습니다.');
      const target = currentMockEvals.find(x => x.id === id);
      if (!target) return;
      if (!confirm(`'${target.univ}' 모의평가 폴더와 등록된 모든 샘플을 완전히 삭제할까요?`)) return;

      const { error } = await supabaseClient.from('mock_eval_folders').delete().eq('id', id);
      if (error) return alert('삭제 실패: ' + error.message);

      alert(`'${target.univ}' 폴더가 완전히 삭제되었습니다.`);
      selectedMockUnivId = "";
      selectedMockSampleIdx = 0;
      loadMockEvalsData();
    }

    function openNewMockSampleModal() {
      const targetUniv = currentMockEvals.find(x => x.id === selectedMockUnivId);
      if (!targetUniv) return alert('먼저 대학 폴더를 선택하거나 생성해주세요.');

      document.getElementById('mockSampleEditIdx').value = '-1';
      document.getElementById('mockSampleModalTitle').innerHTML = '<i data-lucide="file-plus" class="w-5 h-5 text-blue-600"></i> 생기부 평가 샘플 등록';
      document.getElementById('mockSampleModalUnivLabel').innerText = `선택된 대학: [${targetUniv.univ}] (${targetUniv.type || ''})`;
      document.getElementById('mockInputSampleTitle').value = '';
      document.getElementById('mockInputResult').value = '최초합격';
      document.getElementById('mockInputSubjects').value = '';
      document.getElementById('mockInputSetek').value = '';
      document.getElementById('mockInputChangche').value = '';
      document.getElementById('mockInputActualComment').value = '';
      document.getElementById('mockSampleSubmitBtn').innerText = '샘플 등록 완료';
      document.getElementById('newMockEvalModal').classList.remove('hidden');
      lucide.createIcons();
    }

    function openEditMockSampleModal(sampleIdx) {
      const targetUniv = currentMockEvals.find(x => x.id === selectedMockUnivId);
      if (!targetUniv || !targetUniv.samples || !targetUniv.samples[sampleIdx]) return;

      const sample = targetUniv.samples[sampleIdx];
      document.getElementById('mockSampleEditIdx').value = sampleIdx;
      document.getElementById('mockSampleModalTitle').innerHTML = '<i data-lucide="edit-3" class="w-5 h-5 text-blue-600"></i> 생기부 평가 샘플 수정';
      document.getElementById('mockSampleModalUnivLabel').innerText = `수정 대상 대학: [${targetUniv.univ}]`;
      document.getElementById('mockInputSampleTitle').value = sample.title || '';
      document.getElementById('mockInputResult').value = sample.result || '';
      document.getElementById('mockInputSubjects').value = sample.subjects || '';
      document.getElementById('mockInputSetek').value = sample.setek || '';
      document.getElementById('mockInputChangche').value = sample.changche || '';
      document.getElementById('mockInputActualComment').value = sample.actualComment || '';
      document.getElementById('mockSampleSubmitBtn').innerText = '수정사항 저장';
      document.getElementById('newMockEvalModal').classList.remove('hidden');
      lucide.createIcons();
    }

    function closeNewMockEvalModal() {
      document.getElementById('newMockEvalModal').classList.add('hidden');
    }

    async function saveNewMockEvalSample() {
      const targetUniv = currentMockEvals.find(x => x.id === selectedMockUnivId);
      if (!targetUniv) return alert('대학 폴더를 찾을 수 없습니다.');

      const editIdx = parseInt(document.getElementById('mockSampleEditIdx').value);
      const title = document.getElementById('mockInputSampleTitle').value.trim();
      const result = document.getElementById('mockInputResult').value.trim();
      const subjects = document.getElementById('mockInputSubjects').value.trim();
      const setek = document.getElementById('mockInputSetek').value.trim();
      const changche = document.getElementById('mockInputChangche').value.trim();
      const actualComment = document.getElementById('mockInputActualComment').value.trim();

      if (!title) return alert('샘플 이름/학과명을 입력해주세요.');

      const updatedSamples = targetUniv.samples ? [...targetUniv.samples] : [];

      if (editIdx >= 0 && updatedSamples[editIdx]) {
        updatedSamples[editIdx] = {
          ...updatedSamples[editIdx],
          title, result, subjects, setek, changche, actualComment
        };
      } else {
        updatedSamples.push({
          id: 'sample_' + Date.now(),
          title, result, subjects, setek, changche, actualComment
        });
        selectedMockSampleIdx = updatedSamples.length - 1;
      }

      const { error } = await supabaseClient
        .from('mock_eval_folders')
        .update({ samples: updatedSamples })
        .eq('id', targetUniv.id);

      if (error) return alert('샘플 저장 실패: ' + error.message);

      alert('생기부 샘플이 DB에 안전하게 저장되었습니다!');
      closeNewMockEvalModal();
      loadMockEvalsData();
    }

    async function deleteMockEvalSample(sampleIdx) {
      if (!isCurrentTeacher()) return alert('선생님만 삭제할 수 있습니다.');
      const targetUniv = currentMockEvals.find(x => x.id === selectedMockUnivId);
      if (!targetUniv || !targetUniv.samples || !targetUniv.samples[sampleIdx]) return;

      if (!confirm(`'${targetUniv.samples[sampleIdx].title}' 생기부 샘플을 삭제할까요?`)) return;

      const updatedSamples = targetUniv.samples.filter((_, idx) => idx !== sampleIdx);
      const { error } = await supabaseClient
        .from('mock_eval_folders')
        .update({ samples: updatedSamples })
        .eq('id', targetUniv.id);

      if (error) return alert('샘플 삭제 실패: ' + error.message);

      selectedMockSampleIdx = 0;
      alert('샘플이 삭제되었습니다.');
      loadMockEvalsData();
    }


    // -------------------------------------------------------------
    // [2] 교사간담회 Q&A 데이터 및 Supabase DB 연동 인터랙션
    // -------------------------------------------------------------
    let currentTeacherForums = [];
    let selectedForumFolderId = "";

    async function loadTeacherForumsData() {
      const { data, error } = await supabaseClient
        .from('teacher_forum_folders')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('간담회 로드 실패:', error);
        currentTeacherForums = [];
      } else {
        currentTeacherForums = data || [];
      }

      if (!selectedForumFolderId && currentTeacherForums.length > 0) {
        selectedForumFolderId = currentTeacherForums[0].id;
      }
      renderTeacherForumUnivBadges();
      renderTeacherForumCards();
    }

    function renderTeacherForumUnivBadges() {
      const container = document.getElementById('forumUnivBadgeContainer');
      if (!container) return;

      if (!currentTeacherForums.some(f => f.id === selectedForumFolderId)) {
        selectedForumFolderId = currentTeacherForums[0]?.id || "";
      }

      container.innerHTML = currentTeacherForums.map(item => {
        const isSelected = (item.id === selectedForumFolderId);
        const qCount = item.questions?.length || 0;
        return `
          <button type="button" onclick="selectForumFolder('${item.id}')" class="px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shrink-0 ${
            isSelected
              ? 'bg-emerald-600 text-white shadow-md shadow-emerald-200 scale-105'
              : 'bg-white border border-slate-200 text-slate-700 hover:bg-emerald-50 hover:border-emerald-300'
          }">
            <i data-lucide="school" class="w-3.5 h-3.5"></i>
            <span>${escapeHtml(item.univ)}</span>
            <span class="text-[10px] px-1.5 py-0.2 rounded-full ${isSelected ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'} font-semibold">${qCount}건</span>
          </button>
        `;
      }).join('');
      lucide.createIcons();
    }

    function selectForumFolder(folderId) {
      selectedForumFolderId = folderId;
      renderTeacherForumUnivBadges();
      renderTeacherForumCards();
    }

    function renderTeacherForumCards() {
      const bannerEl = document.getElementById('forumFolderInfoBanner');
      const container = document.getElementById('teacherForumListContainer');
      const searchKeyword = (document.getElementById('forumSearchInput')?.value || '').trim().toLowerCase();
      if (!container) return;

      const currentFolder = currentTeacherForums.find(f => f.id === selectedForumFolderId);

      if (!currentFolder) {
        if (bannerEl) bannerEl.innerHTML = '<span class="text-slate-400">간담회 폴더가 없습니다.</span>';
        container.innerHTML = '<p class="text-center text-slate-400 py-16 bg-slate-50 rounded-xl border">등록된 간담회 폴더가 없습니다. 상단의 [+ 새 간담회 행사 등록]을 눌러주세요.</p>';
        return;
      }

      if (bannerEl) {
        bannerEl.innerHTML = `
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-black text-emerald-900 text-sm flex items-center gap-1">
              <i data-lucide="school" class="w-4 h-4 text-emerald-600"></i> ${escapeHtml(currentFolder.univ)}
            </span>
            <span class="text-emerald-700 font-semibold">• ${escapeHtml(currentFolder.session)}</span>
            <span class="text-[11px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-bold">질문 ${currentFolder.questions?.length || 0}건</span>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            ${currentFolder.drive_file_url ? `
              <button type="button" onclick="openForumFolderDriveSafe()" class="px-2.5 py-1 bg-white hover:bg-emerald-100 text-emerald-700 border border-emerald-300 rounded-lg font-bold flex items-center gap-1 shadow-xs transition">
                <i data-lucide="hard-drive" class="w-3.5 h-3.5 text-blue-600"></i> 간담회 자료집
              </button>
            ` : ''}
            ${currentFolder.video_url ? `
              <button type="button" onclick="openForumFolderVideoSafe()" class="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-lg font-bold flex items-center gap-1 transition">
                <i data-lucide="video" class="w-3.5 h-3.5"></i> 행사 영상
              </button>
            ` : ''}
            ${isCurrentTeacher() ? `
              <button type="button" onclick="openEditTeacherForumFolderModal('${currentFolder.id}')" class="px-2.5 py-1 bg-white hover:bg-emerald-50 text-emerald-800 border border-emerald-300 rounded-lg font-bold transition flex items-center gap-1">
                <i data-lucide="edit-3" class="w-3.5 h-3.5"></i> 폴더 수정
              </button>
              <button type="button" onclick="deleteForumFolder('${currentFolder.id}')" class="px-2 py-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition text-xs flex items-center gap-0.5">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i> 삭제
              </button>
            ` : ''}
          </div>
        `;
      }

      let qList = currentFolder.questions || [];

      if (searchKeyword) {
        qList = qList.filter(item =>
          (item.question && item.question.toLowerCase().includes(searchKeyword)) ||
          (item.answer && item.answer.toLowerCase().includes(searchKeyword)) ||
          (item.tip && item.tip.toLowerCase().includes(searchKeyword))
        );
      }

      if (qList.length === 0) {
        container.innerHTML = `
          <div class="text-center py-16 bg-slate-50 rounded-xl border border-dashed border-slate-200 space-y-2">
            <p class="text-xs font-bold text-slate-600">[${escapeHtml(currentFolder.univ)}] 간담회에 등록된 질문이 없습니다.</p>
            <p class="text-xs text-slate-400">우측 상단의 [+ 이 간담회에 Q&A 추가] 버튼을 눌러 질문을 등록하세요.</p>
          </div>
        `;
        lucide.createIcons();
        return;
      }

      container.innerHTML = qList.map((item, idx) => `
        <div class="border rounded-xl p-4 bg-white shadow-xs space-y-2.5 relative group hover:border-emerald-400 transition">
          <div class="flex items-center justify-between border-b pb-1.5">
            <div class="flex items-center gap-2">
              <span class="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-black text-[11px]">질문 ${idx + 1}</span>
              ${item.drive_url ? `
                <a href="${encodeURI(item.drive_url)}" target="_blank" rel="noopener noreferrer" class="px-2 py-0.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded text-[10px] font-bold inline-flex items-center gap-1 border border-blue-200">
                  <i data-lucide="hard-drive" class="w-3 h-3"></i> 참고자료
                </a>
              ` : ''}
              ${item.video_url ? `
                <button type="button" onclick="openForumQuestionVideoSafe('${item.id}')" class="px-2 py-0.5 bg-rose-50 text-rose-600 hover:bg-rose-100 rounded text-[10px] font-bold inline-flex items-center gap-1 border border-rose-200">
                  <i data-lucide="video" class="w-3 h-3"></i> 관련영상
                </button>
              ` : ''}
            </div>

            ${isCurrentTeacher() ? `
              <div class="flex items-center gap-1">
                <button type="button" onclick="openEditTeacherForumModal('${item.id}')" title="질문 수정" class="text-slate-400 hover:text-emerald-600 p-1 rounded hover:bg-emerald-50 transition">
                  <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
                </button>
                <button type="button" onclick="deleteTeacherForumQuestion('${item.id}')" title="질문 삭제" class="text-slate-400 hover:text-rose-600 p-1 rounded hover:bg-rose-50 transition">
                  <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                </button>
              </div>
            ` : ''}
          </div>
          
          <div class="space-y-2 text-xs">
            <div class="font-bold text-slate-800 flex items-start gap-2">
              <span class="text-blue-600 font-black text-sm">Q.</span>
              <span class="leading-snug">${escapeHtml(item.question)}</span>
            </div>
            <div class="pl-4 text-slate-700 leading-relaxed border-l-2 border-emerald-500 my-1 bg-emerald-50/30 p-2.5 rounded-r-lg">
              <span class="font-bold text-emerald-900 block mb-1">📢 사정관 공식 답변:</span>
              <p class="whitespace-pre-line">${escapeHtml(item.answer)}</p>
            </div>
            ${item.tip ? `
              <div class="text-[11px] text-amber-800 bg-amber-50 p-2 rounded-lg border border-amber-200 flex items-center gap-1.5">
                <i data-lucide="sparkles" class="w-3.5 h-3.5 text-amber-600 shrink-0"></i>
                <span><b>지도 팁:</b> ${escapeHtml(item.tip)}</span>
              </div>
            ` : ''}
          </div>
        </div>
      `).join('');

      lucide.createIcons();
    }

    function handleGenericVideoOpen(url, title) {
      if (!url) return alert('등록된 영상 링크가 없습니다.');
      if (url.includes('youtu.be') || url.includes('youtube.com')) {
        openBriefingVideo(url, title);
      } else {
        openDriveVideoModal(url, title);
      }
    }

    // [보안 패치] 따옴표 스크립트 인젝션(XSS) 방지 전용 안전 호출 헬퍼
    function openMockDriveVideoSafe() {
      const targetUniv = currentMockEvals.find(x => x.id === selectedMockUnivId);
      if (targetUniv && targetUniv.drive_video_url) {
        openDriveVideoModal(targetUniv.drive_video_url, (targetUniv.univ || '') + ' 워크숍 영상');
      }
    }

    function openMockYoutubeVideoSafe() {
      const targetUniv = currentMockEvals.find(x => x.id === selectedMockUnivId);
      if (targetUniv && targetUniv.youtube_url) {
        openBriefingVideo(targetUniv.youtube_url, targetUniv.univ || '');
      }
    }

    function openForumFolderDriveSafe() {
      const folder = currentTeacherForums.find(f => f.id === selectedForumFolderId);
      if (folder && folder.drive_file_url) {
        window.open(folder.drive_file_url, '_blank');
      }
    }

    function openForumFolderVideoSafe() {
      const folder = currentTeacherForums.find(f => f.id === selectedForumFolderId);
      if (folder && folder.video_url) {
        handleGenericVideoOpen(folder.video_url, (folder.univ || '') + ' 간담회 영상');
      }
    }

    function openForumQuestionVideoSafe(qId) {
      const folder = currentTeacherForums.find(f => f.id === selectedForumFolderId);
      const q = folder?.questions?.find(item => item.id === qId);
      if (q && q.video_url) {
        handleGenericVideoOpen(q.video_url, '질문 관련 영상');
      }
    }

    function openBriefingPdfById(itemId) {
      const folder = currentBriefingFolders.find(f => f.id === selectedBriefingFolderId);
      const item = folder?.items?.find(x => x.id === itemId);
      if (item && item.pdfUrl) openBriefingPdf(item.pdfUrl);
    }

    function openBriefingDriveById(itemId) {
      const folder = currentBriefingFolders.find(f => f.id === selectedBriefingFolderId);
      const item = folder?.items?.find(x => x.id === itemId);
      if (item && item.driveVideoUrl) openDriveVideoModal(item.driveVideoUrl, (item.univ || '') + ' 설명회 녹화영상');
    }

    function openBriefingYoutubeById(itemId) {
      const folder = currentBriefingFolders.find(f => f.id === selectedBriefingFolderId);
      const item = folder?.items?.find(x => x.id === itemId);
      if (item && item.youtubeUrl) openBriefingVideo(item.youtubeUrl, item.univ || '');
    }


    function openNewTeacherForumFolderModal() {
      document.getElementById('forumFolderEditId').value = '';
      document.getElementById('forumFolderModalTitle').innerHTML = '<i data-lucide="folder-plus" class="w-4 h-4 text-emerald-600"></i> 새 간담회 행사 폴더 생성';
      document.getElementById('forumFolderUniv').value = '';
      document.getElementById('forumFolderSession').value = '';
      document.getElementById('forumFolderDriveUrl').value = '';
      document.getElementById('forumFolderVideoUrl').value = '';
      document.getElementById('forumFolderSubmitBtn').innerText = '간담회 생성 완료';
      document.getElementById('forumFolderModal').classList.remove('hidden');
      lucide.createIcons();
    }

    function openEditTeacherForumFolderModal(folderId) {
      const target = currentTeacherForums.find(f => f.id === folderId);
      if (!target) return;

      document.getElementById('forumFolderEditId').value = target.id;
      document.getElementById('forumFolderModalTitle').innerHTML = '<i data-lucide="edit-3" class="w-4 h-4 text-emerald-600"></i> 간담회 행사 정보 수정';
      document.getElementById('forumFolderUniv').value = target.univ || '';
      document.getElementById('forumFolderSession').value = target.session || '';
      document.getElementById('forumFolderDriveUrl').value = target.drive_file_url || '';
      document.getElementById('forumFolderVideoUrl').value = target.video_url || '';
      document.getElementById('forumFolderSubmitBtn').innerText = '수정사항 저장';
      document.getElementById('forumFolderModal').classList.remove('hidden');
      lucide.createIcons();
    }

    function closeTeacherForumFolderModal() {
      document.getElementById('forumFolderModal').classList.add('hidden');
    }

    async function saveTeacherForumFolder() {
      const editId = document.getElementById('forumFolderEditId').value;
      const univ = document.getElementById('forumFolderUniv').value.trim();
      const session = document.getElementById('forumFolderSession').value.trim();
      const driveUrl = document.getElementById('forumFolderDriveUrl').value.trim();
      const videoUrl = document.getElementById('forumFolderVideoUrl').value.trim();

      if (!univ || !session) return alert('대학명과 간담회 행사명을 입력해주세요.');

      const record = {
        univ: univ,
        session: session,
        drive_file_url: driveUrl,
        video_url: videoUrl
      };

      if (editId) {
        const { error } = await supabaseClient.from('teacher_forum_folders').update(record).eq('id', editId);
        if (error) return alert('수정 실패: ' + error.message);
        alert(`[${univ}] 간담회 정보가 성공적으로 수정되었습니다!`);
      } else {
        record.id = 'forum_' + Date.now();
        record.questions = [];
        const { error } = await supabaseClient.from('teacher_forum_folders').insert([record]);
        if (error) return alert('생성 실패: ' + error.message);
        selectedForumFolderId = record.id;
        alert(`[${univ} - ${session}] 새 간담회 폴더가 DB에 생성되었습니다!`);
      }

      closeTeacherForumFolderModal();
      loadTeacherForumsData();
    }

    async function deleteForumFolder(folderId) {
      if (!isCurrentTeacher()) return alert('선생님만 삭제할 수 있습니다.');
      const target = currentTeacherForums.find(f => f.id === folderId);
      if (!target) return;
      if (!confirm(`'${target.univ} - ${target.session}' 폴더와 등록된 모든 Q&A를 삭제할까요?`)) return;

      const { error } = await supabaseClient.from('teacher_forum_folders').delete().eq('id', folderId);
      if (error) return alert('삭제 실패: ' + error.message);

      alert('간담회 폴더가 완전히 삭제되었습니다.');
      selectedForumFolderId = "";
      loadTeacherForumsData();
    }

    function openNewTeacherForumModal() {
      const currentFolder = currentTeacherForums.find(f => f.id === selectedForumFolderId);
      if (!currentFolder) return alert('먼저 간담회 폴더를 생성하거나 선택해주세요.');

      document.getElementById('forumQuestionEditId').value = '';
      document.getElementById('forumQnaModalTitle').innerHTML = '<i data-lucide="message-square-plus" class="w-4 h-4 text-emerald-600"></i> 사정관 질의응답(Q&A) 등록';
      document.getElementById('forumQnaModalBanner').innerText = `등록 대상: [${currentFolder.univ}] ${currentFolder.session}`;
      document.getElementById('forumInputQuestion').value = '';
      document.getElementById('forumInputAnswer').value = '';
      document.getElementById('forumInputTip').value = '';
      document.getElementById('forumInputDriveUrl').value = '';
      document.getElementById('forumInputVideoUrl').value = '';
      document.getElementById('forumKeepOpenWrapper').classList.remove('hidden');
      document.getElementById('forumQuestionSubmitBtn').innerText = 'Q&A 저장하기';
      document.getElementById('newTeacherForumModal').classList.remove('hidden');
      lucide.createIcons();
    }

    function openEditTeacherForumModal(questionId) {
      const currentFolder = currentTeacherForums.find(f => f.id === selectedForumFolderId);
      if (!currentFolder) return;
      const qItem = currentFolder.questions?.find(q => q.id === questionId);
      if (!qItem) return;

      document.getElementById('forumQuestionEditId').value = qItem.id;
      document.getElementById('forumQnaModalTitle').innerHTML = '<i data-lucide="edit-3" class="w-4 h-4 text-emerald-600"></i> 사정관 질의응답(Q&A) 수정';
      document.getElementById('forumQnaModalBanner').innerText = `수정 대상: [${currentFolder.univ}] 질문`;
      document.getElementById('forumInputQuestion').value = qItem.question || '';
      document.getElementById('forumInputAnswer').value = qItem.answer || '';
      document.getElementById('forumInputTip').value = qItem.tip || '';
      document.getElementById('forumInputDriveUrl').value = qItem.drive_url || '';
      document.getElementById('forumInputVideoUrl').value = qItem.video_url || '';
      document.getElementById('forumKeepOpenWrapper').classList.add('hidden');
      document.getElementById('forumQuestionSubmitBtn').innerText = '수정사항 저장';
      document.getElementById('newTeacherForumModal').classList.remove('hidden');
      lucide.createIcons();
    }

    function closeNewTeacherForumModal() {
      document.getElementById('newTeacherForumModal').classList.add('hidden');
    }

    async function saveTeacherForumQuestion() {
      const currentFolder = currentTeacherForums.find(f => f.id === selectedForumFolderId);
      if (!currentFolder) return alert('간담회 폴더를 찾을 수 없습니다.');

      const editId = document.getElementById('forumQuestionEditId').value;
      const q = document.getElementById('forumInputQuestion').value.trim();
      const a = document.getElementById('forumInputAnswer').value.trim();
      const tip = document.getElementById('forumInputTip').value.trim();
      const driveUrl = document.getElementById('forumInputDriveUrl').value.trim();
      const videoUrl = document.getElementById('forumInputVideoUrl').value.trim();
      const keepOpen = document.getElementById('forumKeepOpenCheck').checked;

      if (!q || !a) return alert('질문과 사정관 답변을 모두 입력해주세요.');

      const updatedQuestions = currentFolder.questions ? [...currentFolder.questions] : [];

      if (editId) {
        const targetQ = updatedQuestions.find(item => item.id === editId);
        if (targetQ) {
          targetQ.question = q;
          targetQ.answer = a;
          targetQ.tip = tip;
          targetQ.drive_url = driveUrl;
          targetQ.video_url = videoUrl;
        }
      } else {
        updatedQuestions.push({
          id: 'q_' + Date.now() + '_' + Math.random().toString(36).substr(2, 3),
          question: q,
          answer: a,
          tip: tip,
          drive_url: driveUrl,
          video_url: videoUrl
        });
      }

      const { error } = await supabaseClient
        .from('teacher_forum_folders')
        .update({ questions: updatedQuestions })
        .eq('id', currentFolder.id);

      if (error) return alert('질문 저장 실패: ' + error.message);

      if (!editId && keepOpen) {
        document.getElementById('forumInputQuestion').value = '';
        document.getElementById('forumInputAnswer').value = '';
        document.getElementById('forumInputTip').value = '';
        document.getElementById('forumInputDriveUrl').value = '';
        document.getElementById('forumInputVideoUrl').value = '';
        document.getElementById('forumInputQuestion').focus();
        alert('질문이 DB에 저장되었습니다! 다음 질문을 바로 입력하세요.');
      } else {
        alert('질문이 성공적으로 저장되었습니다!');
        closeNewTeacherForumModal();
      }

      loadTeacherForumsData();
    }

    async function deleteTeacherForumQuestion(questionId) {
      if (!isCurrentTeacher()) return alert('선생님만 삭제할 수 있습니다.');
      const currentFolder = currentTeacherForums.find(f => f.id === selectedForumFolderId);
      if (!currentFolder) return;
      if (!confirm('이 질의응답을 삭제할까요?')) return;

      const updatedQuestions = currentFolder.questions.filter(q => q.id !== questionId);
      const { error } = await supabaseClient
        .from('teacher_forum_folders')
        .update({ questions: updatedQuestions })
        .eq('id', currentFolder.id);

      if (error) return alert('삭제 실패: ' + error.message);

      alert('질문이 삭제되었습니다.');
      loadTeacherForumsData();
    }


    // -------------------------------------------------------------
    // [3] 입학설명회 전형 주요사항 및 Supabase DB 연동 인터랙션
    // -------------------------------------------------------------
    let currentBriefingFolders = [];
    let selectedBriefingFolderId = "";

    async function loadBriefingFoldersData() {
      const { data, error } = await supabaseClient
        .from('briefing_folders')
        .select('*')
        .order('created_at', { ascending: true });

      if (error) {
        console.error('설명회 로드 실패:', error);
        currentBriefingFolders = [];
      } else {
        currentBriefingFolders = data || [];
      }

      if (!selectedBriefingFolderId && currentBriefingFolders.length > 0) {
        selectedBriefingFolderId = currentBriefingFolders[0].id;
      }
      renderBriefingFolderBadges();
      renderBriefingCards();
    }

    function renderBriefingFolderBadges() {
      const container = document.getElementById('briefingFolderBadgeContainer');
      if (!container) return;

      if (!currentBriefingFolders.some(f => f.id === selectedBriefingFolderId)) {
        selectedBriefingFolderId = currentBriefingFolders[0]?.id || "";
      }

      container.innerHTML = currentBriefingFolders.map(folder => {
        const isSelected = (folder.id === selectedBriefingFolderId);
        const count = folder.items?.length || 0;
        return `
          <button type="button" onclick="selectBriefingFolder('${folder.id}')" class="px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shrink-0 ${
            isSelected
              ? 'bg-amber-500 text-white shadow-md shadow-amber-200 scale-105'
              : 'bg-white border border-slate-200 text-slate-700 hover:bg-amber-50 hover:border-amber-300'
          }">
            <i data-lucide="folder" class="w-3.5 h-3.5"></i>
            <span>${escapeHtml(folder.name)}</span>
            <span class="text-[10px] px-1.5 py-0.2 rounded-full ${isSelected ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'} font-semibold">${count}개교</span>
          </button>
        `;
      }).join('');
      lucide.createIcons();
    }

    function selectBriefingFolder(folderId) {
      selectedBriefingFolderId = folderId;
      renderBriefingFolderBadges();
      renderBriefingCards();
    }

    function renderBriefingCards() {
      const bannerEl = document.getElementById('briefingFolderInfoBanner');
      const container = document.getElementById('admissionBriefingGrid');
      const searchKeyword = (document.getElementById('briefingSearchInput')?.value || '').trim().toLowerCase();
      if (!container) return;

      const currentFolder = currentBriefingFolders.find(f => f.id === selectedBriefingFolderId);

      if (!currentFolder) {
        if (bannerEl) bannerEl.innerHTML = '<span class="text-slate-400">선택된 폴더가 없습니다.</span>';
        container.innerHTML = '<p class="col-span-full text-center text-slate-400 py-16 bg-slate-50 rounded-xl border">등록된 설명회 폴더가 없습니다. 상단의 [+ 새 설명회 폴더 생성]을 눌러보세요.</p>';
        return;
      }

      if (bannerEl) {
        bannerEl.innerHTML = `
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-black text-amber-900 text-sm flex items-center gap-1">
              <i data-lucide="folder-open" class="w-4 h-4 text-amber-600"></i> ${escapeHtml(currentFolder.name)}
            </span>
            ${currentFolder.description ? `<span class="text-amber-700 font-semibold">• ${escapeHtml(currentFolder.description)}</span>` : ''}
            <span class="text-[11px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-bold">${currentFolder.items?.length || 0}개 대학 등록됨</span>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            ${currentFolder.drive_url ? `
              <a href="${encodeURI(currentFolder.drive_url)}" target="_blank" rel="noopener noreferrer" class="px-2.5 py-1 bg-white hover:bg-amber-100 text-amber-800 border border-amber-300 rounded-lg font-bold flex items-center gap-1 shadow-xs transition">
                <i data-lucide="hard-drive" class="w-3.5 h-3.5 text-blue-600"></i> 폴더 자료실 열기
              </a>
            ` : ''}
            ${isCurrentTeacher() ? `
              <button type="button" onclick="openEditBriefingFolderModal('${currentFolder.id}')" class="px-2.5 py-1 bg-white hover:bg-amber-50 text-amber-800 border border-amber-300 rounded-lg font-bold transition flex items-center gap-1">
                <i data-lucide="edit-3" class="w-3.5 h-3.5"></i> 폴더 수정
              </button>
              <button type="button" onclick="deleteBriefingFolder('${currentFolder.id}')" class="px-2 py-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition text-xs flex items-center gap-0.5">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i> 폴더 삭제
              </button>
            ` : ''}
          </div>
        `;
      }

      let list = currentFolder.items || [];

      if (searchKeyword) {
        list = list.filter(item =>
          (item.univ && item.univ.toLowerCase().includes(searchKeyword)) ||
          (item.title && item.title.toLowerCase().includes(searchKeyword)) ||
          (item.changes && item.changes.toLowerCase().includes(searchKeyword))
        );
      }

      if (list.length === 0) {
        container.innerHTML = `
          <div class="col-span-full text-center py-16 bg-slate-50 rounded-xl border border-dashed border-slate-200 space-y-2">
            <p class="text-xs font-bold text-slate-600">[${escapeHtml(currentFolder.name)}] 폴더에 등록된 설명회 자료가 없습니다.</p>
            <p class="text-xs text-slate-400">우측 상단의 [+ 이 폴더에 설명회 자료 등록] 버튼을 눌러 대학별 입시 변동사항을 추가하세요.</p>
          </div>
        `;
        lucide.createIcons();
        return;
      }

      container.innerHTML = list.map(item => `
        <div class="border rounded-2xl p-4 bg-white shadow-xs space-y-3 hover:border-amber-400 transition flex flex-col justify-between group">
          <div>
            <div class="flex items-center justify-between mb-1">
              <span class="font-black text-slate-800 text-base">${escapeHtml(item.univ)}</span>
              <div class="flex items-center gap-1.5">
                <span class="px-2 py-0.5 bg-amber-100 text-amber-800 font-bold rounded text-[10px]">${escapeHtml(item.title || '설명회')}</span>
                ${isCurrentTeacher() ? `
                  <button type="button" onclick="openEditBriefingModal('${item.id}')" title="자료 수정" class="text-slate-400 hover:text-amber-600 p-1 rounded hover:bg-amber-50 transition">
                    <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
                  </button>
                  <button type="button" onclick="deleteBriefing('${item.id}')" title="자료 삭제" class="text-slate-400 hover:text-rose-600 p-1 rounded hover:bg-rose-50 transition">
                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                  </button>
                ` : ''}
              </div>
            </div>
            
            <div class="space-y-1.5 bg-slate-50 p-3 rounded-xl border text-slate-700 leading-relaxed text-xs">
              <span class="font-black text-amber-900 block flex items-center gap-1">
                <i data-lucide="sparkles" class="w-3.5 h-3.5 text-amber-600"></i> 핵심 변동사항
              </span>
              <p class="whitespace-pre-line">${escapeHtml(item.changes || '변동사항 미입력')}</p>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-1.5 pt-2 border-t text-[11px]">
            ${item.pdfUrl ? `
              <button type="button" onclick="openBriefingPdfById('${item.id}')" class="flex-1 min-w-[75px] py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg font-bold transition flex items-center justify-center gap-1">
                <i data-lucide="file-text" class="w-3.5 h-3.5"></i> PDF
              </button>
            ` : ''}

            ${item.driveVideoUrl ? `
              <button type="button" onclick="openBriefingDriveById('${item.id}')" class="flex-1 min-w-[85px] py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold transition flex items-center justify-center gap-1 shadow-xs">
                <i data-lucide="hard-drive" class="w-3.5 h-3.5"></i> 드라이브
              </button>
            ` : ''}

            ${item.youtubeUrl ? `
              <button type="button" onclick="openBriefingYoutubeById('${item.id}')" class="flex-1 min-w-[80px] py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-lg font-bold transition flex items-center justify-center gap-1">
                <i data-lucide="video" class="w-3.5 h-3.5"></i> 유튜브
              </button>
            ` : ''}
          </div>
        </div>
      `).join('');

      lucide.createIcons();
    }

    function openNewBriefingFolderModal() {
      document.getElementById('briefingFolderEditId').value = '';
      document.getElementById('briefingFolderModalTitle').innerHTML = '<i data-lucide="folder-plus" class="w-4 h-4 text-amber-600"></i> 새 입학설명회 폴더 생성';
      document.getElementById('briefingFolderName').value = '';
      document.getElementById('briefingFolderDesc').value = '';
      document.getElementById('briefingFolderDriveUrl').value = '';
      document.getElementById('briefingFolderSubmitBtn').innerText = '폴더 생성 완료';
      document.getElementById('briefingFolderModal').classList.remove('hidden');
      lucide.createIcons();
    }

    function openEditBriefingFolderModal(folderId) {
      const folder = currentBriefingFolders.find(f => f.id === folderId);
      if (!folder) return;

      document.getElementById('briefingFolderEditId').value = folder.id;
      document.getElementById('briefingFolderModalTitle').innerHTML = '<i data-lucide="edit-3" class="w-4 h-4 text-amber-600"></i> 설명회 폴더 정보 수정';
      document.getElementById('briefingFolderName').value = folder.name || '';
      document.getElementById('briefingFolderDesc').value = folder.description || '';
      document.getElementById('briefingFolderDriveUrl').value = folder.drive_url || '';
      document.getElementById('briefingFolderSubmitBtn').innerText = '수정사항 저장';
      document.getElementById('briefingFolderModal').classList.remove('hidden');
      lucide.createIcons();
    }

    function closeBriefingFolderModal() {
      document.getElementById('briefingFolderModal').classList.add('hidden');
    }

    async function saveBriefingFolder() {
      const editId = document.getElementById('briefingFolderEditId').value;
      const name = document.getElementById('briefingFolderName').value.trim();
      const desc = document.getElementById('briefingFolderDesc').value.trim();
      const driveUrl = document.getElementById('briefingFolderDriveUrl').value.trim();

      if (!name) return alert('폴더 이름을 입력해주세요.');

      const record = {
        name: name,
        description: desc,
        drive_url: driveUrl
      };

      if (editId) {
        const { error } = await supabaseClient.from('briefing_folders').update(record).eq('id', editId);
        if (error) return alert('수정 실패: ' + error.message);
        alert(`'${name}' 폴더가 성공적으로 수정되었습니다!`);
      } else {
        record.id = 'bf_' + Date.now();
        record.items = [];
        const { error } = await supabaseClient.from('briefing_folders').insert([record]);
        if (error) return alert('생성 실패: ' + error.message);
        selectedBriefingFolderId = record.id;
        alert(`'${name}' 새 설명회 폴더가 DB에 생성되었습니다!`);
      }

      closeBriefingFolderModal();
      loadBriefingFoldersData();
    }

    async function deleteBriefingFolder(folderId) {
      if (!isCurrentTeacher()) return alert('선생님만 삭제할 수 있습니다.');
      const folder = currentBriefingFolders.find(f => f.id === folderId);
      if (!folder) return;
      if (!confirm(`'${folder.name}' 폴더와 안에 담긴 모든 설명회 자료를 삭제할까요?`)) return;

      const { error } = await supabaseClient.from('briefing_folders').delete().eq('id', folderId);
      if (error) return alert('삭제 실패: ' + error.message);

      alert('설명회 폴더가 삭제되었습니다.');
      selectedBriefingFolderId = "";
      loadBriefingFoldersData();
    }

    function openNewBriefingModal() {
      const currentFolder = currentBriefingFolders.find(f => f.id === selectedBriefingFolderId);
      if (!currentFolder) return alert('먼저 설명회 폴더를 생성하거나 선택해주세요.');

      document.getElementById('briefingEditId').value = '';
      document.getElementById('briefingModalTitle').innerHTML = '<i data-lucide="presentation" class="w-4 h-4 text-amber-500"></i> 새 입학설명회 자료 등록';
      document.getElementById('briefingModalFolderLabel').innerText = `대상 폴더: [${currentFolder.name}]`;
      document.getElementById('briefingInputUniv').value = '';
      document.getElementById('briefingInputTitle').value = '2027학년도 대입전형 주요사항';
      document.getElementById('briefingInputChanges').value = '';
      document.getElementById('briefingInputPdf').value = '';
      document.getElementById('briefingInputDriveVideo').value = '';
      document.getElementById('briefingInputYoutube').value = '';
      document.getElementById('briefingSubmitBtn').innerText = '등록 완료';
      document.getElementById('newBriefingModal').classList.remove('hidden');
      lucide.createIcons();
    }

    function openEditBriefingModal(itemId) {
      const currentFolder = currentBriefingFolders.find(f => f.id === selectedBriefingFolderId);
      if (!currentFolder) return;
      const item = currentFolder.items?.find(x => x.id === itemId);
      if (!item) return;

      document.getElementById('briefingEditId').value = item.id;
      document.getElementById('briefingModalTitle').innerHTML = '<i data-lucide="edit-3" class="w-4 h-4 text-amber-500"></i> 입학설명회 자료 수정';
      document.getElementById('briefingModalFolderLabel').innerText = `수정 대상: [${item.univ}]`;
      document.getElementById('briefingInputUniv').value = item.univ || '';
      document.getElementById('briefingInputTitle').value = item.title || '';
      document.getElementById('briefingInputChanges').value = item.changes || '';
      document.getElementById('briefingInputPdf').value = item.pdfUrl || '';
      document.getElementById('briefingInputDriveVideo').value = item.driveVideoUrl || '';
      document.getElementById('briefingInputYoutube').value = item.youtubeUrl || '';
      document.getElementById('briefingSubmitBtn').innerText = '수정사항 저장';
      document.getElementById('newBriefingModal').classList.remove('hidden');
      lucide.createIcons();
    }

    function closeNewBriefingModal() {
      document.getElementById('newBriefingModal').classList.add('hidden');
    }

    async function saveNewBriefing() {
      const currentFolder = currentBriefingFolders.find(f => f.id === selectedBriefingFolderId);
      if (!currentFolder) return alert('설명회 폴더를 찾을 수 없습니다.');

      const editId = document.getElementById('briefingEditId').value;
      const univ = document.getElementById('briefingInputUniv').value.trim();
      const title = document.getElementById('briefingInputTitle').value.trim();
      const changes = document.getElementById('briefingInputChanges').value.trim();
      const pdfUrl = document.getElementById('briefingInputPdf').value.trim();
      const driveVideoUrl = document.getElementById('briefingInputDriveVideo').value.trim();
      const youtubeUrl = document.getElementById('briefingInputYoutube').value.trim();

      if (!univ || !changes) return alert('대학교명과 핵심 변동사항을 입력해주세요.');

      const updatedItems = currentFolder.items ? [...currentFolder.items] : [];

      if (editId) {
        const item = updatedItems.find(x => x.id === editId);
        if (item) {
          item.univ = univ;
          item.title = title;
          item.changes = changes;
          item.pdfUrl = pdfUrl;
          item.driveVideoUrl = driveVideoUrl;
          item.youtubeUrl = youtubeUrl;
        }
      } else {
        updatedItems.unshift({
          id: 'briefing_' + Date.now(),
          univ, title, changes, pdfUrl, driveVideoUrl, youtubeUrl
        });
      }

      const { error } = await supabaseClient
        .from('briefing_folders')
        .update({ items: updatedItems })
        .eq('id', currentFolder.id);

      if (error) return alert('자료 저장 실패: ' + error.message);

      alert(`[${univ}] 설명회 자료가 DB에 안전하게 저장되었습니다!`);
      closeNewBriefingModal();
      loadBriefingFoldersData();
    }

    async function deleteBriefing(id) {
      if (!isCurrentTeacher()) return alert('선생님만 삭제할 수 있습니다.');
      const currentFolder = currentBriefingFolders.find(f => f.id === selectedBriefingFolderId);
      if (!currentFolder) return;
      if (!confirm('이 입학설명회 자료를 삭제할까요?')) return;

      const updatedItems = currentFolder.items.filter(x => x.id !== id);
      const { error } = await supabaseClient
        .from('briefing_folders')
        .update({ items: updatedItems })
        .eq('id', currentFolder.id);

      if (error) return alert('삭제 실패: ' + error.message);

      alert('설명회 자료가 삭제되었습니다.');
      loadBriefingFoldersData();
    }

    function openBriefingPdf(url) {
      if (!url) return alert('등록된 PDF 또는 안내 링크가 없습니다.');
      window.open(url, '_blank');
    }

    function openBriefingVideo(url, univName) {
      if (!url) return alert('등록된 유튜브 영상 링크가 없습니다.');
      const ytId = getYouTubeId(url);
      if (!ytId) return alert('유효한 유튜브 링크 형식이 아닙니다.');

      document.getElementById('ytModalTitle').innerText = `${univName} 공식 영상`;
      document.getElementById('ytIframe').src = `https://www.youtube.com/embed/${ytId}?autoplay=1`;
      document.getElementById('youtubePlayerModal').classList.remove('hidden');
      lucide.createIcons();
    }

    // 💡 초기화 시 3대 화면 데이터 자동 로드 (Supabase DB에서 불러오기)
    function initAdmissionSubPages() {
      loadMockEvalsData();
      loadTeacherForumsData();
      loadBriefingFoldersData();
    }

    
    // =================================================================
    // 💡 초기화 실행
    // =================================================================
    window.addEventListener('DOMContentLoaded', () => {
      checkSession();
      lucide.createIcons();
    });

    // =================================================================
    // 💡 [기능 2] 팝업창(모달) 바깥 배경 클릭 시 자동 닫기 전역 핸들러
    // =================================================================
    window.addEventListener('click', (e) => {
      // 1) [학급 앨범 전용] 사진 확대창(라이트박스) 배경 클릭 시 닫기
      const lbModal = document.getElementById('photoLightboxModal');
      if (lbModal && !lbModal.classList.contains('hidden') && lbModal.contains(e.target)) {
        const isPhoto = (e.target.id === 'lightboxImage'); // 사진 본체 클릭 여부
        const isButton = e.target.closest('button');       // 좌우 넘김 화살표 및 상단 버튼 클릭 여부

        // 사진 본체나 버튼이 아닌 주변의 검은 배경을 눌렀다면 즉시 닫기
        if (!isPhoto && !isButton) {
          closePhotoLightbox();
          return;
        }
      }

      // 2) 일반 팝업 모달 ID 목록
      const allModals = [
        { id: 'examScheduleModal', closeFn: closeExamScheduleModal },
        { id: 'materialUploadModal', closeFn: closeMaterialUploadModal },
        { id: 'studyMaterialUploadModal', closeFn: closeStudyMaterialUploadModal },
        { id: 'mockFolderModal', closeFn: closeMockFolderModal },
        { id: 'newMockEvalModal', closeFn: closeNewMockEvalModal },
        { id: 'forumFolderModal', closeFn: closeTeacherForumFolderModal },
        { id: 'newTeacherForumModal', closeFn: closeNewTeacherForumModal },
        { id: 'briefingFolderModal', closeFn: closeBriefingFolderModal },
        { id: 'newBriefingModal', closeFn: closeNewBriefingModal },
        { id: 'driveVideoModal', closeFn: closeDriveVideoModal },
        { id: 'youtubePlayerModal', closeFn: closeYoutubePlayerModal },
        { id: 'noticeDetailModal', closeFn: closeNoticeDetailModal },
        { id: 'newNoticeModal', closeFn: closeNewNoticeModal },
        { id: 'newEventModal', closeFn: closeNewEventModal },
        { id: 'editUserModal', closeFn: closeEditUserModal },
        { id: 'newFolderModal', closeFn: closeNewFolderModal },
        { id: 'cardDetailModal', closeFn: closeCardDetailModal }
        { id: 'calendarEventDetailModal', closeFn: closeCalendarEventDetail },

      ];

      allModals.forEach(m => {
        const el = document.getElementById(m.id);
        // 모달이 열려있고, 클릭된 대상이 모달 컨테이너(어두운 바깥 배경)인 경우 자동 닫기
        if (el && !el.classList.contains('hidden') && e.target === el) {
          if (m.closeFn) {
            m.closeFn();
          } else {
            el.classList.add('hidden');
          }
        }
      });
    });

    // =================================================================
    // 💡 [기능 3] 입시상담카드 인쇄 엔진 (요약 / 상세 2종 리포트)
    // =================================================================
    async function printCounselCards(mode) {
      let targetUserId = null;
      let targetStudentName = '';
      let targetStudentNo = '';
      let targetClassNum = '';

      if (isCurrentTeacher()) {
        const selVal = pickerSelectedStudentId['counsel'] || document.getElementById('teacherStudentSelect')?.value;
        if (!selVal) {
          return alert('인쇄할 대상 학생을 먼저 위 명단에서 선택해주세요.');
        }
        targetUserId = selVal;
        const studentInfo = allGrade3Students.find(s => s.id === targetUserId);
        targetStudentName = studentInfo?.name || '학생';
        targetStudentNo = studentInfo?.student_no || '';
        targetClassNum = studentInfo?.class_num ? `3학년 ${studentInfo.class_num}반` : '';
      } else {
        if (!currentUser) return alert('로그인 후 이용할 수 있습니다.');
        targetUserId = currentUser.id;
        targetStudentName = currentProfile?.name || '학생';
        targetStudentNo = currentProfile?.student_no || '';
        targetClassNum = currentProfile?.class_num ? `3학년 ${currentProfile.class_num}반` : '';
      }

      // 카드 데이터 불러오기
      const { data: cards, error } = await supabaseClient
        .from('applications_12')
        .select('*')
        .eq('user_id', targetUserId);

      if (error || !cards || cards.length === 0) {
        return alert('등록된 입시상담카드 데이터가 없습니다.');
      }

      const susiList = cards.filter(c => c.slot_type === 'susi');
      const specList = cards.filter(c => c.slot_type === 'special');
      const jeongsiList = cards.filter(c => c.slot_type === 'jeongsi');
      const printDate = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

      // 인쇄용 HTML 빌드
      let printContent = '';

      if (mode === 'summary') {
        // [1] 요약 인쇄 (한눈에 보는 15장 지원 현황표)
        printContent = `
          <div class="print-header">
            <h2>대입 입시상담카드 [지원 요약 리포트]</h2>
            <div class="print-meta">
              <span><b>소속:</b> ${targetClassNum}</span>
              <span><b>학번:</b> ${targetStudentNo}</span>
              <span><b>성명:</b> ${targetStudentName}</span>
              <span><b>출력일:</b> ${printDate}</span>
            </div>
          </div>

          <div class="section-title">1. 일반 4년제 수시 6장 지망 현황</div>
          <table class="report-table">
            <thead>
              <tr>
                <th style="width:50px;">지망</th>
                <th style="width:130px;">대학교</th>
                <th style="width:140px;">모집단위(학과)</th>
                <th>전형명</th>
                <th style="width:110px;">수능최저</th>
                <th style="width:65px;">추천서</th>
                <th style="width:75px;">산출내신</th>
                <th style="width:75px;">진단결과</th>
              </tr>
            </thead>
            <tbody>
              ${[1,2,3,4,5,6].map(num => {
                const c = susiList.find(x => x.slot_num === num) || {};
                const cutVal = (c.cutoffs && c.cutoffs[2]) || (c.cutoffs && c.cutoffs[1]);
                const diag = calculateAdmissionDiag(c.my_score, cutVal);
                return `
                  <tr>
                    <td class="text-center font-bold">${num}지망</td>
                    <td class="font-bold">${escapeHtml(c.university) || '-'}</td>
                    <td>${escapeHtml(c.department) || '-'}</td>
                    <td>${escapeHtml(c.admission_type) || '-'}</td>
                    <td class="text-center font-semibold">${escapeHtml(c.min_criteria) || '-'}</td>
                    <td class="text-center font-bold">${c.recommendation === 'O' ? '<span class="tag-rec">필요(O)</span>' : 'X'}</td>
                    <td class="text-center font-bold text-blue">${c.my_score ? c.my_score + '등급' : '-'}</td>
                    <td class="text-center"><span class="diag-badge diag-${diag.color}">${diag.text}</span></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>

          <div class="section-title" style="margin-top:18px;">2. 특수목적대 / 전문대 6장 지망 현황</div>
          <table class="report-table">
            <thead>
              <tr>
                <th style="width:50px;">지망</th>
                <th style="width:130px;">대학교</th>
                <th style="width:140px;">모집단위(학과)</th>
                <th>전형명</th>
                <th>비고 / 특이사항</th>
                <th style="width:65px;">추천서</th>
                <th style="width:75px;">산출내신</th>
                <th style="width:75px;">진단결과</th>
              </tr>
            </thead>
            <tbody>
              ${[1,2,3,4,5,6].map(num => {
                const c = specList.find(x => x.slot_num === num) || {};
                const cutVal = (c.cutoffs && c.cutoffs[2]) || (c.cutoffs && c.cutoffs[1]);
                const diag = calculateAdmissionDiag(c.my_score, cutVal);
                return `
                  <tr>
                    <td class="text-center font-bold">${num}지망</td>
                    <td class="font-bold">${escapeHtml(c.university) || '-'}</td>
                    <td>${escapeHtml(c.department) || '-'}</td>
                    <td>${escapeHtml(c.admission_type) || '-'}</td>
                    <td>${escapeHtml(c.memo) || '-'}</td>
                    <td class="text-center font-bold">${c.recommendation === 'O' ? '<span class="tag-rec">필요(O)</span>' : 'X'}</td>
                    <td class="text-center font-bold text-purple">${c.my_score ? c.my_score + '등급' : '-'}</td>
                    <td class="text-center"><span class="diag-badge diag-${diag.color}">${diag.text}</span></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>

          <div class="section-title" style="margin-top:18px;">3. 정시 일반 3장 지망 현황 (가 · 나 · 다 군)</div>
          <table class="report-table">
            <thead>
              <tr>
                <th style="width:70px;">군별</th>
                <th style="width:130px;">대학교</th>
                <th style="width:140px;">모집단위(학과)</th>
                <th>전형명</th>
                <th>환산점수 / 비고</th>
                <th style="width:65px;">추천서</th>
                <th style="width:85px;">모평백분위</th>
                <th style="width:75px;">진단결과</th>
              </tr>
            </thead>
            <tbody>
              ${[1,2,3].map(num => {
                const jNames = { 1: '정시 (가군)', 2: '정시 (나군)', 3: '정시 (다군)' };
                const c = jeongsiList.find(x => x.slot_num === num) || {};
                const cutVal = (c.cutoffs && c.cutoffs[2]) || (c.cutoffs && c.cutoffs[1]);
                const diag = calculateJeongsiDiag(c.my_score, cutVal);
                return `
                  <tr>
                    <td class="text-center font-bold text-amber">${jNames[num]}</td>
                    <td class="font-bold">${escapeHtml(c.university) || '-'}</td>
                    <td>${escapeHtml(c.department) || '-'}</td>
                    <td>${escapeHtml(c.admission_type) || '-'}</td>
                    <td>${escapeHtml(c.memo) || '-'}</td>
                    <td class="text-center font-bold">${c.recommendation === 'O' ? '<span class="tag-rec">필요(O)</span>' : 'X'}</td>
                    <td class="text-center font-bold text-indigo">${c.my_score ? c.my_score + '%' : '-'}</td>
                    <td class="text-center"><span class="diag-badge diag-${diag.color}">${diag.text}</span></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        `;
      } else {
        // [2] 상세 인쇄 (3개년 입결/경쟁률/모집인원/산출내신 정밀 리포트)
        printContent = `
          <div class="print-header">
            <h2>대입 입시상담카드 [심층 분석 종합 리포트]</h2>
            <div class="print-meta">
              <span><b>소속:</b> ${targetClassNum}</span>
              <span><b>학번:</b> ${targetStudentNo}</span>
              <span><b>성명:</b> ${targetStudentName}</span>
              <span><b>출력일:</b> ${printDate}</span>
            </div>
          </div>

          <div class="section-title">1. 일반 수시 6장 3개년 심층 분석표</div>
          <table class="report-table detail-table">
            <thead>
              <tr>
                <th rowspan="2" style="width:42px;">지망</th>
                <th rowspan="2" style="width:105px;">대학(모집단위)</th>
                <th rowspan="2" style="width:110px;">전형(최저)</th>
                <th colspan="3">3개년 경쟁률(:1)</th>
                <th colspan="3">3개년 70%컷(등급)</th>
                <th colspan="2">모집인원</th>
                <th rowspan="2" style="width:65px;">산출내신</th>
                <th rowspan="2" style="width:75px;">진단결과</th>
              </tr>
              <tr class="sub-head">
                <th>2년전</th><th>작년</th><th>올해</th>
                <th>2년전</th><th>작년</th><th>최근</th>
                <th>작년</th><th>올해</th>
              </tr>
            </thead>
            <tbody>
              ${[1,2,3,4,5,6].map(num => {
                const c = susiList.find(x => x.slot_num === num) || {};
                const comp = c.comp_rates || [];
                const cuts = c.cutoffs || [];
                const cutVal = cuts[2] || cuts[1];
                const diag = calculateAdmissionDiag(c.my_score, cutVal);
                const recDiff = (c.recruit_curr && c.recruit_last) ? (c.recruit_curr - c.recruit_last) : null;
                const recDiffText = recDiff !== null ? (recDiff > 0 ? `(+${recDiff})` : (recDiff < 0 ? `(${recDiff})` : '(0)')) : '';

                return `
                  <tr>
                    <td class="text-center font-bold">${num}</td>
                    <td><b>${escapeHtml(c.university) || '-'}</b><br><span class="dept-text">${escapeHtml(c.department) || '-'}</span></td>
                    <td>${escapeHtml(c.admission_type) || '-'}<br><span class="min-text">최저: ${escapeHtml(c.min_criteria) || '없음'}</span></td>
                    <td class="text-center">${comp[0] || '-'}</td>
                    <td class="text-center">${comp[1] || '-'}</td>
                    <td class="text-center font-bold text-blue">${comp[2] || '-'}</td>
                    <td class="text-center">${cuts[0] ? cuts[0] + '등급' : '-'}</td>
                    <td class="text-center">${cuts[1] ? cuts[1] + '등급' : '-'}</td>
                    <td class="text-center font-bold text-emerald">${cuts[2] ? cuts[2] + '등급' : '-'}</td>
                    <td class="text-center">${c.recruit_last ? c.recruit_last + '명' : '-'}</td>
                    <td class="text-center font-bold">${c.recruit_curr ? c.recruit_curr + '명' : '-'} <small>${recDiffText}</small></td>
                    <td class="text-center font-bold text-indigo">${c.my_score ? c.my_score + '등급' : '-'}</td>
                    <td class="text-center"><span class="diag-badge diag-${diag.color}">${diag.text}</span><br><small class="text-slate">${diag.diff || ''}</small></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>

          <div class="section-title page-break-before" style="margin-top:20px;">2. 정시 3장 및 특목대 심층 분석표</div>
          <table class="report-table detail-table">
            <thead>
              <tr>
                <th rowspan="2" style="width:65px;">구분</th>
                <th rowspan="2" style="width:105px;">대학(모집단위)</th>
                <th rowspan="2" style="width:110px;">전형(비고)</th>
                <th colspan="3">3개년 경쟁률(:1)</th>
                <th colspan="3">3개년 70% 입결컷</th>
                <th colspan="2">모집인원</th>
                <th rowspan="2" style="width:75px;">내 점수</th>
                <th rowspan="2" style="width:75px;">진단결과</th>
              </tr>
              <tr class="sub-head">
                <th>2년전</th><th>작년</th><th>올해</th>
                <th>2년전</th><th>작년</th><th>최근</th>
                <th>작년</th><th>올해</th>
              </tr>
            </thead>
            <tbody>
              ${[1,2,3].map(num => {
                const jNames = { 1: '정시(가)', 2: '정시(나)', 3: '정시(다)' };
                const c = jeongsiList.find(x => x.slot_num === num) || {};
                const comp = c.comp_rates || [];
                const cuts = c.cutoffs || [];
                const cutVal = cuts[2] || cuts[1];
                const diag = calculateJeongsiDiag(c.my_score, cutVal);
                return `
                  <tr style="background:#fffdfa;">
                    <td class="text-center font-bold text-amber">${jNames[num]}</td>
                    <td><b>${escapeHtml(c.university) || '-'}</b><br><span class="dept-text">${escapeHtml(c.department) || '-'}</span></td>
                    <td>${escapeHtml(c.admission_type) || '-'}<br><span class="min-text">${escapeHtml(c.memo) || '-'}</span></td>
                    <td class="text-center">${comp[0] || '-'}</td>
                    <td class="text-center">${comp[1] || '-'}</td>
                    <td class="text-center font-bold text-amber">${comp[2] || '-'}</td>
                    <td class="text-center">${cuts[0] ? cuts[0] + '%' : '-'}</td>
                    <td class="text-center">${cuts[1] ? cuts[1] + '%' : '-'}</td>
                    <td class="text-center font-bold text-emerald">${cuts[2] ? cuts[2] + '%' : '-'}</td>
                    <td class="text-center">${c.recruit_last ? c.recruit_last + '명' : '-'}</td>
                    <td class="text-center font-bold">${c.recruit_curr ? c.recruit_curr + '명' : '-'}</td>
                    <td class="text-center font-bold text-indigo">${c.my_score ? c.my_score + '%' : '-'}</td>
                    <td class="text-center"><span class="diag-badge diag-${diag.color}">${diag.text}</span><br><small class="text-slate">${diag.diff || ''}</small></td>
                  </tr>
                `;
              }).join('')}
              ${[1,2,3,4,5,6].map(num => {
                const c = specList.find(x => x.slot_num === num) || {};
                const comp = c.comp_rates || [];
                const cuts = c.cutoffs || [];
                const cutVal = cuts[2] || cuts[1];
                const diag = calculateAdmissionDiag(c.my_score, cutVal);
                return `
                  <tr>
                    <td class="text-center font-bold text-purple">특목 ${num}</td>
                    <td><b>${escapeHtml(c.university) || '-'}</b><br><span class="dept-text">${escapeHtml(c.department) || '-'}</span></td>
                    <td>${escapeHtml(c.admission_type) || '-'}<br><span class="min-text">${escapeHtml(c.memo) || '-'}</span></td>
                    <td class="text-center">${comp[0] || '-'}</td>
                    <td class="text-center">${comp[1] || '-'}</td>
                    <td class="text-center font-bold">${comp[2] || '-'}</td>
                    <td class="text-center">${cuts[0] ? cuts[0] + '등급' : '-'}</td>
                    <td class="text-center">${cuts[1] ? cuts[1] + '등급' : '-'}</td>
                    <td class="text-center font-bold text-emerald">${cuts[2] ? cuts[2] + '등급' : '-'}</td>
                    <td class="text-center">${c.recruit_last ? c.recruit_last + '명' : '-'}</td>
                    <td class="text-center font-bold">${c.recruit_curr ? c.recruit_curr + '명' : '-'}</td>
                    <td class="text-center font-bold text-purple">${c.my_score ? c.my_score + '등급' : '-'}</td>
                    <td class="text-center"><span class="diag-badge diag-${diag.color}">${diag.text}</span></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        `;
      }

      // 새 인쇄 창 열기
      const printWindow = window.open('', '_blank', 'width=950,height=900');
      printWindow.document.write(`
        <!DOCTYPE html>
        <html lang="ko">
        <head>
          <meta charset="UTF-8">
          <title>${targetStudentName} 입시상담카드 인쇄</title>
          <style>
            @page { size: A4 portrait; margin: 12mm 10mm; }
            body { font-family: 'Pretendard', sans-serif; font-size: 11px; color: #1e293b; margin: 0; padding: 15px; }
            .print-header { border-bottom: 2px solid #2563eb; padding-bottom: 8px; margin-bottom: 12px; }
            .print-header h2 { margin: 0 0 6px 0; font-size: 18px; color: #1e3a8a; }
            .print-meta { display: flex; gap: 20px; font-size: 12px; color: #475569; }
            .section-title { font-size: 13px; font-weight: bold; color: #1e40af; margin-bottom: 6px; }
            .report-table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 10.5px; }
            .report-table th, .report-table td { border: 1px solid #cbd5e1; padding: 5px 6px; }
            .report-table th { background: #f1f5f9; color: #334155; font-weight: bold; text-align: center; }
            .detail-table .sub-head th { background: #f8fafc; font-size: 9.5px; padding: 3px; }
            .text-center { text-align: center; }
            .font-bold { font-weight: bold; }
            .text-blue { color: #2563eb; }
            .text-purple { color: #7c3aed; }
            .text-amber { color: #d97706; }
            .text-indigo { color: #4338ca; }
            .text-emerald { color: #059669; }
            .text-slate { color: #64748b; font-size: 9px; }
            .tag-rec { background: #fee2e2; color: #dc2626; padding: 1px 4px; border-radius: 3px; font-size: 9px; font-weight: bold; }
            .diag-badge { display: inline-block; padding: 1px 6px; border-radius: 9999px; font-size: 9.5px; font-weight: 800; border: 1px solid transparent; }
            .diag-purple { background: #f3e8ff; color: #7e22ce; border-color: #d8b4fe; }
            .diag-amber { background: #fef3c7; color: #b45309; border-color: #fde68a; }
            .diag-blue { background: #dbeafe; color: #1d4ed8; border-color: #bfdbfe; }
            .diag-emerald { background: #d1fae5; color: #047857; border-color: #a7f3d0; }
            .diag-rose { background: #ffe4e6; color: #be123c; border-color: #fecdd3; }
            .diag-slate { background: #f1f5f9; color: #64748b; }
            .dept-text { color: #475569; font-size: 10px; }
            .min-text { color: #047857; font-size: 9.5px; }
            @media print {
              .page-break-before { page-break-before: always; }
              body { padding: 0; }
            }
          </style>
        </head>
        <body>
          ${printContent}
          <script>
            window.onload = function() {
              window.print();
            };
          </script>
        </body>
        </html>
      `);
      printWindow.document.close();
    }
