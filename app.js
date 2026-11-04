// ضع بيانات مشروع Supabase في ملف config.js بعد اتباع دليل التشغيل.
const CFG = window.APP_CONFIG || {};
const $ = (id) => document.getElementById(id);
let db = null, currentUser = null, profile = null, childrenCache = [];

function show(id){$(id).classList.remove('hidden')}
function hide(id){$(id).classList.add('hidden')}
function msg(id,text){$(id).textContent=text}
function toast(text){const t=$('toast');t.textContent=text;t.style.display='block';setTimeout(()=>t.style.display='none',3000)}
function escapeHtml(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

async function init(){
  if(!CFG.url || !CFG.anonKey){show('setupNotice');show('authView');msg('authMessage','التطبيق غير مربوط بقاعدة البيانات بعد. راجع دليل التشغيل.');return}
  db=window.supabase.createClient(CFG.url,CFG.anonKey);
  const {data:{session}}=await db.auth.getSession();
  if(session) await loadProfile();
  else show('authView');
  db.auth.onAuthStateChange((_event,session)=>{if(session) setTimeout(loadProfile,0);else showAuth()});
}
function showAuth(){hide('appView');hide('pendingView');show('authView');show('logoutBtn')}
async function loadProfile(){
  const {data:{user}}=await db.auth.getUser();currentUser=user;
  const {data,error}=await db.from('profiles').select('full_name,role,status,group_id,groups(name)').eq('id',user.id).single();
  if(error){toast('تعذر تحميل بيانات الحساب: '+error.message);return}
  profile=data;hide('authView');hide('pendingView');hide('appView');
  if(profile.status!=='approved'){show('pendingView');show('logoutBtn');return}
  show('appView');show('logoutBtn');
  $('userName').textContent=profile.full_name||'خادم';
  $('userRole').textContent=roleLabel(profile.role);
  $('groupName').textContent=profile.groups?.name||'الإدارة العامة';
  await loadChildren();await loadAudit();
}
async function loadChildren(){
  const groupSelect = $('childGroup');

  groupSelect.innerHTML = '<option value="">جاري تحميل المجموعات...</option>';

  const {data:groups,error:groupsError}=await db
    .from('groups')
    .select('id,name')
    .order('name');

  if(groupsError){
    groupSelect.innerHTML = '<option value="">فشل تحميل المجموعات</option>';
    msg('childMessage','خطأ تحميل المجموعات: '+groupsError.message);
    return;
  }

  if(!groups || groups.length === 0){
    groupSelect.innerHTML = '<option value="">لم يتم العثور على مجموعات</option>';
    msg('childMessage','تم الاتصال بقاعدة البيانات لكن لم تصل أي مجموعات.');
    return;
  }

  groupSelect.innerHTML =
    '<option value="">اختر المجموعة</option>' +
    groups.map(g =>
      `<option value="${g.id}">${escapeHtml(g.name)}</option>`
    ).join('');

  msg('childMessage','تم تحميل '+groups.length+' مجموعات بنجاح.');

  const {data,error}=await db
    .from('children')
    .select('id,full_name,school_grade')
    .order('full_name');

  if(error){
    $('childrenList').innerHTML='<p class="muted">لا يمكن تحميل القائمة: '+escapeHtml(error.message)+'</p>';
    return;
  }

  childrenCache=data||[];
  renderChildren(childrenCache);

  $('attendanceChild').innerHTML=childrenCache.map(c =>
    `<option value="${c.id}">${escapeHtml(c.full_name)}</option>`
  ).join('');
}
async function loadAudit(){
  const {data,error}=await db.from('audit_logs').select('id,action,table_name,created_at,actor_name').order('created_at',{ascending:false}).limit(50);
  $('auditList').innerHTML=error?'<p class="muted">سجل التعديلات غير متاح لهذا الدور.</p>':(data||[]).map(x=>`<div class="item"><div><strong>${escapeHtml(x.action)} · ${escapeHtml(x.table_name)}</strong><small>${escapeHtml(x.actor_name||'مستخدم')} — ${new Date(x.created_at).toLocaleString('ar-EG')}</small></div></div>`).join('')||'<p class="muted">لا توجد تعديلات مسجلة.</p>';
}
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();if(!db)return;msg('authMessage','جاري تسجيل الدخول...');const {error}=await db.auth.signInWithPassword({email:$('loginEmail').value,password:$('loginPassword').value});msg('authMessage',error?error.message:'تم تسجيل الدخول.')});
$('signupForm').addEventListener('submit',async e=>{e.preventDefault();if(!db)return;msg('authMessage','جاري إرسال الطلب...');const groupName=$('signupGroup').value;const {data,error}=await db.auth.signUp({email:$('signupEmail').value,password:$('signupPassword').value,options:{data:{full_name:$('signupName').value,requested_group:groupName}}});msg('authMessage',error?error.message:'تم إرسال طلب التسجيل. راجع بريدك إن طُلب تأكيد الحساب، ثم انتظر اعتماد أمين الخدمة.')});
document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');const signup=b.dataset.tab==='signup';$('loginForm').classList.toggle('hidden',signup);$('signupForm').classList.toggle('hidden',!signup);msg('authMessage','')}));
$('logoutBtn').addEventListener('click',async()=>{if(db)await db.auth.signOut();showAuth()});$('pendingLogout').addEventListener('click',async()=>{await db.auth.signOut();showAuth()});
document.querySelectorAll('.navbtn').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.navbtn').forEach(x=>x.classList.remove('active'));b.classList.add('active');['children','attendance','activity'].forEach(p=>$(p+'Page').classList.toggle('hidden',p!==b.dataset.page))}));
$('childSearch').addEventListener('input',e=>renderChildren(childrenCache.filter(c=>c.full_name.toLowerCase().includes(e.target.value.trim().toLowerCase()))));
$('addChildBtn').addEventListener('click',()=>{if(profile.role==='servant'){toast('إضافة الأطفال متاحة لأمين المجموعة والإدارة فقط.');return}$('childDialog').showModal()});
$('closeDialog').addEventListener('click',()=>$('childDialog').close());
$('childForm').addEventListener('submit',async e=>{e.preventDefault();const row={full_name:$('childFullName').value.trim(),date_of_birth:$('childDob').value||null,guardian_name:$('guardianName').value.trim()||null,guardian_phone:$('guardianPhone').value.trim()||null,school_grade:$('schoolGrade').value.trim()||null,notes:$('childNotes').value.trim()||null,group_id:$('childGroup').value};const {error}=await db.from('children').insert(row);if(error){msg('childMessage',error.message);return}$('childForm').reset();$('childDialog').close();await loadChildren();toast('تم حفظ بيانات الطفل')});
$('attendanceForm').addEventListener('submit',async e=>{e.preventDefault();const {error}=await db.from('attendance').upsert({child_id:$('attendanceChild').value,attendance_date:new Date().toISOString().slice(0,10),status:$('attendanceStatus').value,note:$('attendanceNote').value.trim()||null,group_id:profile.group_id},{onConflict:'child_id,attendance_date'});msg('attendanceMessage',error?error.message:'تم حفظ الحضور بنجاح.');if(!error)$('attendanceNote').value=''});
if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
init();
