// ═══════════════════════════════════════════════════════════════
// SBD ITN SYSTEM — ICF-SL  |  app.js  v2.0
// All users loaded from users.csv · QR codes validated against registry
// Supervisor role can scan any user QR and view full dossier (cross-tab)
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════
const CONFIG = {
  SCRIPT_URL: 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec',
  CSV_FILE:   'cascading_data.csv',
  USERS_CSV:  'users.csv'
};

// ═══════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════
let S = {
  role: null,
  user: null,
  currentDispatch: {},
  activeScanner: null,
  supViewUser: null,   // user being viewed in supervisor profile
};

let LOCATION_DATA = {};
let USERS = {};           // loaded from users.csv
let USERS_LOADED = false;
let distFormStep = 1;
let distFormData = {};

// ─── STORAGE ───
function ls(k,v){if(v===undefined){try{return JSON.parse(localStorage.getItem(k)||'null')}catch{return null}}localStorage.setItem(k,JSON.stringify(v))}
function loadState(k,def){return ls(k)||def;}
function saveState(k,v){ls(k,v);}

// ─── DATA STORES ───
let districtStock = loadState('itn_dstock',{pbo:2000,ig2:1500,ledger:[]});
let phuStock      = loadState('itn_pstock',{pbo:0,ig2:0,ledger:[]});
let dispatches    = loadState('itn_dispatches',[]);
let phuDispatches = loadState('itn_phu_dispatches',[]);
let distributions = loadState('itn_distributions',{});

// ─── FALLBACK DEMO USERS (used if CSV not found) ───
const FALLBACK_USERS = {
  dhmt1:   {pass:'1234',role:'dhmt',name:'Mohamed Koroma',district:'Kono District',phone:'076111111',qr_code:'DHMT-dhmt1',title:'DHMT Officer',assigned_dhmt:'',assigned_phu:'',target_itn:0},
  phu1:    {pass:'1234',role:'phu',name:'Mariama Conteh',facility:'Koidu Govt Hospital',district:'Kono District',phone:'077222222',qr_code:'PHU-phu1',title:'PHU In-charge',assigned_dhmt:'dhmt1',assigned_phu:'',target_itn:0},
  driver1: {pass:'1234',role:'driver',name:'Ibrahim Kamara',vehicle:'SLE-KNO-1234',phone:'078333333',district:'Kono District',qr_code:'DRV-driver1',title:'Transport Driver',assigned_dhmt:'dhmt1',assigned_phu:'phu1',target_itn:0},
  dist1:   {pass:'1234',role:'distributor',name:'Aminata Turay',phone:'079444444',district:'Kono District',qr_code:'DIST-dist1',title:'Field Distributor',assigned_dhmt:'',assigned_phu:'phu1',target_itn:500},
  dist2:   {pass:'1234',role:'distributor',name:'Sorie Bangura',phone:'078555555',district:'Kono District',qr_code:'DIST-dist2',title:'Field Distributor',assigned_dhmt:'',assigned_phu:'phu1',target_itn:400},
  sup1:    {pass:'1234',role:'supervisor',name:'Fatmata Sesay',phone:'075777777',district:'National',qr_code:'SUP-sup1',title:'M&E Supervisor',assigned_dhmt:'',assigned_phu:'',target_itn:0}
};

// ═══════════════════════════════════════════
// USER LOADING FROM CSV
// ═══════════════════════════════════════════
function loadUserData(){
  return new Promise((resolve)=>{
    if(typeof Papa==='undefined'){USERS=FALLBACK_USERS;USERS_LOADED=true;resolve();return;}
    Papa.parse(CONFIG.USERS_CSV,{
      download:true, header:true, skipEmptyLines:true,
      complete(results){
        const loaded={};
        results.data.forEach(row=>{
          const u=(row.username||'').trim();
          if(!u) return;
          loaded[u]={
            pass:        (row.password||'').trim(),
            role:        (row.role||'').trim(),
            name:        (row.name||'').trim(),
            phone:       (row.phone||'').trim(),
            district:    (row.district||'').trim(),
            facility:    (row.facility||'').trim(),
            vehicle:     (row.vehicle||'').trim(),
            qr_code:     (row.qr_code||'').trim(),
            assigned_dhmt:(row.assigned_dhmt||'').trim(),
            assigned_phu: (row.assigned_phu||'').trim(),
            target_itn:   parseInt(row.target_itn)||0,
            title:        (row.title||'').trim()
          };
        });
        USERS = Object.keys(loaded).length>0 ? loaded : FALLBACK_USERS;
        USERS_LOADED=true;
        resolve();
      },
      error:()=>{USERS=FALLBACK_USERS;USERS_LOADED=true;resolve();}
    });
  });
}

// Build QR payload for a user
function userQRPayload(username){
  const u=USERS[username];
  if(!u) return '';
  return JSON.stringify({u:username,c:u.qr_code,n:u.name,r:u.role,p:u.phone});
}

// Validate a scanned QR — returns user object or null
function validateQR(txt){
  let parsed;
  try{parsed=JSON.parse(txt);}catch{
    // legacy plain-code format fallback
    const match=Object.values(USERS).find(u=>u.qr_code===txt.trim());
    return match?{...match,_username:Object.keys(USERS).find(k=>USERS[k]===match)}:null;
  }
  if(!parsed.u||!parsed.c) return null;
  const user=USERS[parsed.u];
  if(!user||user.qr_code!==parsed.c) return null;
  return {...user,_username:parsed.u};
}

// ═══════════════════════════════════════════
// LOCATION DATA (CSV — distributor form)
// ═══════════════════════════════════════════
function loadLocationData(){
  return new Promise((resolve,reject)=>{
    if(typeof Papa==='undefined'){resolve();return;}
    Papa.parse(CONFIG.CSV_FILE,{
      download:true,header:true,skipEmptyLines:true,
      complete(results){
        LOCATION_DATA={};
        results.data.forEach(row=>{
          const dist=(row.adm1||'').trim(),chf=(row.adm2||'').trim(),
                sec=(row.adm3||'').trim(),fac=(row.hf||'').trim(),
                com=(row.community||'').trim(),sch=(row.school_name||'').trim();
          if(!dist) return;
          if(!LOCATION_DATA[dist]) LOCATION_DATA[dist]={};
          if(!LOCATION_DATA[dist][chf]) LOCATION_DATA[dist][chf]={};
          if(!LOCATION_DATA[dist][chf][sec]) LOCATION_DATA[dist][chf][sec]={};
          if(!LOCATION_DATA[dist][chf][sec][fac]) LOCATION_DATA[dist][chf][sec][fac]={};
          if(com&&!LOCATION_DATA[dist][chf][sec][fac][com]) LOCATION_DATA[dist][chf][sec][fac][com]=[];
          if(com&&sch&&!LOCATION_DATA[dist][chf][sec][fac][com].includes(sch))
            LOCATION_DATA[dist][chf][sec][fac][com].push(sch);
        });
        resolve();
      },
      error:reject
    });
  });
}

function populateDistCascade(){
  const sel=document.getElementById('ds-district');
  if(!sel) return;
  sel.innerHTML='<option value="">Select District...</option>';
  Object.keys(LOCATION_DATA).sort().forEach(d=>{
    const o=document.createElement('option');o.value=d;o.textContent=d;sel.appendChild(o);
  });
}

function setupDistCascade(){
  const fields=['ds-district','ds-chiefdom','ds-section','ds-facility','ds-community','ds-school'];
  const ids=   ['district','chiefdom','section','facility','community','school_name'];
  const labels=['Select Chiefdom...','Select Section...','Select Health Facility...','Select Community...','Select School...'];
  function resetFrom(fromIdx){
    for(let i=fromIdx;i<fields.length;i++){
      const el=document.getElementById(fields[i]); if(!el) continue;
      el.innerHTML=`<option value="">${i===0?'Select District...':labels[i-1]}</option>`;
      el.disabled=(i>0);
      const cnt=document.getElementById('cnt-'+ids[i]); if(cnt) cnt.textContent='';
    }
  }
  document.getElementById('ds-district')?.addEventListener('change',function(){
    resetFrom(1); const d=this.value; if(!d||!LOCATION_DATA[d]) return;
    const chf=document.getElementById('ds-chiefdom'); chf.disabled=false;
    Object.keys(LOCATION_DATA[d]).sort().forEach(c=>{const o=document.createElement('option');o.value=c;o.textContent=c;chf.appendChild(o);});
    const cnt=document.getElementById('cnt-chiefdom'); if(cnt) cnt.textContent=Object.keys(LOCATION_DATA[d]).length+' options';
    distFormData.district=d;
  });
  document.getElementById('ds-chiefdom')?.addEventListener('change',function(){
    resetFrom(2); const d=document.getElementById('ds-district').value,c=this.value;
    if(!d||!c||!LOCATION_DATA[d]?.[c]) return;
    const sec=document.getElementById('ds-section'); sec.disabled=false;
    Object.keys(LOCATION_DATA[d][c]).sort().forEach(s=>{const o=document.createElement('option');o.value=s;o.textContent=s;sec.appendChild(o);});
    const cnt=document.getElementById('cnt-section'); if(cnt) cnt.textContent=Object.keys(LOCATION_DATA[d][c]).length+' options';
    distFormData.chiefdom=c;
  });
  document.getElementById('ds-section')?.addEventListener('change',function(){
    resetFrom(3); const d=document.getElementById('ds-district').value,c=document.getElementById('ds-chiefdom').value,s=this.value;
    if(!d||!c||!s||!LOCATION_DATA[d]?.[c]?.[s]) return;
    const fac=document.getElementById('ds-facility'); fac.disabled=false;
    Object.keys(LOCATION_DATA[d][c][s]).sort().forEach(f=>{const o=document.createElement('option');o.value=f;o.textContent=f;fac.appendChild(o);});
    const cnt=document.getElementById('cnt-facility'); if(cnt) cnt.textContent=Object.keys(LOCATION_DATA[d][c][s]).length+' options';
    distFormData.section=s;
  });
  document.getElementById('ds-facility')?.addEventListener('change',function(){
    resetFrom(4); const d=document.getElementById('ds-district').value,c=document.getElementById('ds-chiefdom').value,
          s=document.getElementById('ds-section').value,f=this.value;
    if(!d||!c||!s||!f||!LOCATION_DATA[d]?.[c]?.[s]?.[f]) return;
    const com=document.getElementById('ds-community'); com.disabled=false;
    Object.keys(LOCATION_DATA[d][c][s][f]).sort().forEach(co=>{const o=document.createElement('option');o.value=co;o.textContent=co;com.appendChild(o);});
    const cnt=document.getElementById('cnt-community'); if(cnt) cnt.textContent=Object.keys(LOCATION_DATA[d][c][s][f]).length+' options';
    distFormData.facility=f;
  });
  document.getElementById('ds-community')?.addEventListener('change',function(){
    resetFrom(5); const d=document.getElementById('ds-district').value,c=document.getElementById('ds-chiefdom').value,
          s=document.getElementById('ds-section').value,f=document.getElementById('ds-facility').value,co=this.value;
    if(!d||!c||!s||!f||!co||!LOCATION_DATA[d]?.[c]?.[s]?.[f]?.[co]) return;
    const sch=document.getElementById('ds-school'); sch.disabled=false;
    LOCATION_DATA[d][c][s][f][co].forEach(school=>{const o=document.createElement('option');o.value=school;o.textContent=school;sch.appendChild(o);});
    const cnt=document.getElementById('cnt-school_name'); if(cnt) cnt.textContent=LOCATION_DATA[d][c][s][f][co].length+' options';
    distFormData.community=co;
  });
  document.getElementById('ds-school')?.addEventListener('change',function(){distFormData.schoolName=this.value;});
}

// ═══════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════
function showScreen(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  const el=document.getElementById(id);
  if(el){el.classList.add('active');window.scrollTo(0,0);}
  if(id==='scr-dhmt')          refreshDHMTDash();
  if(id==='scr-dhmt-records')  renderDHMTRecords();
  if(id==='scr-dhmt-stock')    renderDistrictStock();
  if(id==='scr-phu')           refreshPHUDash();
  if(id==='scr-phu-dispatch')  refreshPHUDispatch();
  if(id==='scr-phu-return')    refreshPHUReturn();
  if(id==='scr-phu-stock')     renderPHUStock();
  if(id==='scr-distributor')   refreshDistDash();
  if(id==='scr-dist-schools')  renderDistSchools();
  if(id==='scr-dist-summary')  renderDistSummary();
  if(id==='scr-driver')        refreshDriverDash();
  if(id==='scr-supervisor')    refreshSupDash();
  if(id==='scr-sup-users')     renderSupUsers();
}

// ═══════════════════════════════════════════
// LOGIN / LOGOUT
// ═══════════════════════════════════════════
let selectedRole=null;
function selectRole(r){
  selectedRole=r;
  document.querySelectorAll('.role-btn').forEach(b=>b.classList.toggle('selected',b.dataset.role===r));
}

function doLogin(){
  const u=document.getElementById('loginUser').value.trim();
  const p=document.getElementById('loginPass').value.trim();
  if(!u||!p){showErr('Please enter credentials.');return;}
  if(!USERS_LOADED){showErr('System still loading — please wait.');return;}
  const usr=USERS[u];
  if(!usr||usr.pass!==p){showErr('Invalid username or password.');return;}
  if(selectedRole&&usr.role!==selectedRole){showErr('Role mismatch. Registered as: '+usr.role.toUpperCase());return;}
  document.getElementById('splErr').classList.remove('show');
  S.role=usr.role; S.user={...usr,username:u};
  initRole();
}
function showErr(m){const e=document.getElementById('splErr');if(e){e.textContent=m;e.classList.add('show');}}
function doLogout(){S.role=null;S.user=null;stopAllQR();const pi=document.getElementById('loginPass');if(pi)pi.value='';showScreen('splash');}

document.addEventListener('DOMContentLoaded',()=>{
  // ✅ FIX: Set fallback users IMMEDIATELY so login always works
  // CSV loading is non-blocking — it upgrades USERS in the background
  USERS = {...FALLBACK_USERS};
  USERS_LOADED = true;

  const pi=document.getElementById('loginPass');
  const ui=document.getElementById('loginUser');
  if(pi) pi.addEventListener('keydown',e=>{if(e.key==='Enter')doLogin();});
  if(ui) ui.addEventListener('keydown',e=>{if(e.key==='Enter')pi?.focus();});
  setupDistCascade();
  setupDistGPS();
  setupDistSignature();

  // Load users.csv silently in background — upgrades login if found
  loadUserData().catch(()=>{});

  // Load location cascade CSV silently in background
  loadLocationData().then(()=>{
    populateDistCascade();
  }).catch(()=>{});
});

function initRole(){
  const u=S.user;
  const phuList=Object.entries(USERS).filter(([,v])=>v.role==='phu');

  if(u.role==='dhmt'){
    setEl('dhmt-user-sub',u.name+' · '+u.district);
    setEl('dhmt-name',u.name); setEl('dhmt-loc',u.district);
    setEl('dhmt-avatar',initials(u.name));
    // populate PHUs assigned to this DHMT
    const myPHUs=phuList.filter(([,v])=>v.assigned_dhmt===u.username);
    const allPHUs=myPHUs.length>0?myPHUs:phuList;
    const sel=document.getElementById('dp-dest');
    if(sel){sel.innerHTML='<option value="">— Select PHU —</option>';allPHUs.forEach(([,v])=>{const o=document.createElement('option');o.value=v.facility;o.textContent=v.facility+' ('+v.district+')';sel.appendChild(o);});}
    const off=document.getElementById('dp-officer'); if(off) off.value=u.name;
    setNow('dp-date','dp-time');
    showScreen('scr-dhmt');

  } else if(u.role==='phu'){
    setEl('phu-user-sub',u.name+' · '+u.facility);
    setEl('phu-name',u.name); setEl('phu-facility',u.facility);
    setEl('phu-avatar',initials(u.name));
    // populate distributors assigned to this PHU
    const myDists=Object.entries(USERS).filter(([,v])=>v.role==='distributor'&&v.assigned_phu===u.username);
    const allDists=myDists.length>0?myDists:Object.entries(USERS).filter(([,v])=>v.role==='distributor');
    ['phud-dist','ret-dist-sel'].forEach(sid=>{
      const sel=document.getElementById(sid); if(!sel) return;
      sel.innerHTML='<option value="">— Select —</option>';
      allDists.forEach(([k,v])=>{const o=document.createElement('option');o.value=k;o.textContent=v.name;sel.appendChild(o);});
    });
    showScreen('scr-phu');

  } else if(u.role==='driver'){
    setEl('driver-user-sub',u.name+' · '+u.vehicle);
    setEl('driver-name',u.name);
    setEl('driver-vehicle','Vehicle: '+u.vehicle);
    setEl('driver-qr-name',u.name);
    setEl('driver-qr-title',u.title||'Transport Driver');
    setEl('driver-qr-district',u.district);
    renderDriverQR();
    showScreen('scr-driver');

  } else if(u.role==='distributor'){
    setEl('dist-user-sub',u.name);
    setEl('dist-name',u.name);
    setEl('dist-area',u.district);
    showScreen('scr-distributor');

  } else if(u.role==='supervisor'){
    setEl('sup-user-sub',u.name+' · '+u.district);
    setEl('sup-name',u.name);
    setEl('sup-title',u.title||'Supervisor');
    setEl('sup-avatar',initials(u.name));
    showScreen('scr-supervisor');
  }
}

// ═══════════════════════════════════════════
// DRIVER QR CODE GENERATION
// ═══════════════════════════════════════════
function renderDriverQR(){
  const container=document.getElementById('driver-qr-canvas');
  if(!container) return;
  container.innerHTML='';
  const payload=userQRPayload(S.user.username);
  if(typeof QRCode!=='undefined'){
    new QRCode(container,{
      text:payload,
      width:180,height:180,
      colorDark:'#004080',colorLight:'#f0f4ff',
      correctLevel:QRCode.CorrectLevel.M
    });
  } else {
    // Fallback: show code text if QR library not loaded
    container.innerHTML=`<div style="font-family:'Oswald',sans-serif;font-size:28px;font-weight:700;color:var(--navy);letter-spacing:3px;padding:20px;">${S.user.qr_code}</div>`;
  }
}

// ═══════════════════════════════════════════
// QR SCANNER ENGINE
// ═══════════════════════════════════════════
let scanners={};
function startQR(elementId,callbackName){
  stopAllQR();
  showQRUI(elementId,true);
  if(typeof Html5Qrcode==='undefined'){notif('QR scanner not loaded','error');return;}
  const scanner=new Html5Qrcode(elementId);
  scanners[elementId]=scanner;
  scanner.start(
    {facingMode:'environment'},{fps:10,qrbox:{width:200,height:200}},
    (decoded)=>{
      scanner.stop().catch(()=>{});
      showQRUI(elementId,false);
      delete scanners[elementId];
      if(window[callbackName]) window[callbackName](decoded);
    },
    ()=>{}
  ).catch(err=>{showQRUI(elementId,false);notif('Camera error: '+err,'error');});
}
function stopQR(elementId){
  if(scanners[elementId]){scanners[elementId].stop().catch(()=>{});delete scanners[elementId];}
  showQRUI(elementId,false);
}
function stopAllQR(){Object.keys(scanners).forEach(k=>stopQR(k));}
function showQRUI(id,show){
  const map={
    'qr-reader':  {wrap:'dp-scanner-wrap',stop:'dp-stop-btn',overlay:'dp-scan-overlay'},
    'qr-reader2': {wrap:'recv-scanner-wrap',stop:'recv-stop-btn',overlay:'recv-scan-overlay'},
    'qr-reader3': {wrap:'phud-scanner-wrap',stop:'phud-stop-btn',scan:'phud-scan-btn'},
    'qr-reader4': {},
    'qr-sup':     {wrap:'sup-scanner-wrap',stop:'sup-stop-btn',overlay:'sup-scan-overlay'}
  };
  const m=map[id]; if(!m) return;
  if(m.wrap)    setVis(m.wrap,show);
  if(m.stop)    setVis(m.stop,show);
  if(m.overlay) setVis(m.overlay,!show);
  if(m.scan)    setVis(m.scan,!show);
}
function setVis(id,v){const e=document.getElementById(id);if(e)e.style.display=v?'block':'none';}

// ═══════════════════════════════════════════
// DHMT — DISPATCH FLOW
// ═══════════════════════════════════════════
function calcDpTotal(){
  const p=parseInt(document.getElementById('dp-pbo')?.value)||0;
  const g=parseInt(document.getElementById('dp-ig2')?.value)||0;
  setEl('dp-total',(p+g).toLocaleString());
}

function dpNext1(){
  const dest=document.getElementById('dp-dest')?.value;
  const pbo=parseInt(document.getElementById('dp-pbo')?.value)||0;
  const ig2=parseInt(document.getElementById('dp-ig2')?.value)||0;
  const vehicle=document.getElementById('dp-vehicle')?.value.trim();
  const driver=document.getElementById('dp-driver')?.value.trim();
  const driverTel=document.getElementById('dp-driver-tel')?.value.trim();
  if(!dest){notif('Select a destination PHU','error');return;}
  if(pbo+ig2===0){notif('Enter ITN quantities','error');return;}
  if(!vehicle||!driver||!driverTel){notif('Fill vehicle and driver details','error');return;}
  const errEl=document.getElementById('err-dp-stock');
  if(pbo>districtStock.pbo){if(errEl){errEl.textContent='Insufficient PBO stock (available: '+districtStock.pbo+')';errEl.style.display='block';}return;}
  if(ig2>districtStock.ig2){if(errEl){errEl.textContent='Insufficient IG2 stock (available: '+districtStock.ig2+')';errEl.style.display='block';}return;}
  if(errEl) errEl.style.display='none';
  S.currentDispatch={dest,pbo,ig2,total:pbo+ig2,vehicle,driver,driverTel,officer:S.user.name,officerUser:S.user.username,date:new Date().toISOString()};
  setVis('dp-step1',false);setVis('dp-step2',true);setStepState(2);
  setEl('dr-dest-display',dest);setEl('dr-pbo-display',pbo);
  setEl('dr-ig2-display',ig2);setEl('dr-total-display',(pbo+ig2)+' ITNs');
}
function dpBack1(){setVis('dp-step2',false);setVis('dp-step3',false);setVis('dp-step1',true);setStepState(1);}
function dpBack2(){setVis('dp-step3',false);setVis('dp-step2',true);setStepState(2);}

function setStepState(active){
  for(let i=1;i<=4;i++){
    const el=document.getElementById('dstep'+i); if(!el) continue;
    el.classList.remove('cur','done');
    if(i<active) el.classList.add('done');
    else if(i===active) el.classList.add('cur');
  }
}

window.onDriverScan=function(txt){
  const user=validateQR(txt);
  if(!user||user.role!=='driver'){notif('QR code not recognized as a registered driver','error');setVis('dp-scan-overlay',true);return;}
  S.currentDispatch.driverCode=user.qr_code;
  S.currentDispatch.driverScanned=user.name;
  S.currentDispatch.driverUsername=user._username;
  setEl('dr-name-display',user.name);
  setEl('dr-phone-display',user.phone||'—');
  setVis('dp-driver-info',true);
  notif('Driver '+user.name+' verified ✓','success');
};

function driverConsent(agreed){
  S.currentDispatch.driverAgreed=agreed;
  setVis('dp-step2',false);setVis('dp-step3',true);setStepState(3);
  const agreeEl=document.getElementById('dp-consent-agree');
  const disagreeEl=document.getElementById('dp-consent-disagree');
  if(agreed){
    if(agreeEl) agreeEl.style.display='block';
    if(disagreeEl) disagreeEl.style.display='none';
    const d=S.currentDispatch;
    const sumEl=document.getElementById('dp-final-summary');
    if(sumEl) sumEl.innerHTML=`
      <div class="summ-item"><span class="summ-k">Dispatch ID</span><span class="summ-v">${genID('DSP')}</span></div>
      <div class="summ-item"><span class="summ-k">Destination</span><span class="summ-v">${d.dest}</span></div>
      <div class="summ-item"><span class="summ-k">PBO ITNs</span><span class="summ-v">${d.pbo}</span></div>
      <div class="summ-item"><span class="summ-k">IG2 ITNs</span><span class="summ-v">${d.ig2}</span></div>
      <div class="summ-item"><span class="summ-k">Total</span><span class="summ-v" style="font-size:18px;color:var(--navy);">${d.total} ITNs</span></div>
      <div class="summ-item"><span class="summ-k">Driver</span><span class="summ-v">${d.driverScanned}</span></div>
      <div class="summ-item"><span class="summ-k">Vehicle</span><span class="summ-v">${d.vehicle}</span></div>
      <div class="summ-item" style="border:none;"><span class="summ-k">Time</span><span class="summ-v">${fmtDateTime(new Date())}</span></div>
    `;
  } else {
    if(agreeEl) agreeEl.style.display='none';
    if(disagreeEl) disagreeEl.style.display='block';
  }
}

function finalizeDispatch(){
  const btn=document.getElementById('dp-finalize-btn');
  if(btn){btn.disabled=true;btn.innerHTML='<div class="spinner"></div> SUBMITTING...';}
  setTimeout(()=>{
    const d=S.currentDispatch;
    const id=genID('DSP');
    dispatches.push({id,dest:d.dest,pbo:d.pbo,ig2:d.ig2,total:d.total,vehicle:d.vehicle,
      driver:d.driverScanned,driverCode:d.driverCode,driverUsername:d.driverUsername||'',
      driverTel:d.driverTel,officer:d.officer,officerUser:d.officerUser||'',
      date:d.date,status:'dispatched',driverAgreed:true});
    saveState('itn_dispatches',dispatches);
    districtStock.pbo-=d.pbo;districtStock.ig2-=d.ig2;
    districtStock.ledger.push({type:'out',reason:'Dispatched '+id+' to '+d.dest,pbo:-d.pbo,ig2:-d.ig2,date:new Date().toISOString()});
    saveState('itn_dstock',districtStock);
    setVis('dp-step3',false);setVis('dp-step4',true);setStepState(4);
    setEl('dp-success-msg',id+' dispatched to '+d.dest+' — '+d.total+' ITNs');
    const detail=document.getElementById('dp-success-detail');
    if(detail) detail.innerHTML=`
      <div class="summ-item"><span class="summ-k">Dispatch ID</span><span class="summ-v">${id}</span></div>
      <div class="summ-item"><span class="summ-k">Destination</span><span class="summ-v">${d.dest}</span></div>
      <div class="summ-item"><span class="summ-k">PBO</span><span class="summ-v">${d.pbo}</span></div>
      <div class="summ-item"><span class="summ-k">IG2</span><span class="summ-v">${d.ig2}</span></div>
      <div class="summ-item"><span class="summ-k">Total</span><span class="summ-v">${d.total}</span></div>
      <div class="summ-item" style="border:none;"><span class="summ-k">Stock Remaining</span><span class="summ-v">${districtStock.pbo+districtStock.ig2} ITNs</span></div>
    `;
    notif('Dispatch '+id+' submitted!','success');
    S.currentDispatch={};
    resetDispatchForm();
    if(btn){btn.disabled=false;btn.innerHTML='<svg viewBox="0 0 24 24" style="width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:2;"><polyline points="20 6 9 17 4 12"/></svg>CONFIRM & DISPATCH';}
  },800);
}

function resetDispatchForm(){
  ['dp-pbo','dp-ig2','dp-vehicle','dp-driver','dp-driver-tel'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
  const destEl=document.getElementById('dp-dest'); if(destEl) destEl.value='';
  setEl('dp-total','0');
  setVis('dp-driver-info',false);
  setVis('dp-step2',false);setVis('dp-step3',false);
  setNow('dp-date','dp-time');
}

function refreshDHMTDash(){
  const total=dispatches.length;
  const recv=dispatches.filter(d=>d.status==='received').length;
  const inTransit=dispatches.filter(d=>d.status==='dispatched').length;
  setEl('dStat1',total);setEl('dStat2',recv);setEl('dStat3',inTransit);
  setEl('dStat4',(districtStock.pbo+districtStock.ig2).toLocaleString());
  setEl('dhmt-records-sub',total+' total · '+inTransit+' in transit');
}

function renderDHMTRecords(){
  const el=document.getElementById('dhmt-records-content'); if(!el) return;
  if(!dispatches.length){el.innerHTML='<div style="text-align:center;padding:40px;color:var(--gray-d);font-size:13px;">No dispatches yet</div>';return;}
  el.innerHTML=dispatches.slice().reverse().map(d=>`
    <div class="dispatch-card ${d.status}">
      <div class="dc-top"><div class="dc-id">${d.id}</div><span class="pill ${d.status==='received'?'green':d.status==='shortage'?'red':'orange'}">${d.status.toUpperCase()}</span></div>
      <div class="dc-meta">${d.dest} · ${fmtDateTime(new Date(d.date))}</div>
      <div class="dc-meta">${d.vehicle} · ${d.driver}</div>
      <div class="dc-qty"><span class="pill navy">PBO:${d.pbo}</span><span class="pill teal">IG2:${d.ig2}</span><span class="pill gold">Total:${d.total}</span>${d.receivedTotal!==undefined?`<span class="pill ${d.receivedTotal===d.total?'green':'red'}">Recv:${d.receivedTotal}</span>`:''}</div>
    </div>
  `).join('');
}

function renderDistrictStock(){
  setEl('dst-pbo',districtStock.pbo.toLocaleString());
  setEl('dst-ig2',districtStock.ig2.toLocaleString());
  setEl('dst-total',(districtStock.pbo+districtStock.ig2).toLocaleString());
  const ledger=document.getElementById('stock-ledger'); if(!ledger) return;
  if(!districtStock.ledger.length){ledger.innerHTML='<div style="text-align:center;color:var(--gray-d);font-size:13px;padding:20px 0;">No transactions yet</div>';return;}
  ledger.innerHTML=districtStock.ledger.slice().reverse().map(t=>`
    <div class="summ-item">
      <span class="summ-k">${fmtDateTime(new Date(t.date))} — ${t.reason}</span>
      <span class="summ-v" style="color:${t.pbo<0?'var(--red)':'var(--green)'};">${t.pbo>0?'+':''}${t.pbo} PBO / ${t.ig2>0?'+':''}${t.ig2} IG2</span>
    </div>
  `).join('');
}

function addDistrictStock(){
  const pbo=parseInt(document.getElementById('add-pbo')?.value)||0;
  const ig2=parseInt(document.getElementById('add-ig2')?.value)||0;
  const src=document.getElementById('add-source')?.value.trim()||'Manual entry';
  if(pbo+ig2===0){notif('Enter quantities to add','error');return;}
  districtStock.pbo+=pbo;districtStock.ig2+=ig2;
  districtStock.ledger.push({type:'in',reason:src,pbo,ig2,date:new Date().toISOString()});
  saveState('itn_dstock',districtStock);
  ['add-pbo','add-ig2','add-source'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
  renderDistrictStock();
  notif('Stock updated: +'+pbo+' PBO, +'+ig2+' IG2','success');
}

// ═══════════════════════════════════════════
// PHU — RECEIVE FROM DHMT
// ═══════════════════════════════════════════
let currentRecvDispatch=null;

window.onDriverScanRecv=function(txt){
  const user=validateQR(txt);
  if(!user||user.role!=='driver'){notif('Not a registered driver QR code','error');setVis('recv-scan-overlay',true);return;}
  const myFacility=S.user.facility;
  let match=dispatches.find(dp=>dp.status==='dispatched'&&dp.dest===myFacility&&(dp.driverCode===user.qr_code||dp.driverUsername===user._username));
  if(!match) match=dispatches.find(dp=>dp.status==='dispatched'&&dp.dest===myFacility);
  if(!match){notif('No active dispatch found for '+user.name+' to this PHU','error');setVis('recv-scan-overlay',true);return;}
  currentRecvDispatch=match;
  const sumEl=document.getElementById('recv-dispatch-summary');
  if(sumEl) sumEl.innerHTML=`
    <div class="summ-item"><span class="summ-k">Dispatch ID</span><span class="summ-v">${match.id}</span></div>
    <div class="summ-item"><span class="summ-k">Driver</span><span class="summ-v">${user.name}</span></div>
    <div class="summ-item"><span class="summ-k">Vehicle</span><span class="summ-v">${match.vehicle}</span></div>
    <div class="summ-item"><span class="summ-k">Dispatched</span><span class="summ-v">${fmtDateTime(new Date(match.date))}</span></div>
    <div class="summ-item"><span class="summ-k">PBO Expected</span><span class="summ-v">${match.pbo}</span></div>
    <div class="summ-item"><span class="summ-k">IG2 Expected</span><span class="summ-v">${match.ig2}</span></div>
    <div class="summ-item" style="border:none;"><span class="summ-k">Total Expected</span><span class="summ-v" style="font-size:18px;color:var(--navy);">${match.total}</span></div>
  `;
  setVis('recv-dispatch-info',true);
  notif('Dispatch '+match.id+' loaded — driver verified ✓','info');
};

function checkRecvMatch(){
  if(!currentRecvDispatch) return;
  const rpbo=parseInt(document.getElementById('recv-pbo')?.value)||0;
  const rig2=parseInt(document.getElementById('recv-ig2')?.value)||0;
  const box=document.getElementById('recv-match-box');
  const btn=document.getElementById('recv-confirm-btn');
  const shortage=document.getElementById('recv-shortage-section');
  if(!box) return;
  box.style.display='block';
  if(rpbo===currentRecvDispatch.pbo&&rig2===currentRecvDispatch.ig2){
    box.style.background='var(--green-l)';box.style.border='2px solid var(--green)';box.style.color='var(--green-d)';
    box.textContent='✓ Quantities match! PBO:'+rpbo+' · IG2:'+rig2;
    if(btn) btn.disabled=false;
    if(shortage) shortage.style.display='none';
  } else {
    const spbo=currentRecvDispatch.pbo-rpbo,sig2=currentRecvDispatch.ig2-rig2;
    box.style.background='var(--red-l)';box.style.border='2px solid var(--red)';box.style.color='var(--red-d)';
    box.textContent='Mismatch! Expected PBO:'+currentRecvDispatch.pbo+'/IG2:'+currentRecvDispatch.ig2+' | Shortage:'+(spbo>0?spbo+' PBO ':'')+(sig2>0?sig2+' IG2':'');
    if(btn) btn.disabled=true;
    if(shortage) shortage.style.display='block';
  }
}

function scanDriverForShortage(){notif('Scan driver ID for shortage acknowledgment','info');startQR('qr-reader2','onDriverShortageAck');}

window.onDriverShortageAck=function(txt){
  const rpbo=parseInt(document.getElementById('recv-pbo')?.value)||0;
  const rig2=parseInt(document.getElementById('recv-ig2')?.value)||0;
  const note=document.getElementById('recv-shortage-note')?.value;
  const accts=loadState('itn_acct',[]);
  accts.push({type:'driver_shortage',dispatchId:currentRecvDispatch.id,expected:currentRecvDispatch.total,received:rpbo+rig2,shortage:(currentRecvDispatch.pbo-rpbo)+(currentRecvDispatch.ig2-rig2),driver:currentRecvDispatch.driver,note,date:new Date().toISOString()});
  saveState('itn_acct',accts);
  const btn=document.getElementById('recv-confirm-btn');if(btn)btn.disabled=false;
  notif('Driver acknowledged shortage — recorded','warn');
};

function confirmPHUReceipt(){
  const rpbo=parseInt(document.getElementById('recv-pbo')?.value)||0;
  const rig2=parseInt(document.getElementById('recv-ig2')?.value)||0;
  const btn=document.getElementById('recv-confirm-btn');
  if(btn){btn.disabled=true;btn.innerHTML='<div class="spinner"></div> CONFIRMING...';}
  setTimeout(()=>{
    const idx=dispatches.findIndex(d=>d.id===currentRecvDispatch.id);
    if(idx>=0){dispatches[idx].status=rpbo+rig2<currentRecvDispatch.total?'shortage':'received';dispatches[idx].receivedTotal=rpbo+rig2;dispatches[idx].receivedDate=new Date().toISOString();dispatches[idx].phuUser=S.user.username;}
    saveState('itn_dispatches',dispatches);
    phuStock.pbo+=rpbo;phuStock.ig2+=rig2;
    phuStock.ledger.push({type:'in',reason:'Received '+currentRecvDispatch.id+' from DHMT',pbo:rpbo,ig2:rig2,date:new Date().toISOString(),phuUser:S.user.username});
    saveState('itn_pstock',phuStock);
    notif('Receipt confirmed! Stock updated.','success');
    currentRecvDispatch=null;
    setVis('recv-dispatch-info',false);
    setVis('recv-match-box',false);
    setVis('recv-shortage-section',false);
    ['recv-pbo','recv-ig2'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
    if(btn){btn.disabled=false;btn.innerHTML='<svg viewBox="0 0 24 24" style="width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:2;"><polyline points="20 6 9 17 4 12"/></svg>CONFIRM RECEIPT';}
    showScreen('scr-phu');
  },700);
}

// ═══════════════════════════════════════════
// PHU — DISPATCH TO DISTRIBUTOR
// ═══════════════════════════════════════════
function refreshPHUDispatch(){
  setEl('phud-pbo-avail',phuStock.pbo);
  setEl('phud-ig2-avail',phuStock.ig2);
}

function loadDistributorSchools(){
  const key=document.getElementById('phud-dist')?.value;
  const block=document.getElementById('phud-schools-block');
  if(!key){if(block)block.style.display='none';return;}
  const usr=USERS[key]; if(!usr){if(block)block.style.display='none';return;}
  if(block) block.style.display='block';
  const distData=distributions[key];
  const totalDist=distData?.schools?.reduce((s,sc)=>s+sc.totalITN,0)||0;
  const schoolsList=document.getElementById('phud-schools-list');
  if(schoolsList){
    if(!distData?.schools?.length){
      schoolsList.innerHTML='<div style="color:var(--gray-d);font-size:12px;padding:8px 0;">No distribution records yet.</div>';
    } else {
      schoolsList.innerHTML=distData.schools.map(s=>`<div class="school-item"><div class="si-top"><span class="si-name">${s.name}</span><span class="pill green">${s.totalITN} ITNs</span></div></div>`).join('');
    }
  }
  const needEl=document.getElementById('phud-auto-need'); if(needEl) needEl.textContent=totalDist+' ITNs distributed';
  const target=usr.target_itn||0;
  const pct=target>0?Math.round(totalDist/target*100):0;
  const tEl=document.getElementById('phud-target-info');
  if(tEl) tEl.innerHTML=target?`<span class="pill ${pct>=100?'green':pct>=50?'gold':'red'}">Target: ${totalDist}/${target} (${pct}%)</span>`:'';
  const proceedBtn=document.getElementById('phud-proceed-btn');
  if(proceedBtn){proceedBtn.dataset.distKey=key;proceedBtn.dataset.need=9999;}
}

function checkPHUDQty(){
  const pbo=parseInt(document.getElementById('phud-pbo')?.value)||0;
  const ig2=parseInt(document.getElementById('phud-ig2')?.value)||0;
  const warn=document.getElementById('phud-qty-warn');
  const btn=document.getElementById('phud-proceed-btn');
  if(warn) warn.style.display='none';
  if(pbo>phuStock.pbo){if(warn){warn.textContent='Insufficient PBO (available: '+phuStock.pbo+')';warn.style.display='block';}if(btn)btn.disabled=true;return;}
  if(ig2>phuStock.ig2){if(warn){warn.textContent='Insufficient IG2 (available: '+phuStock.ig2+')';warn.style.display='block';}if(btn)btn.disabled=true;return;}
  if(btn) btn.disabled=(pbo+ig2===0);
}

function proceedToDistConsent(){
  const pbo=parseInt(document.getElementById('phud-pbo')?.value)||0;
  const ig2=parseInt(document.getElementById('phud-ig2')?.value)||0;
  if(pbo+ig2===0){notif('Enter quantities','error');return;}
  setVis('phud-consent-section',true);
  setVis('phud-proceed-btn',false);
  S.currentDispatch={distKey:document.getElementById('phud-proceed-btn')?.dataset.distKey,pbo,ig2,total:pbo+ig2};
}

window.onDistributorConsentScan=function(txt){
  const user=validateQR(txt);
  const key=S.currentDispatch.distKey;
  const usr=USERS[key];
  if(!user||user.role!=='distributor'||user._username!==key){
    notif('QR code does not match selected distributor','error');
    return;
  }
  const recId=genID('PHD');
  const record={id:recId,distKey:key,distName:usr?.name||key,phu:S.user.facility,phuUser:S.user.username,
    pbo:S.currentDispatch.pbo,ig2:S.currentDispatch.ig2,total:S.currentDispatch.total,
    consentCode:user.qr_code,date:new Date().toISOString(),status:'dispatched',returned:false};
  phuDispatches.push(record);
  saveState('itn_phu_dispatches',phuDispatches);
  phuStock.pbo-=S.currentDispatch.pbo;phuStock.ig2-=S.currentDispatch.ig2;
  phuStock.ledger.push({type:'out',reason:'Dispatched '+recId+' to '+(usr?.name||key),pbo:-S.currentDispatch.pbo,ig2:-S.currentDispatch.ig2,date:new Date().toISOString()});
  saveState('itn_pstock',phuStock);
  notif('Dispatched '+S.currentDispatch.total+' ITNs to '+(usr?.name||key),'success');
  setVis('phud-consent-section',false);
  setVis('phud-proceed-btn',true);
  const distSel=document.getElementById('phud-dist');if(distSel)distSel.value='';
  setVis('phud-schools-block',false);
  ['phud-pbo','phud-ig2'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
  S.currentDispatch={};
  showScreen('scr-phu');
};

function refreshPHUDash(){
  setEl('pStat1',phuStock.pbo);setEl('pStat2',phuStock.ig2);
  const dispatched=phuDispatches.filter(d=>!d.returned).reduce((s,d)=>s+d.total,0);
  const distributed=Object.values(distributions).reduce((s,d)=>s+(d.schools||[]).reduce((a,sc)=>a+sc.totalITN,0),0);
  setEl('pStat3',dispatched);setEl('pStat4',distributed);
}

// ═══════════════════════════════════════════
// PHU — RETURNS
// ═══════════════════════════════════════════
function refreshPHUReturn(){
  const sel=document.getElementById('ret-dist-sel'); if(!sel) return;
  sel.innerHTML='<option value="">— Select —</option>';
  Object.entries(USERS).filter(([,v])=>v.role==='distributor').forEach(([k,v])=>{
    const o=document.createElement('option');o.value=k;o.textContent=v.name;sel.appendChild(o);
  });
}

function loadReturnInfo(){
  const key=document.getElementById('ret-dist-sel')?.value;
  const block=document.getElementById('ret-info-block');
  if(!key){if(block)block.style.display='none';return;}
  const disp=phuDispatches.find(d=>d.distKey===key&&!d.returned);
  if(!disp){
    if(block){block.innerHTML='<div class="alert warn"><svg viewBox="0 0 24 24" fill="none" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/></svg><div class="alert-txt"><strong>NO ACTIVE DISPATCH</strong><span>No outstanding dispatch for this distributor.</span></div></div>';block.style.display='block';}
    return;
  }
  if(block) block.style.display='block';
  const distData=distributions[key];
  const totalDist=distData?.schools?.reduce((s,sc)=>s+sc.totalITN,0)||0;
  const expectedReturn=disp.total-totalDist;
  S.currentDispatch={retDispatch:disp,expectedReturn,totalDist,key};
  const box=document.getElementById('ret-reconcile-box');
  if(box) box.innerHTML=`
    <div class="card" style="background:var(--navy-l);border:2px solid var(--navy);margin-bottom:12px;">
      <div class="card-body" style="padding:12px 16px;">
        <div class="summ-item"><span class="summ-k">Given to Distributor</span><span class="summ-v">${disp.total}</span></div>
        <div class="summ-item"><span class="summ-k">Distributed at Schools</span><span class="summ-v">${totalDist}</span></div>
        <div class="summ-item" style="border:none;"><span class="summ-k">Expected Return</span><span class="summ-v" style="font-size:18px;color:var(--navy);font-weight:700;">${expectedReturn}</span></div>
      </div>
    </div>
  `;
  ['ret-pbo','ret-ig2'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
  setVis('ret-match-box',false);setVis('ret-shortage-section',false);
  const btn=document.getElementById('ret-confirm-btn');if(btn)btn.disabled=true;
}

function checkReturnMatch(){
  if(!S.currentDispatch.retDispatch) return;
  const rpbo=parseInt(document.getElementById('ret-pbo')?.value)||0;
  const rig2=parseInt(document.getElementById('ret-ig2')?.value)||0;
  const actual=rpbo+rig2,expected=S.currentDispatch.expectedReturn;
  const box=document.getElementById('ret-match-box');
  const btn=document.getElementById('ret-confirm-btn');
  const shortage=document.getElementById('ret-shortage-section');
  if(!box) return;
  box.style.display='block';
  if(actual===expected){
    box.style.background='var(--green-l)';box.style.border='2px solid var(--green)';box.style.color='var(--green-d)';
    box.textContent='✓ Return matches expected ('+expected+' ITNs)';
    if(btn) btn.disabled=false;
    if(shortage) shortage.style.display='none';
  } else {
    box.style.background='var(--red-l)';box.style.border='2px solid var(--red)';box.style.color='var(--red-d)';
    box.textContent='Mismatch! Expected:'+expected+' | Actual:'+actual+' | Diff:'+(expected-actual);
    if(btn) btn.disabled=true;
    if(shortage) shortage.style.display='block';
    const acctEl=document.getElementById('ret-acct-details');
    if(acctEl) acctEl.innerHTML=`
      <div class="acct-row"><span class="ak">Distributor</span><span class="av">${USERS[S.currentDispatch.key]?.name||'—'}</span></div>
      <div class="acct-row"><span class="ak">Given</span><span class="av">${S.currentDispatch.retDispatch.total}</span></div>
      <div class="acct-row"><span class="ak">Distributed</span><span class="av">${S.currentDispatch.totalDist}</span></div>
      <div class="acct-row"><span class="ak">Expected Return</span><span class="av">${expected}</span></div>
      <div class="acct-row"><span class="ak">Actual Return</span><span class="av">${actual}</span></div>
      <div class="acct-row"><span class="ak" style="color:var(--red-d);font-weight:700;">Shortage</span><span class="av" style="color:var(--red-d);">${expected-actual} ITNs</span></div>
    `;
  }
}

function scanDistForReturnShortage(){notif('Scan distributor ID for accountability acknowledgment','info');startQR('qr-reader4','onDistReturnShortageAck');}

window.onDistReturnShortageAck=function(txt){
  const rpbo=parseInt(document.getElementById('ret-pbo')?.value)||0;
  const rig2=parseInt(document.getElementById('ret-ig2')?.value)||0;
  const note=document.getElementById('ret-shortage-note')?.value;
  const accts=loadState('itn_acct',[]);
  accts.push({type:'dist_return_shortage',distKey:S.currentDispatch.key,distName:USERS[S.currentDispatch.key]?.name,expected:S.currentDispatch.expectedReturn,actual:rpbo+rig2,shortage:S.currentDispatch.expectedReturn-(rpbo+rig2),note,date:new Date().toISOString()});
  saveState('itn_acct',accts);
  const btn=document.getElementById('ret-confirm-btn');if(btn)btn.disabled=false;
  notif('Distributor acknowledged shortage','warn');
};

function confirmReturn(){
  const rpbo=parseInt(document.getElementById('ret-pbo')?.value)||0;
  const rig2=parseInt(document.getElementById('ret-ig2')?.value)||0;
  const btn=document.getElementById('ret-confirm-btn');
  if(btn){btn.disabled=true;btn.innerHTML='<div class="spinner"></div> PROCESSING...';}
  setTimeout(()=>{
    const idx=phuDispatches.findIndex(d=>d.id===S.currentDispatch.retDispatch.id);
    if(idx>=0){Object.assign(phuDispatches[idx],{returned:true,returnedPBO:rpbo,returnedIG2:rig2,returnedTotal:rpbo+rig2,returnDate:new Date().toISOString()});}
    saveState('itn_phu_dispatches',phuDispatches);
    phuStock.pbo+=rpbo;phuStock.ig2+=rig2;
    phuStock.ledger.push({type:'in',reason:'Return from '+(USERS[S.currentDispatch.key]?.name||S.currentDispatch.key),pbo:rpbo,ig2:rig2,date:new Date().toISOString()});
    saveState('itn_pstock',phuStock);
    notif('Return confirmed! '+(rpbo+rig2)+' ITNs added to PHU stock.','success');
    S.currentDispatch={};
    const retSel=document.getElementById('ret-dist-sel');if(retSel)retSel.value='';
    setVis('ret-info-block',false);
    if(btn){btn.disabled=false;btn.innerHTML='<svg viewBox="0 0 24 24" style="width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:2;"><polyline points="20 6 9 17 4 12"/></svg>CONFIRM RETURN & UPDATE STOCK';}
    showScreen('scr-phu');
  },700);
}

function renderPHUStock(){
  setEl('phu-ledger-pbo',phuStock.pbo);setEl('phu-ledger-ig2',phuStock.ig2);
  setEl('phu-ledger-total',phuStock.pbo+phuStock.ig2);
  const el=document.getElementById('phu-stock-ledger-content'); if(!el) return;
  if(!phuStock.ledger.length){el.innerHTML='<div style="text-align:center;color:var(--gray-d);font-size:13px;padding:20px 0;">No transactions yet</div>';return;}
  el.innerHTML=phuStock.ledger.slice().reverse().map(t=>`
    <div class="summ-item">
      <span class="summ-k">${fmtDateTime(new Date(t.date))} — ${t.reason}</span>
      <span class="summ-v" style="color:${t.pbo<0?'var(--red)':'var(--green)'};">${t.pbo>0?'+':''}${t.pbo}PBO / ${t.ig2>0?'+':''}${t.ig2}IG2</span>
    </div>
  `).join('');
}

// ═══════════════════════════════════════════
// DRIVER DASHBOARD
// ═══════════════════════════════════════════
function refreshDriverDash(){
  const myDispatches=dispatches.filter(d=>d.driverCode===S.user.qr_code||d.driverUsername===S.user.username||d.driver===S.user.name);
  const el=document.getElementById('driver-dispatches'); if(!el) return;
  if(!myDispatches.length){el.innerHTML='<div style="text-align:center;color:var(--gray-d);font-size:13px;padding:20px 0;">No dispatches assigned</div>';return;}
  el.innerHTML=myDispatches.slice().reverse().map(d=>`
    <div class="dispatch-card ${d.status}" style="margin-bottom:10px;">
      <div class="dc-top"><div class="dc-id">${d.id}</div><span class="pill ${d.status==='received'?'green':d.status==='shortage'?'red':'orange'}">${d.status.toUpperCase()}</span></div>
      <div class="dc-meta">${d.dest} · ${fmtDateTime(new Date(d.date))}</div>
      <div class="dc-qty"><span class="pill navy">PBO:${d.pbo}</span><span class="pill teal">IG2:${d.ig2}</span><span class="pill gold">Total:${d.total}</span></div>
    </div>
  `).join('');
}

// ═══════════════════════════════════════════
// DISTRIBUTOR — CSV-BASED SCHOOL FORM
// ═══════════════════════════════════════════
function refreshDistDash(){
  const key=S.user.username;
  const disp=phuDispatches.find(d=>d.distKey===key&&!d.returned);
  const given=disp?.total||0;
  const distData=distributions[key];
  const distributed=(distData?.schools||[]).reduce((s,sc)=>s+sc.totalITN,0);
  const remaining=given-distributed;
  const target=S.user.target_itn||0;
  const coverage=given>0?Math.round(distributed/given*100):0;
  const targetPct=target>0?Math.round(distributed/target*100):0;
  setEl('di-stat1',given);setEl('di-stat2',distributed);
  setEl('di-stat3',Math.max(0,remaining));setEl('di-stat4',coverage+'%');
  if(target>0){
    const tEl=document.getElementById('di-target-bar-wrap');
    if(tEl){
      tEl.style.display='block';
      const bar=document.getElementById('di-target-bar');
      if(bar){bar.style.width=Math.min(100,targetPct)+'%';bar.style.background=targetPct>=100?'var(--green)':targetPct>=50?'var(--gold)':'var(--red)';}
      setEl('di-target-label',distributed+'/'+target+' ITNs ('+targetPct+'% of target)');
    }
  }
}

function renderDistSchools(){
  const key=S.user.username;
  const disp=phuDispatches.find(d=>d.distKey===key&&!d.returned);
  const el=document.getElementById('dist-schools-content'); if(!el) return;
  const distData=distributions[key]||{schools:[]};
  let html='';
  html+=`<button class="add-school-btn" onclick="openAddSchoolForm()">
    <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
    ADD NEW SCHOOL
  </button>`;
  if(!disp){
    html+=`<div class="alert warn"><svg viewBox="0 0 24 24" fill="none" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/></svg><div class="alert-txt"><strong>NO ITNs ALLOCATED YET</strong><span>Wait for PHU staff to dispatch ITNs to you. You can record schools in advance.</span></div></div>`;
  }
  if(!distData.schools.length){
    html+=`<div style="text-align:center;color:var(--gray-d);font-size:13px;padding:30px 0;">No distributions recorded.<br>Tap the button above to add a school.</div>`;
  } else {
    distData.schools.forEach((s,i)=>{
      const cov=s.pupils>0?Math.round(s.totalITN/s.pupils*100):0;
      html+=`<div class="school-card done">
        <div class="school-card-hdr">
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--green-d)" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
          <span class="school-card-name">${s.name}</span>
          <span class="pill green" style="margin-left:auto;font-size:10px;">${s.totalITN} ITNs</span>
        </div>
        <div class="school-card-body">
          <div style="font-size:11px;color:var(--text-s);margin-bottom:8px;">${s.pupils||0} pupils · ${cov}% coverage · ${fmtDateTime(new Date(s.date))}</div>
          <button class="btn" style="background:var(--navy-l);color:var(--navy);border:none;padding:6px 12px;border-radius:6px;font-size:11px;font-family:'Oswald',sans-serif;cursor:pointer;" onclick="viewSchoolRecord(${i})">
            <svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:var(--navy);fill:none;stroke-width:2;display:inline;vertical-align:middle;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            VIEW DETAILS
          </button>
        </div>
      </div>`;
    });
  }
  el.innerHTML=html;
}

function openAddSchoolForm(){
  distFormStep=1;
  distFormData={};
  showDistFormStep(1);
  ['ds-district','ds-chiefdom','ds-section','ds-facility','ds-community','ds-school'].forEach(id=>{
    const el=document.getElementById(id);if(!el)return;
    el.value='';el.disabled=(id!=='ds-district');
  });
  const nameEl=document.getElementById('ds-dist-name');if(nameEl)nameEl.value=S.user.name;
  captureDistGPS();
  showScreen('scr-dist-add');
}

function showDistFormStep(step){
  for(let i=1;i<=3;i++){
    const sec=document.getElementById('dist-form-step-'+i);if(sec)sec.style.display=(i===step?'block':'none');
    const dot=document.getElementById('dist-step-dot-'+i);if(dot){dot.classList.toggle('active',i===step);dot.classList.toggle('done',i<step);}
  }
  distFormStep=step;
  setEl('dist-form-step-label','STEP '+step+' OF 3');
}

function distFormNext(){
  if(distFormStep===1){
    const school=document.getElementById('ds-school')?.value;
    if(!school){notif('Please select a school first','error');return;}
    distFormData.schoolName=school;
    distFormData.district=document.getElementById('ds-district')?.value||'';
    distFormData.chiefdom=document.getElementById('ds-chiefdom')?.value||'';
    distFormData.section=document.getElementById('ds-section')?.value||'';
    distFormData.facility=document.getElementById('ds-facility')?.value||'';
    distFormData.community=document.getElementById('ds-community')?.value||'';
    buildEnrollmentTable();
    showDistFormStep(2);
  } else if(distFormStep===2){
    if(!collectEnrollment()) return;
    buildDistributionTable();
    showDistFormStep(3);
  }
}
function distFormBack(){
  if(distFormStep===2) showDistFormStep(1);
  else if(distFormStep===3) showDistFormStep(2);
}

function buildEnrollmentTable(){
  const tbl=document.getElementById('enroll-table'); if(!tbl) return;
  const classes=['Class 1','Class 2','Class 3','Class 4','Class 5'];
  tbl.innerHTML=`<thead><tr><th>Class</th><th>Boys</th><th>Girls</th><th>Total</th></tr></thead><tbody>
  ${classes.map((c,i)=>`<tr>
    <td style="font-weight:600;font-size:13px;">${c}</td>
    <td><input type="number" min="0" id="enr-b-${i}" style="width:60px;border:1px solid var(--border);border-radius:6px;padding:4px;text-align:center;" oninput="calcEnrollTotals()" value="0"></td>
    <td><input type="number" min="0" id="enr-g-${i}" style="width:60px;border:1px solid var(--border);border-radius:6px;padding:4px;text-align:center;" oninput="calcEnrollTotals()" value="0"></td>
    <td id="enr-t-${i}" style="font-weight:700;color:var(--navy);">0</td>
  </tr>`).join('')}
  </tbody>
  <tfoot><tr style="background:var(--navy-l);font-weight:700;"><td>TOTAL</td><td id="enr-tot-b">0</td><td id="enr-tot-g">0</td><td id="enr-tot-all" style="color:var(--navy);">0</td></tr></tfoot>`;
}

function calcEnrollTotals(){
  let tb=0,tg=0;
  for(let i=0;i<5;i++){
    const b=parseInt(document.getElementById('enr-b-'+i)?.value)||0;
    const g=parseInt(document.getElementById('enr-g-'+i)?.value)||0;
    setEl('enr-t-'+i,b+g);
    tb+=b;tg+=g;
  }
  setEl('enr-tot-b',tb);setEl('enr-tot-g',tg);setEl('enr-tot-all',tb+tg);
}

function collectEnrollment(){
  const classes=[];let total=0;
  for(let i=0;i<5;i++){
    const b=parseInt(document.getElementById('enr-b-'+i)?.value)||0;
    const g=parseInt(document.getElementById('enr-g-'+i)?.value)||0;
    classes.push({label:'Class '+(i+1),boys:b,girls:g,total:b+g});
    total+=b+g;
  }
  if(total===0){notif('Enter at least one pupil','error');return false;}
  distFormData.enrollment=classes;
  distFormData.totalPupils=total;
  return true;
}

function buildDistributionTable(){
  const tbl=document.getElementById('dist-table'); if(!tbl) return;
  const key=S.user.username;
  const disp=phuDispatches.find(d=>d.distKey===key&&!d.returned);
  const given=disp?.total||0;
  const alreadyDist=(distributions[key]?.schools||[]).reduce((s,sc)=>s+sc.totalITN,0);
  const avail=Math.max(0,given-alreadyDist);
  setEl('dist-avail-stock',avail);
  const enroll=distFormData.enrollment||[];
  tbl.innerHTML=`<thead><tr><th>Class</th><th>Boys</th><th>Girls</th><th>Total</th></tr></thead><tbody>
  ${enroll.map((c,i)=>`<tr>
    <td style="font-size:12px;font-weight:600;">${c.label}</td>
    <td><input type="number" min="0" max="${c.boys}" id="di-b-${i}" value="${c.boys}" style="width:55px;border:1px solid var(--border);border-radius:6px;padding:4px;text-align:center;" oninput="validateDistIn(${i},'b',${c.boys});calcDistTotals()"></td>
    <td><input type="number" min="0" max="${c.girls}" id="di-g-${i}" value="${c.girls}" style="width:55px;border:1px solid var(--border);border-radius:6px;padding:4px;text-align:center;" oninput="validateDistIn(${i},'g',${c.girls});calcDistTotals()"></td>
    <td id="di-t-${i}" style="font-weight:700;color:var(--navy);">${c.boys+c.girls}</td>
  </tr>`).join('')}
  </tbody>
  <tfoot><tr style="background:var(--navy-l);font-weight:700;"><td>TOTAL</td><td id="di-tot-b">0</td><td id="di-tot-g">0</td><td id="di-tot-all">0</td></tr></tfoot>`;
  calcDistTotals();
}

function validateDistIn(i,gender,max){
  const el=document.getElementById(`di-${gender}-${i}`);
  if(!el) return;
  let v=parseInt(el.value)||0;
  if(v<0) v=0;
  if(v>max) v=max;
  el.value=v;
}

function calcDistTotals(){
  const key=S.user.username;
  const disp=phuDispatches.find(d=>d.distKey===key&&!d.returned);
  const given=disp?.total||0;
  const alreadyDist=(distributions[key]?.schools||[]).reduce((s,sc)=>s+sc.totalITN,0);
  const avail=Math.max(0,given-alreadyDist);
  let tb=0,tg=0;
  const enroll=distFormData.enrollment||[];
  for(let i=0;i<enroll.length;i++){
    const b=parseInt(document.getElementById('di-b-'+i)?.value)||0;
    const g=parseInt(document.getElementById('di-g-'+i)?.value)||0;
    setEl('di-t-'+i,b+g);tb+=b;tg+=g;
  }
  setEl('di-tot-b',tb);setEl('di-tot-g',tg);setEl('di-tot-all',tb+tg);
  const warn=document.getElementById('dist-stock-warn');
  const btn=document.getElementById('dist-save-btn');
  if(tb+tg>avail){
    if(warn){warn.style.display='block';warn.textContent='Total ('+( tb+tg)+') exceeds available stock ('+avail+')';}
    if(btn) btn.disabled=true;
  } else {
    if(warn) warn.style.display='none';
    if(btn) btn.disabled=false;
  }
}

function saveDistribution(){
  const key=S.user.username;
  const enroll=distFormData.enrollment||[];
  const classes=[];
  let total=0;
  for(let i=0;i<enroll.length;i++){
    const b=parseInt(document.getElementById('di-b-'+i)?.value)||0;
    const g=parseInt(document.getElementById('di-g-'+i)?.value)||0;
    classes.push({label:enroll[i].label,boys:b,girls:g,total:b+g});
    total+=b+g;
  }
  if(total===0){notif('Enter distribution quantities','error');return;}
  if(!distributions[key]) distributions[key]={schools:[]};
  const sigPad=document.getElementById('dist-sig-canvas');
  let sigData='';
  if(typeof SignaturePad!=='undefined'&&sigPad){
    const sp=sigPad._signaturePad;
    if(sp&&!sp.isEmpty()) sigData=sp.toDataURL();
  }
  const record={
    id:genID('SCH'),
    name:distFormData.schoolName,
    district:distFormData.district,
    chiefdom:distFormData.chiefdom,
    section:distFormData.section,
    facility:distFormData.facility,
    community:distFormData.community,
    gps:distFormData.gps||null,
    pupils:distFormData.totalPupils||0,
    enrollment:distFormData.enrollment,
    classes,
    totalITN:total,
    signature:sigData,
    date:new Date().toISOString(),
    distributor:S.user.name,
    distUsername:key
  };
  distributions[key].schools.push(record);
  saveState('itn_distributions',distributions);
  notif('Distribution saved: '+total+' ITNs at '+record.name,'success');
  showScreen('scr-dist-schools');
}

function viewSchoolRecord(idx){
  const key=S.user.username;
  const s=distributions[key]?.schools?.[idx]; if(!s) return;
  const el=document.getElementById('dist-record-content'); if(!el) return;
  el.innerHTML=`
    <div class="summ-item"><span class="summ-k">School</span><span class="summ-v" style="font-weight:700;">${s.name}</span></div>
    <div class="summ-item"><span class="summ-k">Location</span><span class="summ-v">${[s.district,s.chiefdom,s.community].filter(Boolean).join(' › ')}</span></div>
    <div class="summ-item"><span class="summ-k">Health Facility</span><span class="summ-v">${s.facility||'—'}</span></div>
    <div class="summ-item"><span class="summ-k">Total Pupils</span><span class="summ-v">${s.pupils}</span></div>
    <div class="summ-item"><span class="summ-k">Total ITNs Given</span><span class="summ-v" style="font-size:20px;color:var(--navy);font-weight:700;">${s.totalITN}</span></div>
    <div class="summ-item"><span class="summ-k">Date</span><span class="summ-v">${fmtDateTime(new Date(s.date))}</span></div>
    ${s.gps?`<div class="summ-item"><span class="summ-k">GPS</span><span class="summ-v">${s.gps.lat.toFixed(5)}, ${s.gps.lng.toFixed(5)}</span></div>`:''}
    <div style="margin-top:12px;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr style="background:var(--navy);color:#fff;"><th style="padding:6px;">Class</th><th>Boys</th><th>Girls</th><th>Total</th></tr></thead>
        <tbody>${(s.classes||[]).map(c=>`<tr style="border-bottom:1px solid var(--border);"><td style="padding:5px 6px;">${c.label}</td><td style="text-align:center;">${c.boys}</td><td style="text-align:center;">${c.girls}</td><td style="text-align:center;font-weight:700;">${c.total}</td></tr>`).join('')}</tbody>
      </table>
    </div>
    ${s.signature?`<div style="margin-top:14px;"><div style="font-size:11px;color:var(--text-s);margin-bottom:6px;">DISTRIBUTOR SIGNATURE</div><img src="${s.signature}" style="width:100%;max-width:280px;border:1px solid var(--border);border-radius:8px;"/></div>`:''}
  `;
  showScreen('scr-dist-record');
}

function renderDistSummary(){
  const key=S.user.username;
  const disp=phuDispatches.find(d=>d.distKey===key&&!d.returned);
  const distData=distributions[key]||{schools:[]};
  const totalDist=distData.schools.reduce((s,sc)=>s+sc.totalITN,0);
  const given=disp?.total||0;
  const remaining=Math.max(0,given-totalDist);
  const target=S.user.target_itn||0;
  const targetPct=target>0?Math.round(totalDist/target*100):0;
  const el=document.getElementById('dist-summary-content'); if(!el) return;
  el.innerHTML=`
    <div class="stat-row" style="margin-bottom:16px;">
      <div class="stat-box navy"><div class="stat-n">${given}</div><div class="stat-l">Allocated</div></div>
      <div class="stat-box green"><div class="stat-n">${totalDist}</div><div class="stat-l">Distributed</div></div>
      <div class="stat-box orange"><div class="stat-n">${remaining}</div><div class="stat-l">Remaining</div></div>
      ${target?`<div class="stat-box teal"><div class="stat-n">${targetPct}%</div><div class="stat-l">Target</div></div>`:''}
    </div>
    ${distData.schools.length?`
    <div class="card">
      <div class="card-hdr navy"><svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg><span class="card-htitle">SCHOOL BREAKDOWN</span></div>
      <div class="card-body">
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead><tr style="background:var(--navy);color:#fff;"><th style="padding:6px;text-align:left;">School</th><th>Pupils</th><th>ITNs</th><th>Cover</th></tr></thead>
          <tbody>${distData.schools.map(s=>`<tr style="border-bottom:1px solid var(--border);"><td style="padding:5px 6px;">${s.name}</td><td style="text-align:center;">${s.pupils}</td><td style="text-align:center;font-weight:700;color:var(--navy);">${s.totalITN}</td><td style="text-align:center;">${s.pupils?Math.round(s.totalITN/s.pupils*100)+'%':'—'}</td></tr>`).join('')}</tbody>
        </table>
      </div>
    </div>`:'<div style="text-align:center;color:var(--gray-d);padding:30px;">No distributions recorded yet</div>'}
  `;
}

// ─── GPS capture ───
let distGPSWatchId=null;
function setupDistGPS(){}
function captureDistGPS(){
  const el=document.getElementById('ds-gps-status');
  if(el){el.textContent='Locating...';el.style.color='var(--gold)';}
  if(!navigator.geolocation){if(el){el.textContent='GPS not available';el.style.color='var(--red)';}return;}
  navigator.geolocation.getCurrentPosition(pos=>{
    distFormData.gps={lat:pos.coords.latitude,lng:pos.coords.longitude,acc:Math.round(pos.coords.accuracy)};
    if(el){el.textContent='GPS: '+pos.coords.latitude.toFixed(5)+', '+pos.coords.longitude.toFixed(5)+' (±'+Math.round(pos.coords.accuracy)+'m)';el.style.color='var(--green)';}
  },()=>{if(el){el.textContent='GPS unavailable';el.style.color='var(--red)';}},{timeout:10000});
}

// ─── Signature pad ───
function setupDistSignature(){
  const canvas=document.getElementById('dist-sig-canvas'); if(!canvas) return;
  if(typeof SignaturePad==='undefined') return;
  const sp=new SignaturePad(canvas,{penColor:'#004080',backgroundColor:'rgba(0,0,0,0)'});
  canvas._signaturePad=sp;
  const resizeCanvas=()=>{
    const ratio=Math.max(window.devicePixelRatio||1,1);
    canvas.width=canvas.offsetWidth*ratio;
    canvas.height=canvas.offsetHeight*ratio;
    canvas.getContext('2d').scale(ratio,ratio);
    sp.clear();
  };
  window.addEventListener('resize',resizeCanvas);
  resizeCanvas();
}
function clearDistSig(){const c=document.getElementById('dist-sig-canvas');if(c&&c._signaturePad)c._signaturePad.clear();}

// ═══════════════════════════════════════════
// SUPERVISOR — DASHBOARD
// ═══════════════════════════════════════════
function refreshSupDash(){
  // System-wide stats from localStorage
  const allDispatches=loadState('itn_dispatches')||[];
  const allPHUDisp=loadState('itn_phu_dispatches')||[];
  const allDist=loadState('itn_distributions')||{};
  const dStock=loadState('itn_dstock')||{pbo:0,ig2:0};

  const totalITNDispatched=allDispatches.reduce((s,d)=>s+d.total,0);
  const totalITNDistributed=Object.values(allDist).reduce((s,d)=>s+(d.schools||[]).reduce((a,sc)=>a+sc.totalITN,0),0);
  const allUsers=Object.keys(USERS).length;
  const distUsers=Object.entries(USERS).filter(([,v])=>v.role==='distributor');
  let totalTarget=distUsers.reduce((s,[,v])=>s+(v.target_itn||0),0);
  const overallPct=totalTarget>0?Math.round(totalITNDistributed/totalTarget*100):0;

  setEl('sup-stat1',allUsers);
  setEl('sup-stat2',totalITNDispatched.toLocaleString());
  setEl('sup-stat3',totalITNDistributed.toLocaleString());
  setEl('sup-stat4',overallPct+'%');
  setEl('sup-progress-label',totalITNDistributed+' / '+totalTarget+' ITN target');

  const bar=document.getElementById('sup-progress-bar');
  if(bar){bar.style.width=Math.min(100,overallPct)+'%';bar.style.background=overallPct>=100?'var(--green)':overallPct>=50?'var(--gold)':'var(--red)';}

  // Quick distributor status
  const distEl=document.getElementById('sup-dist-quick'); if(!distEl) return;
  distEl.innerHTML=distUsers.map(([k,v])=>{
    const given=(allPHUDisp.find(d=>d.distKey===k&&!d.returned)||{total:0}).total;
    const distd=(allDist[k]?.schools||[]).reduce((s,sc)=>s+sc.totalITN,0);
    const target=v.target_itn||0;
    const pct=target>0?Math.round(distd/target*100):0;
    return `<div class="sup-dist-row" onclick="supViewProfile('${k}')">
      <div class="sdr-info">
        <div class="sdr-name">${v.name}</div>
        <div class="sdr-meta">${v.district} · ${(allDist[k]?.schools||[]).length} schools</div>
      </div>
      <div class="sdr-stats">
        <div class="sdr-itn">${distd}<span>ITNs</span></div>
        <div class="sdr-bar-wrap"><div class="sdr-bar" style="width:${Math.min(100,pct)}%;background:${pct>=100?'var(--green)':pct>=50?'var(--gold)':'var(--red)'}"></div></div>
        <div class="sdr-pct ${pct>=100?'green':pct>=50?'gold':'red'}">${pct}%</div>
      </div>
    </div>`;
  }).join('')||'<div style="color:var(--gray-d);font-size:13px;padding:20px 0;text-align:center;">No distributors registered</div>';
}

function renderSupUsers(filterRole){
  const el=document.getElementById('sup-users-list'); if(!el) return;
  const allPHUDisp=loadState('itn_phu_dispatches')||[];
  const allDist=loadState('itn_distributions')||{};
  const allDispatches=loadState('itn_dispatches')||[];

  // Filter tabs
  document.querySelectorAll('.sup-filter-tab').forEach(t=>{
    t.classList.toggle('active',t.dataset.role===(filterRole||'all'));
  });

  const entries=Object.entries(USERS).filter(([,v])=>{
    if(!filterRole||filterRole==='all') return true;
    return v.role===filterRole;
  });

  el.innerHTML=entries.map(([k,v])=>{
    let statHtml='';
    if(v.role==='distributor'){
      const distd=(allDist[k]?.schools||[]).reduce((s,sc)=>s+sc.totalITN,0);
      const target=v.target_itn||0;
      const pct=target>0?Math.round(distd/target*100):0;
      const schools=(allDist[k]?.schools||[]).length;
      statHtml=`<span class="pill ${pct>=100?'green':pct>=50?'gold':'red'}">${pct}% target</span><span class="pill navy">${schools} schools</span><span class="pill teal">${distd} ITNs</span>`;
    } else if(v.role==='driver'){
      const trips=allDispatches.filter(d=>d.driverUsername===k||d.driverCode===v.qr_code).length;
      const itns=allDispatches.filter(d=>d.driverUsername===k||d.driverCode===v.qr_code).reduce((s,d)=>s+d.total,0);
      statHtml=`<span class="pill navy">${trips} trips</span><span class="pill teal">${itns.toLocaleString()} ITNs</span>`;
    } else if(v.role==='phu'){
      const recvd=allDispatches.filter(d=>d.dest===v.facility&&d.status!=='dispatched').reduce((s,d)=>s+(d.receivedTotal||d.total),0);
      const sentOut=allPHUDisp.filter(d=>d.phuUser===k).reduce((s,d)=>s+d.total,0);
      statHtml=`<span class="pill green">${recvd.toLocaleString()} recv</span><span class="pill orange">${sentOut.toLocaleString()} sent</span>`;
    } else if(v.role==='dhmt'){
      const dispCount=allDispatches.filter(d=>d.officerUser===k).length;
      const dispTotal=allDispatches.filter(d=>d.officerUser===k).reduce((s,d)=>s+d.total,0);
      statHtml=`<span class="pill navy">${dispCount} dispatches</span><span class="pill teal">${dispTotal.toLocaleString()} ITNs</span>`;
    }
    const roleBadge={dhmt:'DHMT',phu:'PHU',driver:'DRIVER',distributor:'DIST',supervisor:'SUP'}[v.role]||v.role.toUpperCase();
    const roleColor={dhmt:'navy',phu:'green',driver:'teal',distributor:'orange',supervisor:'gold'}[v.role]||'navy';
    return `<div class="sup-user-card" onclick="supViewProfile('${k}')">
      <div class="suc-avatar ${roleColor}">${initials(v.name)}</div>
      <div class="suc-info">
        <div class="suc-name">${v.name}</div>
        <div class="suc-meta"><span class="pill ${roleColor}" style="font-size:9px;">${roleBadge}</span> ${v.title||''} · ${v.district}</div>
        <div class="suc-stats" style="margin-top:5px;">${statHtml}</div>
      </div>
      <div class="suc-arr">›</div>
    </div>`;
  }).join('')||'<div style="text-align:center;color:var(--gray-d);padding:30px;">No users found</div>';
}

function supFilterUsers(role){
  renderSupUsers(role==='all'?null:role);
}

// ─── Supervisor QR Scan ───
window.onSupScan=function(txt){
  const user=validateQR(txt);
  if(!user){notif('QR code not found in user registry','error');setVis('sup-scan-overlay',true);return;}
  notif('User found: '+user.name,'success');
  supViewProfile(user._username);
};

function supViewProfile(username){
  const u=USERS[username]; if(!u) return;
  S.supViewUser=username;
  const el=document.getElementById('sup-profile-content'); if(!el) return;

  const allDispatches=loadState('itn_dispatches')||[];
  const allPHUDisp=loadState('itn_phu_dispatches')||[];
  const allDist=loadState('itn_distributions')||{};
  const dStock=loadState('itn_dstock')||{pbo:0,ig2:0};
  const accts=loadState('itn_acct')||[];

  const roleBadge={dhmt:'DHMT OFFICER',phu:'PHU IN-CHARGE',driver:'TRANSPORT DRIVER',distributor:'FIELD DISTRIBUTOR',supervisor:'SUPERVISOR'}[u.role]||u.role.toUpperCase();
  const roleColor={dhmt:'navy',phu:'green',driver:'teal',distributor:'orange',supervisor:'gold'}[u.role]||'navy';

  // Assignments
  let assignHtml='';
  if(u.assigned_dhmt) assignHtml+=`<div class="summ-item"><span class="summ-k">Reports to DHMT</span><span class="summ-v">${USERS[u.assigned_dhmt]?.name||u.assigned_dhmt}</span></div>`;
  if(u.assigned_phu) assignHtml+=`<div class="summ-item"><span class="summ-k">Assigned PHU</span><span class="summ-v">${USERS[u.assigned_phu]?.facility||USERS[u.assigned_phu]?.name||u.assigned_phu}</span></div>`;
  if(u.vehicle) assignHtml+=`<div class="summ-item"><span class="summ-k">Vehicle</span><span class="summ-v">${u.vehicle}</span></div>`;
  if(u.facility) assignHtml+=`<div class="summ-item"><span class="summ-k">Facility</span><span class="summ-v">${u.facility}</span></div>`;
  if(u.target_itn) assignHtml+=`<div class="summ-item"><span class="summ-k">ITN Target</span><span class="summ-v">${u.target_itn.toLocaleString()} ITNs</span></div>`;

  // Role-specific stats
  let statsHtml='';
  let timelineHtml='';

  if(u.role==='dhmt'){
    const myD=allDispatches.filter(d=>d.officerUser===username||d.officer===u.name);
    const recv=myD.filter(d=>d.status==='received').length;
    const inTrans=myD.filter(d=>d.status==='dispatched').length;
    const totalSent=myD.reduce((s,d)=>s+d.total,0);
    statsHtml=`<div class="stat-row">
      <div class="stat-box navy"><div class="stat-n">${myD.length}</div><div class="stat-l">Dispatches</div></div>
      <div class="stat-box green"><div class="stat-n">${recv}</div><div class="stat-l">Received</div></div>
      <div class="stat-box orange"><div class="stat-n">${inTrans}</div><div class="stat-l">In Transit</div></div>
      <div class="stat-box teal"><div class="stat-n">${totalSent.toLocaleString()}</div><div class="stat-l">ITNs Sent</div></div>
    </div>`;
    timelineHtml=myD.slice().reverse().map(d=>`<div class="tl-item"><div class="tl-dot ${d.status==='received'?'green':d.status==='shortage'?'red':'orange'}"></div><div class="tl-content"><div class="tl-title">${d.id} → ${d.dest}</div><div class="tl-meta">${d.total} ITNs · ${d.driver} · <span class="pill ${d.status==='received'?'green':d.status==='shortage'?'red':'orange'}" style="font-size:9px;">${d.status}</span></div><div class="tl-time">${fmtDateTime(new Date(d.date))}</div></div></div>`).join('');
  }

  if(u.role==='driver'){
    const myD=allDispatches.filter(d=>d.driverUsername===username||d.driverCode===u.qr_code||d.driver===u.name);
    const delivered=myD.filter(d=>d.status==='received');
    const totalCarried=myD.reduce((s,d)=>s+d.total,0);
    const totalDelivered=delivered.reduce((s,d)=>s+(d.receivedTotal||d.total),0);
    const shortages=accts.filter(a=>a.type==='driver_shortage'&&a.driver===u.name).length;
    statsHtml=`<div class="stat-row">
      <div class="stat-box navy"><div class="stat-n">${myD.length}</div><div class="stat-l">Trips</div></div>
      <div class="stat-box green"><div class="stat-n">${totalCarried.toLocaleString()}</div><div class="stat-l">ITNs Carried</div></div>
      <div class="stat-box teal"><div class="stat-n">${totalDelivered.toLocaleString()}</div><div class="stat-l">Delivered</div></div>
      <div class="stat-box ${shortages?'red':'green'}"><div class="stat-n">${shortages}</div><div class="stat-l">Shortages</div></div>
    </div>`;
    timelineHtml=myD.slice().reverse().map(d=>`<div class="tl-item"><div class="tl-dot ${d.status==='received'?'green':d.status==='shortage'?'red':'orange'}"></div><div class="tl-content"><div class="tl-title">To ${d.dest}</div><div class="tl-meta">${d.id} · ${d.vehicle} · ${d.total} ITNs · <span class="pill ${d.status==='received'?'green':d.status==='shortage'?'red':'orange'}" style="font-size:9px;">${d.status}</span></div><div class="tl-time">${fmtDateTime(new Date(d.date))}</div></div></div>`).join('');
  }

  if(u.role==='phu'){
    const myRecv=allDispatches.filter(d=>d.dest===u.facility&&d.status!=='dispatched');
    const mySent=allPHUDisp.filter(d=>d.phuUser===username);
    const totalRecv=myRecv.reduce((s,d)=>s+(d.receivedTotal||d.total),0);
    const totalSent=mySent.reduce((s,d)=>s+d.total,0);
    const returned=mySent.filter(d=>d.returned).length;
    statsHtml=`<div class="stat-row">
      <div class="stat-box navy"><div class="stat-n">${myRecv.length}</div><div class="stat-l">Deliveries Recv</div></div>
      <div class="stat-box green"><div class="stat-n">${totalRecv.toLocaleString()}</div><div class="stat-l">ITNs Received</div></div>
      <div class="stat-box orange"><div class="stat-n">${mySent.length}</div><div class="stat-l">Dist Dispatches</div></div>
      <div class="stat-box teal"><div class="stat-n">${totalSent.toLocaleString()}</div><div class="stat-l">ITNs Sent Out</div></div>
    </div>`;
    const timeline=[...myRecv.map(d=>({date:d.receivedDate||d.date,label:`Received ${d.id} from DHMT`,detail:`${d.receivedTotal||d.total} ITNs · ${d.driver}`,status:'green'})),
                    ...mySent.map(d=>({date:d.date,label:`Dispatched to ${d.distName}`,detail:`${d.total} ITNs${d.returned?' · returned':''}`,status:d.returned?'green':'orange'}))];
    timeline.sort((a,b)=>new Date(b.date)-new Date(a.date));
    timelineHtml=timeline.map(t=>`<div class="tl-item"><div class="tl-dot ${t.status}"></div><div class="tl-content"><div class="tl-title">${t.label}</div><div class="tl-meta">${t.detail}</div><div class="tl-time">${fmtDateTime(new Date(t.date))}</div></div></div>`).join('');
  }

  if(u.role==='distributor'){
    const myDisp=allPHUDisp.find(d=>d.distKey===username&&!d.returned);
    const myDist=allDist[username]||{schools:[]};
    const schools=myDist.schools||[];
    const given=myDisp?.total||0;
    const distd=schools.reduce((s,sc)=>s+sc.totalITN,0);
    const remaining=Math.max(0,given-distd);
    const target=u.target_itn||0;
    const targetPct=target>0?Math.round(distd/target*100):0;
    const myShortages=accts.filter(a=>a.type==='dist_return_shortage'&&a.distKey===username).length;
    statsHtml=`<div class="stat-row">
      <div class="stat-box navy"><div class="stat-n">${given}</div><div class="stat-l">Allocated</div></div>
      <div class="stat-box green"><div class="stat-n">${distd}</div><div class="stat-l">Distributed</div></div>
      <div class="stat-box orange"><div class="stat-n">${schools.length}</div><div class="stat-l">Schools</div></div>
      <div class="stat-box ${targetPct>=100?'green':targetPct>=50?'teal':'red'}"><div class="stat-n">${targetPct}%</div><div class="stat-l">Target</div></div>
    </div>
    <div style="margin:8px 0;">
      <div style="font-size:11px;color:var(--text-s);margin-bottom:4px;">TARGET PROGRESS: ${distd} / ${target} ITNs</div>
      <div style="background:var(--border);border-radius:8px;height:10px;"><div style="height:100%;border-radius:8px;background:${targetPct>=100?'var(--green)':targetPct>=50?'var(--gold)':'var(--red)'};width:${Math.min(100,targetPct)}%;transition:width 0.4s;"></div></div>
    </div>
    ${myShortages?`<div class="alert" style="background:var(--red-l);border:1px solid var(--red);border-radius:8px;padding:8px 12px;margin-top:8px;font-size:12px;color:var(--red-d);">⚠ ${myShortages} shortage report(s) on file</div>`:''}`;
    timelineHtml=schools.slice().reverse().map(s=>`<div class="tl-item"><div class="tl-dot green"></div><div class="tl-content"><div class="tl-title">${s.name}</div><div class="tl-meta">${s.totalITN} ITNs · ${s.pupils} pupils · ${[s.district,s.chiefdom].filter(Boolean).join(', ')}</div><div class="tl-time">${fmtDateTime(new Date(s.date))}</div></div></div>`).join('');
  }

  el.innerHTML=`
    <div class="sup-profile-card">
      <div class="spc-avatar ${roleColor}">${initials(u.name)}</div>
      <div class="spc-info">
        <div class="spc-name">${u.name}</div>
        <div class="spc-role"><span class="pill ${roleColor}">${roleBadge}</span></div>
        <div class="spc-contact">📱 ${u.phone||'—'} · ${u.district}</div>
      </div>
    </div>
    ${assignHtml?`<div class="card" style="margin-bottom:12px;"><div class="card-hdr navy"><svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg><span class="card-htitle">ASSIGNMENTS</span></div><div class="card-body" style="padding:12px 16px;">${assignHtml}</div></div>`:''}
    <div style="margin-bottom:12px;">${statsHtml}</div>
    ${timelineHtml?`<div class="card"><div class="card-hdr blue"><svg viewBox="0 0 24 24" fill="none" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><span class="card-htitle">ACTIVITY TIMELINE</span></div><div class="card-body" style="padding:12px 16px;"><div class="timeline">${timelineHtml}</div></div></div>`:'<div style="text-align:center;color:var(--gray-d);padding:30px;font-size:13px;">No activity recorded yet</div>'}
  `;
  setEl('sup-profile-title',u.name);
  showScreen('scr-sup-profile');
}

// ═══════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════
function setEl(id,val){const e=document.getElementById(id);if(e)e.textContent=val;}
function genID(prefix){return prefix+'-'+Date.now().toString(36).toUpperCase().slice(-5);}
function initials(name){return (name||'').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);}
function fmtDateTime(d){if(!d||isNaN(d)) return '—';const dd=String(d.getDate()).padStart(2,'0'),mm=String(d.getMonth()+1).padStart(2,'0'),yy=d.getFullYear();const hh=String(d.getHours()).padStart(2,'0'),mi=String(d.getMinutes()).padStart(2,'0');return `${dd}/${mm}/${yy} ${hh}:${mi}`;}
function setNow(dateId,timeId){const n=new Date();const d=document.getElementById(dateId);const t=document.getElementById(timeId);if(d)d.value=n.toISOString().slice(0,10);if(t)t.value=String(n.getHours()).padStart(2,'0')+':'+String(n.getMinutes()).padStart(2,'0');}

let _notifTimer=null;
function notif(msg,type='info'){
  let el=document.getElementById('notif-bar');
  if(!el){el=document.createElement('div');el.id='notif-bar';document.body.appendChild(el);}
  el.textContent=msg;
  el.className='notif-bar show '+type;
  clearTimeout(_notifTimer);
  _notifTimer=setTimeout(()=>el.classList.remove('show'),3500);
}
