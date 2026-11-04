// بيانات مشروع Supabase من ملف config.js
const CFG = window.APP_CONFIG || {};
const $ = (id) => document.getElementById(id);

let db = null;
let currentUser = null;
let profile = null;
let childrenCache = [];

// أدوات مساعدة
function show(id) {
  $(id).classList.remove('hidden');
}

function hide(id) {
  $(id).classList.add('hidden');
}

function msg(id, text) {
  $(id).textContent = text;
}

function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.style.display = 'block';
  setTimeout(() => t.style.display = 'none', 3000);
}

function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[c]);
}

// ترجمة الصلاحيات
function roleLabel(r) {
  return ({
    super_admin: 'إدارة عامة',
    group_admin: 'أمين خدمة',
    servant: 'خادم'
  })[r] || 'حساب';
}

// تشغيل التطبيق
async function init() {
  if (!CFG.url || !CFG.anonKey) {
    show('setupNotice');
    show('authView');
    msg('authMessage', 'التطبيق غير مربوط بقاعدة البيانات بعد. راجع دليل التشغيل.');
    return;
  }

  db = window.supabase.createClient(CFG.url, CFG.anonKey);

  const { data: { session } } = await db.auth.getSession();

  if (session) {
    await loadProfile();
  } else {
    show('authView');
  }

  db.auth.onAuthStateChange((_event, session) => {
    if (session) {
      setTimeout(loadProfile, 0);
    } else {
      showAuth();
    }
  });
}

// إظهار شاشة تسجيل الدخول
function showAuth() {
  hide('appView');
  hide('pendingView');
  show('authView');
  show('logoutBtn');
}

// تحميل بيانات الحساب
async function loadProfile() {
  const { data: { user }, error: userError } = await db.auth.getUser();

  if (userError || !user) {
    toast('تعذر تحديد المستخدم. سجّل الدخول مرة أخرى.');
    return;
  }

  currentUser = user;

  const { data, error } = await db
    .from('profiles')
    .select('full_name,role,status,group_id,groups(name)')
    .eq('id', user.id)
    .single();

  if (error) {
    toast('تعذر تحميل بيانات الحساب: ' + error.message);
    return;
  }

  profile = data;

  hide('authView');
  hide('pendingView');
  hide('appView');

  if (profile.status !== 'approved') {
    show('pendingView');
    show('logoutBtn');
    return;
  }

  show('appView');
  show('logoutBtn');

  $('userName').textContent = profile.full_name || 'خادم';
  $('userRole').textContent = roleLabel(profile.role);
  $('groupName').textContent = profile.groups?.name || 'الإدارة العامة';

  console.log('بدأ تحميل المجموعات');

  await loadChildren();

  console.log('انتهى تحميل المجموعات');

  await loadAudit();
}

// عرض الأطفال
function renderChildren(list) {
  const container = $('childrenList');

  if (!list || list.length === 0) {
    container.innerHTML =
      '<p class="muted">لا يوجد أطفال مسجلون حتى الآن.</p>';
    return;
  }

  container.innerHTML = list.map(child => `
    <div class="item">
      <div>
        <strong>${escapeHtml(child.full_name)}</strong>
        <small>${escapeHtml(child.school_grade || 'غير محدد')}</small>
      </div>
    </div>
  `).join('');
}

// تحميل المجموعات والأطفال
async function loadChildren() {
  const groupSelect = $('childGroup');

  groupSelect.innerHTML =
    '<option value="">جاري تحميل المجموعات...</option>';

  const { data: groups, error: groupsError } = await db
    .from('groups')
    .select('id,name')
    .order('name');

  if (groupsError) {
    groupSelect.innerHTML =
      '<option value="">فشل تحميل المجموعات</option>';

    msg('childMessage', 'خطأ تحميل المجموعات: ' + groupsError.message);
    return;
  }

  if (!groups || groups.length === 0) {
    groupSelect.innerHTML =
      '<option value="">لم يتم العثور على مجموعات</option>';

    msg('childMessage', 'لم يتم العثور على مجموعات.');
    return;
  }

  groupSelect.innerHTML =
    '<option value="">اختر المجموعة</option>' +
    groups.map(g =>
      `<option value="${g.id}">${escapeHtml(g.name)}</option>`
    ).join('');

  msg('childMessage', 'تم تحميل ' + groups.length + ' مجموعات بنجاح.');

  const { data, error } = await db
    .from('children')
    .select('id,full_name,school_grade,group_id')
    .order('full_name');

  if (error) {
    $('childrenList').innerHTML =
      '<p class="muted">لا يمكن تحميل القائمة: ' +
      escapeHtml(error.message) +
      '</p>';

    return;
  }

  childrenCache = data || [];

  renderChildren(childrenCache);

  $('attendanceChild').innerHTML =
    '<option value="">اختر الطفل</option>' +
    childrenCache.map(c =>
      `<option value="${c.id}">${escapeHtml(c.full_name)}</option>`
    ).join('');
}

// سجل التعديلات
async function loadAudit() {
  const { data, error } = await db
    .from('audit_logs')
    .select('id,action,table_name,created_at,actor_name')
    .order('created_at', { ascending: false })
    .limit(50);

  $('auditList').innerHTML = error
    ? '<p class="muted">سجل التعديلات غير متاح لهذا الدور.</p>'
    : (data || []).map(x => `
        <div class="item">
          <div>
            <strong>
              ${escapeHtml(x.action)} · ${escapeHtml(x.table_name)}
            </strong>
            <small>
              ${escapeHtml(x.actor_name || 'مستخدم')}
              — ${new Date(x.created_at).toLocaleString('ar-EG')}
            </small>
          </div>
        </div>
      `).join('') || '<p class="muted">لا توجد تعديلات مسجلة.</p>';
}

// تسجيل الدخول
$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();

  if (!db) return;

  msg('authMessage', 'جاري تسجيل الدخول...');

  const { error } = await db.auth.signInWithPassword({
    email: $('loginEmail').value,
    password: $('loginPassword').value
  });

  msg(
    'authMessage',
    error ? error.message : 'تم تسجيل الدخول.'
  );
});

// إنشاء حساب جديد
$('signupForm').addEventListener('submit', async e => {
  e.preventDefault();

  if (!db) return;

  msg('authMessage', 'جاري إرسال الطلب...');

  const groupName = $('signupGroup').value;

  const { error } = await db.auth.signUp({
    email: $('signupEmail').value,
    password: $('signupPassword').value,
    options: {
      data: {
        full_name: $('signupName').value,
        requested_group: groupName
      }
    }
  });

  msg(
    'authMessage',
    error
      ? error.message
      : 'تم إرسال طلب التسجيل. راجع بريدك إن طُلب تأكيد الحساب، ثم انتظر اعتماد أمين الخدمة.'
  );
});

// التبديل بين الدخول والتسجيل
document.querySelectorAll('.tab').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x =>
      x.classList.remove('active')
    );

    b.classList.add('active');

    const signup = b.dataset.tab === 'signup';

    $('loginForm').classList.toggle('hidden', signup);
    $('signupForm').classList.toggle('hidden', !signup);

    msg('authMessage', '');
  });
});

// تسجيل الخروج
$('logoutBtn').addEventListener('click', async () => {
  if (db) await db.auth.signOut();
  showAuth();
});

$('pendingLogout').addEventListener('click', async () => {
  await db.auth.signOut();
  showAuth();
});

// التنقل بين صفحات التطبيق
document.querySelectorAll('.navbtn').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.navbtn').forEach(x =>
      x.classList.remove('active')
    );

    b.classList.add('active');

    ['children', 'attendance', 'activity'].forEach(p => {
      $(p + 'Page').classList.toggle(
        'hidden',
        p !== b.dataset.page
      );
    });
  });
});

// البحث عن طفل
$('childSearch').addEventListener('input', e => {
  const searchText = e.target.value.trim().toLowerCase();

  const filtered = childrenCache.filter(c =>
    c.full_name.toLowerCase().includes(searchText)
  );

  renderChildren(filtered);
});

// فتح نافذة إضافة طفل
$('addChildBtn').addEventListener('click', () => {
  if (profile.role === 'servant') {
    toast('إضافة الأطفال متاحة لأمين المجموعة والإدارة فقط.');
    return;
  }

  $('childDialog').showModal();
});

// إغلاق نافذة إضافة طفل
$('closeDialog').addEventListener('click', () => {
  $('childDialog').close();
});

// حفظ طفل جديد
$('childForm').addEventListener('submit', async e => {
  e.preventDefault();

  if (!db) return;

  const groupId = $('childGroup').value;

  if (!groupId) {
    msg('childMessage', 'من فضلك اختر المجموعة أولاً.');
    return;
  }

  const row = {
    full_name: $('childFullName').value.trim(),
    date_of_birth: $('childDob').value || null,
    guardian_name: $('guardianName').value.trim() || null,
    guardian_phone: $('guardianPhone').value.trim() || null,
    school_grade: $('schoolGrade').value.trim() || null,
    notes: $('childNotes').value.trim() || null,
    group_id: groupId
  };

  msg('childMessage', 'جاري حفظ البيانات...');

  const { error } = await db
    .from('children')
    .insert(row);

  if (error) {
    msg('childMessage', 'تعذر الحفظ: ' + error.message);
    return;
  }

  $('childForm').reset();
  $('childDialog').close();

  await loadChildren();

  toast('تم حفظ بيانات الطفل بنجاح.');
});

// تسجيل الحضور
$('attendanceForm').addEventListener('submit', async e => {
  e.preventDefault();

  if (!db) return;

  const childId = $('attendanceChild').value;

  if (!childId) {
    msg('attendanceMessage', 'من فضلك اختر الطفل أولاً.');
    return;
  }

  const selectedChild = childrenCache.find(c => c.id === childId);

  if (!selectedChild) {
    msg('attendanceMessage', 'تعذر العثور على بيانات الطفل.');
    return;
  }

  const row = {
    child_id: childId,
    attendance_date: new Date().toISOString().slice(0, 10),
    status: $('attendanceStatus').value,
    note: $('attendanceNote').value.trim() || null,
    group_id: selectedChild.group_id
  };

  const { error } = await db
    .from('attendance')
    .upsert(row, {
      onConflict: 'child_id,attendance_date'
    });

  msg(
    'attendanceMessage',
    error
      ? 'تعذر حفظ الحضور: ' + error.message
      : 'تم حفظ الحضور بنجاح.'
  );

  if (!error) {
    $('attendanceNote').value = '';
  }
});

// تشغيل التطبيق دون اتصال مؤقتًا
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .catch(error => console.log('Service Worker:', error));
  });
}

// بدء التشغيل
init();
