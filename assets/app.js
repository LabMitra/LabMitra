const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money=n=>"₹"+Number(n).toLocaleString("en-IN");
const fmt=d=>new Date(d).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"});
const today=()=>new Date().toLocaleDateString("en-CA");
function toast(msg,ok=true){let el=$(".toast");if(!el){el=document.createElement("div");el.className="toast";document.body.appendChild(el)}
  if(!el.querySelector(".msg"))el.innerHTML='<span class="tick"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 12 9 18 20 6"></polyline></svg></span><span class="msg"></span>';
  el.querySelector(".msg").textContent=msg;el.classList.toggle("error",!ok);
  el.classList.remove("show");void el.offsetWidth;el.classList.add("show");
  clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove("show"),2800)}
const fail=e=>toast(e.message||"Something went wrong",false);
// Age with its unit: "68 y", "3 mo", "12 days" (long form for CSV/receipts: "68 years", "3 months").
const AGE_UNITS={years:["y","year","years"],months:["mo","month","months"],days:["days","day","days"]};
const ageText=(a,u,long)=>{if(a==null||a==="")return"";const w=AGE_UNITS[u]||AGE_UNITS.years;return`${a} ${long?(+a===1?w[1]:w[2]):(u==="days"&&+a===1?"day":w[0])}`};
const fmtDT=d=>new Date(d).toLocaleString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"});

// ---------- business details (used on receipts) — FILL THESE IN ----------
const BUSINESS={name:"LabMitra",tagline:"Diagnostic tests at home",legal:"BYOS Pathology & Diagnostics",
  address:"In front of Bandhwa Talab (Rawan Murti), Main Road, beside HP Petrol Pump, Kachana, Raipur, Chhattisgarh 492014",
  phone:"+91 87709 12514",email:"",gstin:""};

// ---------- collection time slots (one list for booking + reschedule) ----------
const SLOTS=["7:00–8:00 AM","8:00–9:00 AM","9:00–10:00 AM","10:00–11:00 AM"];
// Start hour of a slot label, e.g. "7:00–8:00 AM" -> 7, "2:00–3:00 PM" -> 14. Matches slot_start() in SQL.
const slotHour=s=>{const m=/^(\d{1,2}):/.exec(s||"");if(!m)return null;let h=+m[1];if(/PM\s*$/.test(s)&&h<9)h+=12;return h};
const slotStarted=(date,slot)=>{const h=slotHour(slot);const d=new Date(String(date).slice(0,10)+"T00:00:00");d.setHours(h??0);return new Date()>=d};
// Which slots are open on a date: full ones (capacity) and ones already started today are disabled.
let _slotCap=null;
async function slotAvailability(date,ignoreBookingSlot){
  if(_slotCap===null){const{data}=await sb.from("app_settings").select("value").eq("key","slot_capacity").maybeSingle();_slotCap=data?+data.value||5:5}
  const{data}=await sb.rpc("slot_counts",{p_date:date});const counts=Object.fromEntries((data||[]).map(r=>[r.slot,r.booked]));
  if(ignoreBookingSlot&&counts[ignoreBookingSlot])counts[ignoreBookingSlot]--;
  return SLOTS.map(s=>{const n=counts[s]||0,passed=slotStarted(date,s),full=n>=_slotCap,left=_slotCap-n;
    return{slot:s,disabled:passed||full,label:s+(passed?" — already started":full?" — full":left<=2?` — only ${left} left`:"")}})}

// ---------- popup (timeline, cancel, reschedule) ----------
function openModal(title,html){let m=$("#lmModal");
  if(!m){m=document.createElement("div");m.id="lmModal";m.className="modal";
    m.innerHTML='<div class="modal-card" role="dialog" aria-modal="true"><div class="modal-head"><b class="modal-title"></b><button type="button" class="modal-x" aria-label="Close">✕</button></div><div class="modal-body"></div></div>';
    document.body.appendChild(m);m.addEventListener("click",e=>{if(e.target===m||e.target.closest(".modal-x,[data-close]"))closeModal()});
    document.addEventListener("keydown",e=>{if(e.key==="Escape")closeModal()})}
  m.querySelector(".modal-title").textContent=title;m.querySelector(".modal-body").innerHTML=html;m.hidden=false;document.body.style.overflow="hidden";
  return m.querySelector(".modal-body")}
function closeModal(){const m=$("#lmModal");if(m){m.hidden=true;document.body.style.overflow=""}}

// ---------- booking timeline (any page: add data-timeline="<id>" data-ref="LM-…") ----------
async function showTimeline(id,ref){const body=openModal(`Timeline · ${ref}`,'<p class="muted">Loading…</p>');
  const{data,error}=await sb.from("booking_events").select("*").eq("booking_id",id).order("created_at").order("id");
  if(error){body.innerHTML=`<p class="muted">${/booking_events/.test(error.message)?"The timeline isn't set up yet. Run supabase/features_upgrade.sql in Supabase.":esc(error.message)}</p>`;return}
  body.innerHTML=data.length?`<ol class="timeline">${data.map((ev,i)=>`<li class="${i===data.length-1?"latest":""}${/cancel|refund/i.test(ev.event)?" bad":""}"><span class="tl-dot"></span><div><b>${esc(ev.event)}</b>${ev.detail?`<div class="tl-detail">${esc(ev.detail)}</div>`:""}<small>${fmtDT(ev.created_at)}${ev.actor?` · by ${esc(ev.actor)}`:""}</small></div></li>`).join("")}</ol>`
    :'<p class="muted">No steps recorded yet.</p>'}
document.addEventListener("click",e=>{const t=e.target.closest("[data-timeline]");if(!t)return;e.preventDefault();showTimeline(t.dataset.timeline,t.dataset.ref||"")});

// Calls a Supabase Edge Function and returns the function's own error message if it fails.
async function invokeFn(name,body){const{data,error}=await sb.functions.invoke(name,{body});
  if(error){let msg=error.message;try{const j=await error.context.json();if(j?.error)msg=j.error}catch{}return{error:new Error(msg)}}
  if(data?.error)return{error:new Error(data.error)};return{data}}

// ---------- CSV download (opens fine in Excel / Google Sheets) ----------
function downloadCSV(filename,header,rows){
  const cell=v=>{const s=v==null?"":String(v);return'"'+s.replace(/"/g,'""')+'"'};
  const csv="﻿"+[header,...rows].map(r=>r.map(cell).join(",")).join("\r\n");
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));a.download=filename;
  document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500)}

// Errors Supabase adds to the address after an email link (e.g. #error_code=otp_expired). Read early, before the client clears it.
const _authErr=(()=>{const h=new URLSearchParams(location.hash.slice(1));return h.get("error_code")||h.get("error")?{code:h.get("error_code")||h.get("error"),msg:h.get("error_description")}:null})();
function showAuthLinkError(){if(!_authErr)return;history.replaceState(null,"",location.pathname+location.search);
  toast(_authErr.code==="otp_expired"?"That email link has expired or was already used. Log in, and we'll send you a fresh one if needed.":(_authErr.msg||"That link didn't work. Please try again."),false)}

// ---------- auth ----------
let _ctx;
async function me(){if(_ctx)return _ctx;const{data:{session}}=await sb.auth.getSession();if(!session)return null;
  const{data:profile}=await sb.from("profiles").select("*").eq("id",session.user.id).single();return _ctx={user:session.user,profile:profile||{}}}
async function guard(roles,loginPage="login.html"){const c=await me();
  if(!c||(roles&&!roles.includes(c.profile.role))){location.href=loginPage+"?next="+encodeURIComponent(location.pathname.split("/").pop()+location.search);return null}return c}
// ---------- phones: app-style tab bar at the bottom of patient pages ----------
const MNAV_ICONS={
  home:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  search:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg>',
  cart:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>',
  book:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M9 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-4"/><path d="M9 14l2 2 4-4"/></svg>',
  user:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/></svg>',
  shield:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/></svg>'};
function drawMobileNav(c,count){let n=$("#mobileNav");
  if(!n){n=document.createElement("nav");n.id="mobileNav";n.className="mnav";n.setAttribute("aria-label","Main");document.body.appendChild(n)}
  const page=location.pathname.split("/").pop()||"index.html",I=MNAV_ICONS;
  const item=(href,icon,label,active,extra="")=>`<a href="${href}"${active?' class="active" aria-current="page"':""}>${icon}<span>${label}</span>${extra}</a>`;
  const items=c?[item("index.html",I.home,"Home",page==="index.html"),
      item("cart.html",I.cart,"Cart",page==="cart.html"||page==="booking.html",count?`<b class="mbadge">${count}</b>`:""),
      item("account.html",I.book,"Bookings",page==="account.html"),
      item("profile.html",I.user,"Account",page==="profile.html")]
    :[item("index.html",I.home,"Home",page==="index.html"),item("tests.html",I.search,"Tests",page==="tests.html"),
      item("login.html",I.user,"Login",page==="login.html")];
  if(c&&c.profile.role==="admin")items.push(item("98991/admin/dashboard.html",I.shield,"Admin",false));
  if(c&&c.profile.role==="staff")items.push(item("staff/dashboard.html",I.shield,"Staff",false));
  n.style.setProperty("--n",items.length);n.innerHTML=items.join("")}
// ---------- floating "Proceed to cart" bar (phone: above the tab bar, computer: bottom-right card) ----------
async function drawCartBar(count,bump){let bar=$("#cartBar");const page=location.pathname.split("/").pop()||"index.html";
  if(!count||["cart.html","booking.html","login.html"].includes(page)){if(bar)bar.classList.remove("show");return}
  const{data}=await sb.from("cart_items").select("tests(name,price)");const items=(data||[]).map(r=>r.tests).filter(Boolean);
  const total=items.reduce((s,t)=>s+t.price,0);
  if(!bar){bar=document.createElement("a");bar.id="cartBar";bar.className="cart-bar";bar.href="cart.html";document.body.appendChild(bar)}
  bar.setAttribute("aria-label",`Cart: ${count} ${count===1?"test":"tests"}, ${money(total)}. Proceed to cart`);
  bar.innerHTML=`<span class="cb-icon">${MNAV_ICONS.cart}<b>${count}</b></span>
    <span class="cb-text"><b>${count} ${count===1?"test":"tests"} · ${money(total)}</b><small>${esc(items.map(t=>t.name).join(", "))}</small></span>
    <span class="cb-cta">Proceed to cart<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>`;
  requestAnimationFrame(()=>bar.classList.add("show"));
  if(bump){bar.classList.remove("bump");void bar.offsetWidth;bar.classList.add("bump")}}
let _flipTimer,_lastCartCount=null;
async function initNav(){const el=$("#navAuth");const hero=$("#heroAuth");const c=await me();
  clearInterval(_flipTimer);
  if(!c){
    if(el){el.innerHTML='<a class="btn flipbtn" id="authFlip" href="login.html?mode=signup"><span>Sign up</span></a>';
      let signup=true;const btn=$("#authFlip"),label=btn.querySelector("span");
      _flipTimer=setInterval(()=>{signup=!signup;btn.classList.add("flip");
        setTimeout(()=>{label.textContent=signup?"Sign up":"Login";btn.href=signup?"login.html?mode=signup":"login.html"},150);
        setTimeout(()=>btn.classList.remove("flip"),300)},2000)}
    if(hero)hero.innerHTML='<a class="btn green" href="login.html?mode=signup">Create account</a> <a class="btn light" href="login.html">Login</a>';
    if(el)drawMobileNav(null);$("#cartBar")?.classList.remove("show");
    return}
  if(hero)hero.innerHTML="";
  if(!el)return;
  const{count}=await sb.from("cart_items").select("*",{count:"exact",head:true});const r=c.profile.role;
  const bump=_lastCartCount!==null&&count>_lastCartCount;_lastCartCount=count;drawMobileNav(c,count);drawCartBar(count,bump);
  const cartIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>';
  const bookIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="4" rx="1"></rect><path d="M9 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-4"></path><path d="M9 14l2 2 4-4"></path></svg>';
  const userIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"></circle><path d="M4 21c0-4 4-7 8-7s8 3 8 7"></path></svg>';
  el.innerHTML=`<a href="cart.html" class="navpill cart">${cartIcon}Cart${count?`<span class="navbadge${bump?" bump":""}">${count}</span>`:""}</a><a href="account.html" class="navpill">${bookIcon}My Bookings</a><a href="profile.html" class="navpill">${userIcon}My Account</a>${r==="admin"?'<a href="98991/admin/dashboard.html">Admin</a>':""}${r==="staff"?'<a href="staff/dashboard.html">Staff</a>':""}<a class="btn" href="#" id="logout">Logout</a>`;
  $("#logout").onclick=async e=>{e.preventDefault();await sb.auth.signOut();location.href="index.html"}}
function initLogin(){const f=$("#authForm");if(!f)return;const qs=new URLSearchParams(location.search);let signup=qs.get("mode")==="signup";
  if(qs.get("confirmed")&&!_authErr)setTimeout(async()=>{const{data:{session}}=await sb.auth.getSession();
    if(session){toast("Email confirmed! You're logged in.");setTimeout(()=>location.href="index.html",1300)}},400);
  const sync=()=>{$("#signupFields").hidden=!signup;$("#authTitle").textContent=signup?"Create your account":"Welcome back";$("#authBtn").textContent=signup?"Sign up":"Login";
    $("#toggle").textContent=signup?"Already have an account? Login":"New here? Create an account";f.name.required=f.phone.required=signup};sync();
  $("#toggle").onclick=e=>{e.preventDefault();signup=!signup;sync()};
  // Google popup sign-in (preferred): Google's own button opens a small popup, the user picks an account,
  // and we sign them in to Supabase with the ID token Google returns. Falls back to the redirect button below.
  const gSlot=$("#googleGsiBtn");
  if(gSlot&&typeof GOOGLE_CLIENT_ID!=="undefined"&&GOOGLE_CLIENT_ID){
    const raw=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    const setup=async()=>{
      const hashed=[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(raw)))].map(b=>b.toString(16).padStart(2,"0")).join("");
      google.accounts.id.initialize({client_id:GOOGLE_CLIENT_ID,nonce:hashed,ux_mode:"popup",auto_select:false,itp_support:true,context:"signin",
        callback:async resp=>{
          const{data,error}=await sb.auth.signInWithIdToken({provider:"google",token:resp.credential,nonce:raw});
          if(error)return fail(error);
          // Fill the name from Google if the profile doesn't have one yet.
          const m=data.user?.user_metadata||{},name=m.full_name||m.name;
          if(name){const{data:p}=await sb.from("profiles").select("full_name").eq("id",data.user.id).single();
            if(p&&!p.full_name)await sb.from("profiles").update({full_name:name}).eq("id",data.user.id)}
          toast("Signed in with Google");location.href=qs.get("next")||"index.html"}});
      google.accounts.id.renderButton(gSlot,{type:"standard",theme:"outline",size:"large",text:"continue_with",shape:"rectangular",logo_alignment:"center",
        width:Math.max(200,Math.min(400,gSlot.parentElement.clientWidth))});
      gSlot.hidden=false;$("#googleBtn").hidden=true};
    // Google's script loads in the background; wait up to ~6s for it, else keep the redirect button.
    let tries=0;const wait=()=>{if(window.google?.accounts?.id)setup().catch(e=>console.warn("Google popup sign-in unavailable:",e));else if(++tries<60)setTimeout(wait,100)};wait()}
  // Google sign-in (backup: full-page redirect): same button for new and returning users. Supabase sends them to Google,
  // then back to `next` (or the home page) already logged in. The account is created on first use.
  const g=$("#googleBtn");if(g)g.onclick=async()=>{g.disabled=true;g.querySelector("span").textContent="Opening Google...";
    const back=new URL(qs.get("next")||"index.html",location.href).href;
    const{error}=await sb.auth.signInWithOAuth({provider:"google",options:{redirectTo:back}});
    if(error){fail(error);g.disabled=false;g.querySelector("span").textContent="Continue with Google"}};
  // Phone OTP: "Create account" mode asks name + number; "Login" mode asks number only and
  // refuses unknown numbers (so a typo doesn't silently create a second account).
  const pb=$("#phoneBtn");if(pb){const panel=$("#phonePanel");let phone="",timer;
    const phoneMode=()=>{$("#phNameWrap").hidden=!signup;$("#phoneBtnLabel").textContent=signup?"Create account with phone number":"Log in with phone number"};
    phoneMode();$("#toggle").addEventListener("click",()=>setTimeout(phoneMode));
    pb.onclick=()=>{panel.hidden=!panel.hidden;pb.classList.toggle("open",!panel.hidden);if(!panel.hidden)(signup?$("#phName"):$("#phNumber")).focus()};
    const startResend=()=>{let s=30;const a=$("#resendOtp");a.classList.add("disabled");clearInterval(timer);
      const tick=()=>{a.textContent=s>0?`Resend OTP in ${s}s`:"Resend OTP";if(s<=0){a.classList.remove("disabled");clearInterval(timer)}s--};tick();timer=setInterval(tick,1000)};
    const send=async()=>{const name=$("#phName").value.trim(),digits=$("#phNumber").value.replace(/\D/g,"");
      const email=$("#phEmail").value.trim();
      if(signup&&email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return toast("That email doesn't look right. Fix it or leave it empty.",false);
      if(signup&&!name)return toast("Please enter your name",false);
      if(digits.length!==10)return toast("Enter a valid 10-digit mobile number",false);
      phone="+91"+digits;const b=$("#sendOtpBtn");b.disabled=true;b.textContent="Sending...";
      const{error}=await sb.auth.signInWithOtp({phone,options:signup?{shouldCreateUser:true,data:{full_name:name,phone:digits,contact_email:email||null}}:{shouldCreateUser:false}});
      b.disabled=false;b.textContent="Send OTP";
      if(error){
        if(/signups? not allowed|user not found|otp_disabled/i.test(error.message)){
          toast("No account with this number yet. Enter your name to create one.",false);
          signup=true;sync();phoneMode();return $("#phName").focus()}
        if(/unsupported phone provider|phone.*(disabled|not enabled)|provider is not enabled/i.test(error.message))
          return toast("Phone login isn't switched on yet. Please use email or Google for now.",false);
        return fail(error)}
      $("#phoneStep1").hidden=true;$("#phoneStep2").hidden=false;
      $("#otpSentTo").innerHTML=`We sent a 6-digit code to <b>+91 ${digits.slice(0,5)} ${digits.slice(5)}</b>`;
      $("#phOtp").value="";$("#phOtp").focus();startResend();toast("OTP sent")};
    const verify=async()=>{const token=$("#phOtp").value.replace(/\D/g,"");if(token.length!==6)return toast("Enter the 6-digit OTP",false);
      const b=$("#verifyOtpBtn");if(b.disabled)return;b.disabled=true;b.textContent="Verifying...";
      const{data,error}=await sb.auth.verifyOtp({phone,token,type:"sms"});
      if(error){b.disabled=false;b.textContent="Verify & continue";return fail(error)}
      // Make sure the profile has a name and number (e.g. an older account that was missing them).
      const uid=data.user.id;const{data:p}=await sb.from("profiles").select("full_name,phone").eq("id",uid).single();
      if(p&&(!p.full_name||!p.phone))await sb.from("profiles").update({full_name:p.full_name||$("#phName").value.trim(),phone:p.phone||phone.slice(3)}).eq("id",uid);
      location.href=qs.get("next")||"index.html"};
    $("#sendOtpBtn").onclick=send;$("#verifyOtpBtn").onclick=verify;
    $("#resendOtp").onclick=e=>{e.preventDefault();if(!e.target.classList.contains("disabled"))send()};
    $("#changeNumber").onclick=e=>{e.preventDefault();clearInterval(timer);$("#phoneStep2").hidden=true;$("#phoneStep1").hidden=false;$("#phNumber").focus()};
    $("#phNumber").addEventListener("keydown",e=>{if(e.key==="Enter")send()});
    $("#phOtp").addEventListener("keydown",e=>{if(e.key==="Enter")verify()});
    $("#phOtp").addEventListener("input",e=>{if(e.target.value.replace(/\D/g,"").length===6)verify()})}
  f.onsubmit=async e=>{e.preventDefault();const b=$("#authBtn");b.disabled=true;
    try{if(signup){const{data,error}=await sb.auth.signUp({email:f.email.value,password:f.password.value,options:{emailRedirectTo:new URL("login.html?confirmed=1",location.href).href,data:{full_name:f.name.value,phone:f.phone.value}}});if(error)throw error;
        if(!data.session){toast("Account created. Check your email to confirm, then login.");b.disabled=false;return}}
      else{const{error}=await sb.auth.signInWithPassword({email:f.email.value,password:f.password.value});
        if(error&&/email not confirmed/i.test(error.message)){
          const{error:rErr}=await sb.auth.resend({type:"signup",email:f.email.value,options:{emailRedirectTo:new URL("login.html?confirmed=1",location.href).href}});
          toast(rErr?"Please confirm your email first. Check your inbox (and spam) for the link.":`Your email isn't confirmed yet. We've sent a fresh link to ${f.email.value}.`,!!rErr===false);b.disabled=false;return}
        if(error)throw error}
      location.href=qs.get("next")||"index.html"}catch(err){fail(err);b.disabled=false}}}
function initStaffLogin(){const f=$("#staffForm");if(!f)return;
  f.onsubmit=async e=>{e.preventDefault();const{error}=await sb.auth.signInWithPassword({email:f.email.value,password:f.password.value});if(error)return fail(error);
    _ctx=null;const c=await me();if(!c||!["staff","admin"].includes(c.profile.role)){await sb.auth.signOut();return toast("This account is not a staff account")}location.href="dashboard.html"}}
function initAdminLogin(){const f=$("#adminForm");if(!f)return;
  f.onsubmit=async e=>{e.preventDefault();const{error}=await sb.auth.signInWithPassword({email:f.email.value,password:f.password.value});if(error)return fail(error);
    _ctx=null;const c=await me();if(!c||c.profile.role!=="admin"){await sb.auth.signOut();return toast("This account is not an admin account")}location.href="dashboard.html"}}

// ---------- hero tagline ----------
const TAGLINES=["Diagnostic tests.<br>Better prices. At home.","Accurate reports.<br>Zero lab visits.","Book in minutes.<br>Results you can trust.","Home sample collection.<br>Hassle-free healthcare."];
function initTagline(){const h1=$("#tagline");if(!h1)return;let i=0;
  setInterval(()=>{const span=h1.querySelector("span");span.classList.add("out");
    setTimeout(()=>{i=(i+1)%TAGLINES.length;span.innerHTML=TAGLINES[i];span.classList.remove("out")},400)},3000)}

// ---------- tests + cart ----------
let TESTS=[],CART_IDS=new Set();
const CART_ICON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>';
const CHECK_ICON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 12 9 18 20 6"></polyline></svg>';
const addBtn=(id,inCart)=>inCart?`<button class="light addbtn added" data-add="${id}" disabled>${CHECK_ICON}<span>In cart</span></button>`:`<button class="light addbtn" data-add="${id}">${CART_ICON}<span>Add to cart</span></button>`;
// Prep/fasting instruction line, shown wherever a test appears.
const prepLine=txt=>txt?`<div class="prep-line"><b>Before the test:</b> ${esc(txt)}</div>`:"";
function renderTests(filter="",cat="All"){const root=$("#testGrid");if(!root)return;
  const list=TESTS.filter(t=>(t.name+" "+t.category).toLowerCase().includes(filter.toLowerCase())&&(cat==="All"||t.category===cat));
  root.innerHTML=list.length?list.map(t=>`<article class="test"><div class="test-top"><div><h3>${esc(t.name)}</h3><small class="muted">${esc(t.category)} · ${esc(t.sample)} sample · ${esc(t.turnaround)}</small>${prepLine(t.instructions)}</div><div><div class="price">${money(t.price)}</div>${t.mrp>t.price?`<div class="mrp">MRP ${money(t.mrp)}</div>`:""}</div></div><div class="lab"><div><span>Report in ${esc(t.turnaround)} · Home collection</span></div>${addBtn(t.id,CART_IDS.has(t.id))}</div></article>`).join(""):`<div class="empty" style="grid-column:1/-1">Not in our popular tests. <a href="tests.html?q=${encodeURIComponent(filter)}"><b>Search all tests for “${esc(filter)}” →</b></a></div>`}
async function initHome(){if(!$("#testGrid"))return;let{data,error}=await sb.from("tests").select("*").eq("active",true).eq("trending",true).order("id");
  if(error&&/trending/.test(error.message))({data,error}=await sb.from("tests").select("*").eq("active",true).order("id"));if(error)return fail(error);TESTS=data;
  sb.from("tests").select("id",{count:"exact",head:true}).eq("active",true).then(({count})=>{if(count>TESTS.length)document.querySelectorAll("[data-total-tests]").forEach(el=>el.textContent=count)});
  const c=await me();if(c){const{data:ci}=await sb.from("cart_items").select("test_id");CART_IDS=new Set((ci||[]).map(x=>x.test_id))}
  renderTests();
  const cur=()=>$(".chip.active")?.dataset.cat||"All";
  $("#searchInput").addEventListener("input",e=>renderTests(e.target.value,cur()));
  document.querySelectorAll(".chip").forEach(c=>c.addEventListener("click",()=>{document.querySelectorAll(".chip").forEach(x=>x.classList.remove("active"));c.classList.add("active");renderTests($("#searchInput").value,c.dataset.cat)}));
  bindAddToCart($("#testGrid"),"index.html")}
// Add-to-cart buttons ([data-add]) inside any container. Used by the home page and the All tests page.
function bindAddToCart(box,next,onAdd){box.addEventListener("click",async e=>{const b=e.target.closest("[data-add]");if(!b||b.classList.contains("added"))return;
  const c=await me();if(!c){location.href="login.html?next="+encodeURIComponent(next);return}
  const id=+b.dataset.add;b.disabled=true;b.classList.add("pop");
  const{error}=await sb.from("cart_items").upsert({user_id:c.user.id,test_id:id},{onConflict:"user_id,test_id",ignoreDuplicates:true});
  if(error){b.disabled=false;b.classList.remove("pop");return fail(error)}
  CART_IDS.add(id);b.classList.add("added");b.innerHTML=`${CHECK_ICON}<span>In cart</span>`;
  toast("Added to cart");initNav();onAdd&&onAdd()})}

// ---------- All tests catalogue (tests.html) ----------
const CAT_ICO={drop:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.7s6 6.4 6 11.1a6 6 0 0 1-12 0C6 9.1 12 2.7 12 2.7z"/></svg>',
  clock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  filter:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M7 12h10M10 18h4"/></svg>',
  star:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z"/></svg>',
  x:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>'};
const CAT_PRICES=[["any","Any price"],["0-500","Under ₹500"],["500-1000","₹500 – ₹1,000"],["1000-3000","₹1,000 – ₹3,000"],["3000-","Above ₹3,000"]];
const CAT_TATS=[["any","Any time"],["day","Same day"],["24","Within 24 hours"],["48","Within 2 days"],["long","More than 2 days"]];
const CAT_SORTS=[["popular","Popular first"],["az","Name: A to Z"],["low","Price: low to high"],["high","Price: high to low"],["fast","Fastest report"]];
const catNorm=s=>String(s||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const CAT_SYN={sugar:"glucose",diabetes:"diabetes glucose hba1c",kft:"kidney",rft:"kidney",lft:"liver",vit:"vitamin",typhoid:"typhi widal",tb:"tuberculosis afb",pregnancy:"pregnancy hcg",cholesterol:"cholesterol lipid",thyroid:"thyroid tsh",cbc:"complete blood count"};
async function initCatalog(){const list=$("#catList");if(!list)return;
  const P=new URLSearchParams(location.search);
  const st={q:P.get("q")||"",cat:P.get("cat")||"",samples:new Set(),price:"any",tat:"any",letter:"",sort:"popular",shown:30};
  list.innerHTML='<div class="cat-skel"></div>'.repeat(6);
  const{data,error}=await sb.from("tests").select("*").eq("active",true).order("name");if(error){list.innerHTML="";return fail(error)}
  const all=data.map(t=>{const n=catNorm(`${t.name} ${t.category} ${t.sample}`);return{...t,hay:n+" "+n.replace(/ /g,""),first:/^[a-z]/i.test(t.name.trim())?t.name.trim()[0].toUpperCase():"#",tat:t.tat_minutes??tatGuess(t.turnaround)}});
  TESTS=all;const c=await me();if(c){const{data:ci}=await sb.from("cart_items").select("test_id");CART_IDS=new Set((ci||[]).map(x=>x.test_id))}
  $("#catSearch").placeholder=`Search ${all.length} tests by name, organ or condition…`;$("#catSearch").value=st.q;
  $("#catTotal").textContent=all.length;
  function tatGuess(s){s=String(s||"").toLowerCase();const n=parseFloat(s)||1;return/same/.test(s)?360:/hour/.test(s)?n*60:/day/.test(s)?n*1440:1440}
  const words=q=>catNorm(q).split(" ").filter(Boolean).map(w=>CAT_SYN[w]?CAT_SYN[w].split(" "):[w]);
  const matchQ=(t,ws)=>ws.every(alts=>alts.some(w=>t.hay.includes(w)));
  const inPrice=t=>{if(st.price==="any")return true;const[a,b]=st.price.split("-");return t.price>=+a&&(!b||t.price<+b)};
  const inTat=t=>({any:1,day:t.tat<=480,"24":t.tat<=1440,"48":t.tat<=2880,long:t.tat>2880})[st.tat];
  // filter with everything except one dimension (for live counts next to each option)
  let W=[];const pass=(t,skip)=>{return(skip==="q"||matchQ(t,W))&&(skip==="cat"||!st.cat||t.category===st.cat)&&(skip==="sample"||!st.samples.size||st.samples.has(t.sample))&&(skip==="price"||inPrice(t))&&(skip==="tat"||inTat(t))&&(skip==="letter"||!st.letter||t.first===st.letter)};
  const sorters={popular:(a,b)=>(b.trending-a.trending)||a.name.localeCompare(b.name),az:(a,b)=>a.name.localeCompare(b.name),low:(a,b)=>a.price-b.price||a.name.localeCompare(b.name),high:(a,b)=>b.price-a.price||a.name.localeCompare(b.name),fast:(a,b)=>a.tat-b.tat||a.name.localeCompare(b.name)};
  const counts=(skip,key)=>{const m={};all.forEach(t=>{if(pass(t,skip)){const k=key(t);m[k]=(m[k]||0)+1}});return m};
  const cats=[...new Set(all.map(t=>t.category))].sort((a,b)=>a==="Other tests"?1:b==="Other tests"?-1:a.localeCompare(b));
  const samples=Object.entries(all.reduce((m,t)=>(m[t.sample]=(m[t.sample]||0)+1,m),{})).sort((a,b)=>b[1]-a[1]).map(([s])=>s);
  const QUICK=["Thyroid","Diabetes","Fever (Dengue, Malaria, Typhoid)","Vitamins & Minerals","Heart & Cholesterol","Liver & Pancreas","Kidney","Hormones","Pregnancy & Fertility","Allergy"].filter(c=>cats.includes(c));
  const short=c=>c.replace(/ \(.*\)/,"");
  function drawSide(){const cc=counts("cat",t=>t.category),sc=counts("sample",t=>t.sample),total=all.filter(t=>pass(t,"cat")).length;
    const pc=k=>all.filter(t=>pass(t,"price")&&(k==="any"||(()=>{const[a,b]=k.split("-");return t.price>=+a&&(!b||t.price<+b)})())).length;
    const tc=k=>all.filter(t=>pass(t,"tat")&&({any:1,day:t.tat<=480,"24":t.tat<=1440,"48":t.tat<=2880,long:t.tat>2880})[k]).length;
    $("#catSideBody").innerHTML=`<div class="cs-group"><h4>Category</h4><div class="cs-cats">
        <button type="button" class="cs-opt${!st.cat?" on":""}" data-cat=""><span>All categories</span><small>${total}</small></button>
        ${cats.map(c=>`<button type="button" class="cs-opt${st.cat===c?" on":""}" data-cat="${esc(c)}"${!cc[c]?" disabled":""}><span>${esc(c)}</span><small>${cc[c]||0}</small></button>`).join("")}</div></div>
      <div class="cs-group"><h4>Sample type</h4>${samples.map((s,i)=>`<label class="cs-check${i>5?" cs-extra":""}"${i>5&&!st.moreS?" hidden":""}><input type="checkbox" data-sample="${esc(s)}"${st.samples.has(s)?" checked":""}><span>${esc(s)}</span><small>${sc[s]||0}</small></label>`).join("")}
        ${samples.length>6?`<button type="button" class="cs-link" data-more-s>${st.moreS?"Show fewer":`Show all ${samples.length}`}</button>`:""}</div>
      <div class="cs-group"><h4>Price</h4>${CAT_PRICES.map(([k,l])=>`<label class="cs-check"><input type="radio" name="csPrice" data-price="${k}"${st.price===k?" checked":""}><span>${l}</span><small>${pc(k)}</small></label>`).join("")}</div>
      <div class="cs-group"><h4>Report time</h4>${CAT_TATS.map(([k,l])=>`<label class="cs-check"><input type="radio" name="csTat" data-tat="${k}"${st.tat===k?" checked":""}><span>${l}</span><small>${tc(k)}</small></label>`).join("")}</div>`}
  function drawAZ(){const lc=counts("letter",t=>t.first);
    $("#catAZ").innerHTML=`<button type="button" data-letter=""${!st.letter?' class="on"':""}>All</button>`+["#",..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map(l=>`<button type="button" data-letter="${l}"${st.letter===l?' class="on"':""}${!lc[l]?" disabled":""}>${l}</button>`).join("")}
  function drawActive(){const chips=[];if(st.q)chips.push(["q",`“${st.q}”`]);if(st.cat)chips.push(["cat",short(st.cat)]);st.samples.forEach(s=>chips.push(["s:"+s,s+" sample"]));
    if(st.price!=="any")chips.push(["price",CAT_PRICES.find(p=>p[0]===st.price)[1]]);if(st.tat!=="any")chips.push(["tat",CAT_TATS.find(p=>p[0]===st.tat)[1]]);if(st.letter)chips.push(["letter","Starts with "+st.letter]);
    $("#catActive").innerHTML=chips.length?chips.map(([k,l])=>`<button type="button" class="cat-chip" data-clear="${esc(k)}">${esc(l)}${CAT_ICO.x}</button>`).join("")+`<button type="button" class="cs-link" data-clear="all">Clear all</button>`:"";
    const n=chips.length-(st.q?1:0);$("#catFilterBtn").innerHTML=`${CAT_ICO.filter}Filters${n?` <b>${n}</b>`:""}`;
    document.querySelectorAll("[data-quick]").forEach(b=>b.classList.toggle("on",b.dataset.quick===st.cat))}
  const row=t=>`<article class="cat-row"><div class="cat-main"><h3>${esc(t.name)}${t.trending?`<span class="cat-pop">${CAT_ICO.star}Popular</span>`:""}</h3>
      <div class="cat-meta"><button type="button" class="cat-tag" data-cat="${esc(t.category)}">${esc(t.category)}</button><span>${CAT_ICO.drop}${esc(t.sample)} sample</span><span>${CAT_ICO.clock}Report: ${esc(t.turnaround)}</span></div>${prepLine(t.instructions)}</div>
    <div class="cat-buy"><div class="cat-price"><b>${money(t.price)}</b>${t.mrp>t.price?`<s>${money(t.mrp)}</s><em>${Math.round((1-t.price/t.mrp)*100)}% off</em>`:""}</div>${addBtn(t.id,CART_IDS.has(t.id))}</div></article>`;
  function draw(keepShown){if(!keepShown)st.shown=30;W=words(st.q);const res=all.filter(t=>pass(t)).sort(sorters[st.sort]);
    $("#catCount").innerHTML=`<b>${res.length}</b> ${res.length===1?"test":"tests"}${st.cat?` in ${esc(short(st.cat))}`:""}`;
    list.innerHTML=res.length?res.slice(0,st.shown).map(row).join(""):`<div class="cat-empty"><b>No tests match${st.q?` “${esc(st.q)}”`:" these filters"}.</b><span>Try a different spelling or fewer filters. Can't find your test? Call us and we'll check if the lab can do it.</span>
      <div class="cat-empty-acts"><button type="button" class="light" data-clear="all">Clear filters</button>${typeof BUSINESS!=="undefined"&&BUSINESS.phone?`<a class="btn green" href="tel:${BUSINESS.phone.replace(/\s/g,"")}">Call the lab</a>`:""}</div></div>`;
    const more=$("#catMore");more.hidden=res.length<=st.shown;more.textContent=`Show more tests (${Math.min(st.shown,res.length)} of ${res.length})`;
    drawSide();drawAZ();drawActive();
    const u=new URL(location.href);u.searchParams.delete("q");u.searchParams.delete("cat");if(st.q)u.searchParams.set("q",st.q);if(st.cat)u.searchParams.set("cat",st.cat);history.replaceState(null,"",u)}
  function drawCartBar(){const n=CART_IDS.size,bar=$("#catCartBar");bar.hidden=!n;bar.querySelector("span").textContent=`${n} ${n===1?"test":"tests"} in your cart`}
  // quick category chips in the hero
  $("#catQuick").innerHTML=QUICK.map(c=>`<button type="button" data-quick="${esc(c)}">${esc(short(c))}</button>`).join("");
  $("#catSort").innerHTML=CAT_SORTS.map(([k,l])=>`<option value="${k}">${l}</option>`).join("");
  // events
  let tm;$("#catSearch").addEventListener("input",e=>{clearTimeout(tm);tm=setTimeout(()=>{st.q=e.target.value.trim();draw()},140)});
  $("#catSearchForm").addEventListener("submit",e=>{e.preventDefault();st.q=$("#catSearch").value.trim();draw();$("#catResults").scrollIntoView({behavior:"smooth",block:"start"})});
  $("#catSort").addEventListener("change",e=>{st.sort=e.target.value;draw()});
  $("#catMore").addEventListener("click",()=>{st.shown+=30;draw(true)});
  const setCat=c=>{st.cat=st.cat===c&&c?"":c;draw()};
  document.addEventListener("click",e=>{const t=e.target.closest("[data-cat],[data-quick],[data-letter],[data-clear],[data-more-s],[data-close-filters],#catFilterBtn");if(!t||t.disabled)return;
    if(t.id==="catFilterBtn"){document.body.classList.add("cat-filters-open");return}
    if(t.hasAttribute("data-close-filters")){document.body.classList.remove("cat-filters-open");return}
    if(t.hasAttribute("data-more-s")){st.moreS=!st.moreS;drawSide();return}
    if(t.dataset.quick!==undefined){setCat(t.dataset.quick);$("#catResults").scrollIntoView({behavior:"smooth",block:"start"});return}
    if(t.dataset.cat!==undefined){st.cat=t.dataset.cat;draw();if(t.classList.contains("cat-tag"))$("#catResults").scrollIntoView({behavior:"smooth",block:"start"});return}
    if(t.dataset.letter!==undefined){st.letter=t.dataset.letter;draw();return}
    const k=t.dataset.clear;if(k==="all"){Object.assign(st,{q:"",cat:"",price:"any",tat:"any",letter:""});st.samples.clear();$("#catSearch").value=""}
    else if(k==="q"){st.q="";$("#catSearch").value=""}else if(k==="cat")st.cat="";else if(k==="price")st.price="any";else if(k==="tat")st.tat="any";else if(k==="letter")st.letter="";else if(k.startsWith("s:"))st.samples.delete(k.slice(2));draw()});
  $("#catSideBody").addEventListener("change",e=>{const i=e.target;if(i.dataset.sample!==undefined)i.checked?st.samples.add(i.dataset.sample):st.samples.delete(i.dataset.sample);
    else if(i.dataset.price)st.price=i.dataset.price;else if(i.dataset.tat)st.tat=i.dataset.tat;draw()});
  document.addEventListener("keydown",e=>{if(e.key==="Escape")document.body.classList.remove("cat-filters-open");
    if(e.key==="/"&&!/input|textarea|select/i.test(document.activeElement.tagName)){e.preventDefault();$("#catSearch").focus()}});
  bindAddToCart(list,"tests.html"+location.search,drawCartBar);
  draw();drawCartBar()}
const getCart=async()=>{const{data,error}=await sb.from("cart_items").select("test_id,tests(*)");if(error)throw error;return data.map(r=>r.tests)};
async function initCart(){const root=$("#cartItems");if(!root||!await guard())return;
  const draw=async()=>{const items=await getCart();const total=items.reduce((s,t)=>s+t.price,0),mrp=items.reduce((s,t)=>s+t.mrp,0);
    root.innerHTML=items.length?items.map(t=>`<div class="test" style="margin-bottom:10px"><div class="test-top"><div><h3>${esc(t.name)}</h3><small class="muted">Report in ${esc(t.turnaround)}</small>${prepLine(t.instructions)}</div><div><div class="price">${money(t.price)}</div><button class="light" data-rm="${t.id}" style="margin-top:6px;padding:6px 10px;font-size:12px">Remove</button></div></div></div>`).join(""):`<div class="empty">Your cart is empty. <a href="index.html#tests"><b>Browse tests</b></a></div>`;
    $("#cartTotal").innerHTML=items.length?`<div class="mrp" style="text-align:left">MRP ${money(mrp)} · You save ${money(mrp-total)}</div><div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0 16px"><b>Total</b><span class="price">${money(total)}</span></div><a class="btn green" style="width:100%" href="booking.html">Proceed to booking</a>`:"";initNav()};
  root.addEventListener("click",async e=>{const b=e.target.closest("[data-rm]");if(!b)return;const{error}=await sb.from("cart_items").delete().eq("test_id",+b.dataset.rm);if(error)return fail(error);draw()});draw().catch(fail)}

// ---------- saved addresses (used on the booking page) ----------
function renderAddresses(list,f){const root=$("#savedAddresses"),newForm=$("#newAddressForm");let selectedId=list.length?list[0].id:null;
  const draw=()=>{root.innerHTML=list.map(a=>{const sel=a.id===selectedId;
      return`<div class="addr-card${sel?" selected":""}" data-id="${a.id}"><div class="addr-card-main"><b>${esc(a.label||"Saved address")}</b><div class="muted" style="font-size:12.5px;margin-top:3px">${esc(a.address)}, ${esc(a.area)}</div></div><div class="addr-card-actions"><button type="button" class="addr-select-btn${sel?" selected":""}" data-select="${a.id}">${sel?`${CHECK_ICON}<span>Selected</span>`:"<span>Select</span>"}</button><button type="button" class="addr-del" data-del="${a.id}" aria-label="Delete address">✕</button></div></div>`}).join("")
      +`<div class="addr-card addr-new${selectedId===null?" selected":""}" data-id="new"><div class="addr-card-main"><b>+ Add new address</b></div></div>`;
    newForm.hidden=selectedId!==null;
    // Hidden fields must be disabled, or their "required" blocks the form submit silently.
    newForm.querySelectorAll("input,textarea,button").forEach(el=>el.disabled=newForm.hidden)};
  draw();
  root.onclick=async e=>{const del=e.target.closest("[data-del]");
    if(del){e.stopPropagation();const{error}=await sb.from("addresses").delete().eq("id",del.dataset.del);if(error)return fail(error);
      list=list.filter(a=>a.id!==del.dataset.del);if(selectedId===del.dataset.del)selectedId=list[0]?.id??null;draw();return}
    const card=e.target.closest("[data-id]");if(!card)return;selectedId=card.dataset.id==="new"?null:card.dataset.id;draw()};
  return{getSelected:()=>selectedId?list.find(a=>a.id===selectedId):null}}
// ---------- razorpay online payment (shared: booking page + "Pay now" retry) ----------
function payOnline(bookingId,prefill={}){
  return new Promise(async resolve=>{
    const{data,error}=await sb.functions.invoke("razorpay-create-order",{body:{booking_id:bookingId}});
    if(error||data?.error){fail(error||new Error(data.error));return resolve(false)}
    if(typeof Razorpay==="undefined"){toast("Payment widget failed to load — check your connection");return resolve(false)}
    const rp=new Razorpay({key:data.key_id,amount:data.amount,currency:data.currency,order_id:data.order_id,
      name:"LabMitra",description:`Booking ${data.ref}`,prefill,theme:{color:"#1d70b7"},
      handler:async resp=>{
        const{data:v,error:vErr}=await sb.functions.invoke("razorpay-verify-payment",{body:{booking_id:bookingId,razorpay_order_id:resp.razorpay_order_id,razorpay_payment_id:resp.razorpay_payment_id,razorpay_signature:resp.razorpay_signature}});
        if(vErr||v?.error){fail(vErr||new Error(v.error));return resolve(false)}
        toast("Payment successful");resolve(true)},
      modal:{ondismiss:()=>{toast("Payment cancelled — you can pay later from My Bookings");resolve(false)}}});
    rp.open()})}

// ---------- family members: "Who is this test for?" on the booking page ----------
const RELATIONS=["Father","Mother","Spouse","Son","Daughter","Baby / Newborn","Grandfather","Grandmother","Brother","Sister","Other"];
const AGE_MAX={years:120,months:24,days:90};
const ageUnitOpts=sel=>["years","months","days"].map(u=>`<option value="${u}"${u===sel?" selected":""}>${u[0].toUpperCase()+u.slice(1)}</option>`).join("");
function memberPicker(f,c){const root=$("#memberPicker");if(!root)return{selected:()=>null};let members=[],sel="self";
  const fill=()=>{const m=members.find(x=>x.id===sel);
    if(!m){f.name.value=c.profile.full_name||"";f.phone.value=c.profile.phone||"";f.age.value=c.profile.age??"";f.ageUnit.value="years";f.gender.value=c.profile.gender||""}
    else{f.name.value=m.name;f.phone.value=m.phone||c.profile.phone||"";f.age.value=m.age??"";f.ageUnit.value=m.age_unit||"years";f.gender.value=m.gender||""}
    f.age.max=AGE_MAX[f.ageUnit.value]};
  const chip=(id,title,sub,del)=>`<div class="member-chip${sel===id?" selected":""}" data-member="${id}" role="button" tabindex="0" aria-pressed="${sel===id}"><b>${esc(title)}</b><small>${esc(sub)}</small>${del?`<button type="button" class="member-del" data-del-member="${id}" aria-label="Remove ${esc(title)}">✕</button>`:""}</div>`;
  const draw=()=>{root.innerHTML=chip("self","Myself",c.profile.full_name||"You",false)
    +members.map(m=>chip(m.id,m.name,[m.relation,ageText(m.age,m.age_unit)].filter(Boolean).join(" · "),true)).join("")
    +'<div class="member-chip add" data-add-member role="button" tabindex="0"><b>+ Add a member</b><small>Parent, child, newborn…</small></div>'};
  // "Save changes": write what's typed back to the profile (Myself) or to the saved member.
  const stored=()=>{const m=members.find(x=>x.id===sel);
    return m?{name:m.name||"",phone:m.phone||"",age:m.age??"",unit:m.age_unit||"years",gender:m.gender||""}
            :{name:c.profile.full_name||"",phone:c.profile.phone||"",age:c.profile.age??"",unit:"years",gender:c.profile.gender||""}};
  const current=()=>({name:f.name.value.trim(),phone:f.phone.value.replace(/[^\d]/g,""),age:f.age.value===""?"":+f.age.value,unit:f.ageUnit.value,gender:f.gender.value});
  const differs=()=>{const a=stored(),b=current();return a.name!==b.name||String(a.phone).replace(/[^\d]/g,"")!==b.phone||String(a.age)!==String(b.age)||(sel!=="self"&&a.unit!==b.unit)||a.gender!==b.gender};
  // Autosave status under the fields: "Saving…" → "✓ Saved to your profile".
  let saveT,hideT;
  const setStatus=(state,msg)=>{const bar=$("#savePerson");if(!bar)return;clearTimeout(hideT);
    bar.hidden=!state;bar.dataset.state=state||"";$("#savePersonText").textContent=msg||"";
    if(state==="saved")hideT=setTimeout(()=>{bar.hidden=true},2500)};
  const updateBar=()=>{};
  const savePerson=async quiet=>{const v=current(),m=members.find(x=>x.id===sel);
    if(!v.name){if(!quiet)toast("Enter a name first",false);return false}
    if(v.phone&&(v.phone.length<10||v.phone.length>13)){if(!quiet)toast("Enter a valid mobile number",false);return false}
    if(v.age!==""&&(v.age<0||v.age>AGE_MAX[v.unit])){if(!quiet)toast(`Age must be 0–${AGE_MAX[v.unit]} ${v.unit}`,false);return false}
    if(m){const patch={name:v.name,phone:v.phone||null,age:v.age===""?null:v.age,age_unit:v.unit,gender:v.gender||null};
      const{error}=await sb.from("members").update(patch).eq("id",m.id);if(error){if(!quiet)fail(error);return false}
      Object.assign(m,patch)}
    else{// Your own profile stores age in years only.
      const patch={full_name:v.name,phone:v.phone||null,gender:v.gender||null};if(v.unit==="years")patch.age=v.age===""?null:v.age;
      const{error}=await sb.from("profiles").update(patch).eq("id",c.user.id);if(error){if(!quiet)fail(error);return false}
      Object.assign(c.profile,patch)}
    draw();if(!quiet)toast(m?`${v.name}'s details saved`:"Saved to your profile");return true};
  // Save a moment after the person stops typing (straight away for dropdowns). Incomplete details wait quietly.
  const runSave=async()=>{saveT=null;if(!differs())return setStatus();
    const m=members.find(x=>x.id===sel),who=m?`${m.name}'s details`:"your profile";
    setStatus("saving","Saving…");
    if(await savePerson(true))setStatus("saved",`✓ Saved to ${who}`);
    else setStatus("waiting","Will save once the mobile number and age are complete")};
  const scheduleSave=delay=>{clearTimeout(saveT);if(!differs())return setStatus();setStatus("saving","Saving…");saveT=setTimeout(runSave,delay)};
  ["name","phone","age"].forEach(n=>{f[n].addEventListener("input",()=>scheduleSave(1200));f[n].addEventListener("blur",()=>{if(saveT){clearTimeout(saveT);runSave()}})});
  ["ageUnit","gender"].forEach(n=>f[n].addEventListener("change",()=>scheduleSave(300)));
  // Switching person: finish any pending save for the previous one first.
  const pick=async id=>{if(saveT){clearTimeout(saveT);await runSave()}sel=id;draw();fill();setStatus()};
  const addDialog=()=>{const body=openModal("Add a family member",`<div class="form-grid">
      <div><label>Full name</label><input id="mmName" placeholder="e.g. Kamla Devi"></div>
      <div><label>Relation</label><select id="mmRel">${RELATIONS.map(r=>`<option>${r}</option>`).join("")}</select></div>
      <div><label>Age</label><div class="age-input"><input id="mmAge" type="number" min="0" max="120" inputmode="numeric" placeholder="Age"><select id="mmUnit">${ageUnitOpts("years")}</select></div></div>
      <div><label>Gender</label><select id="mmGender"><option value="">Select gender</option><option>Male</option><option>Female</option><option>Other</option></select></div></div>
      <label>Mobile number (optional)</label><input id="mmPhone" inputmode="tel" placeholder="Leave empty to use your number">
      <p class="muted" style="font-size:12px;margin:8px 0 0">For a newborn or infant, enter the age in days or months. The lab uses different normal ranges for babies.</p>
      <div class="modal-actions"><button type="button" class="light" data-close>Cancel</button><button type="button" class="green" id="mmSave">Save member</button></div>`);
    const q=s=>body.querySelector(s);
    q("#mmRel").onchange=e=>{if(e.target.value==="Baby / Newborn"&&q("#mmUnit").value==="years")q("#mmUnit").value="months"};
    q("#mmSave").onclick=async ev=>{const name=q("#mmName").value.trim(),age=q("#mmAge").value,unit=q("#mmUnit").value,gender=q("#mmGender").value,phone=q("#mmPhone").value.replace(/[^\d ]/g,"").trim();
      if(!name)return toast("Enter the member's name",false);
      if(age===""||+age<0||+age>AGE_MAX[unit])return toast(`Enter an age between 0 and ${AGE_MAX[unit]} ${unit}`,false);
      if(!gender)return toast("Select the member's gender",false);
      ev.target.disabled=true;
      const{data,error}=await sb.from("members").insert({name,relation:q("#mmRel").value,age:+age,age_unit:unit,gender,phone:phone||null}).select().single();
      if(error){ev.target.disabled=false;return fail(/members/.test(error.message)?new Error("Family members aren't set up yet. Run supabase/members_upgrade.sql in Supabase."):error)}
      members.push(data);closeModal();pick(data.id);toast(`${name} added`)}};
  const delDialog=id=>{const m=members.find(x=>x.id===id);if(!m)return;
    const body=openModal("Remove member?",`<p>Remove <b>${esc(m.name)}</b> from your saved family members? Past bookings for them are not affected.</p>
      <div class="modal-actions"><button type="button" class="light" data-close>Keep</button><button type="button" class="danger" id="mmDel">Remove</button></div>`);
    body.querySelector("#mmDel").onclick=async()=>{const{error}=await sb.from("members").delete().eq("id",id);if(error)return fail(error);
      members=members.filter(x=>x.id!==id);closeModal();if(sel===id)pick("self");else draw();toast("Member removed")}};
  root.addEventListener("click",e=>{const d=e.target.closest("[data-del-member]");if(d){e.stopPropagation();return delDialog(d.dataset.delMember)}
    if(e.target.closest("[data-add-member]"))return addDialog();
    const ch=e.target.closest("[data-member]");if(ch)pick(ch.dataset.member)});
  root.addEventListener("keydown",e=>{if((e.key==="Enter"||e.key===" ")&&e.target.matches(".member-chip")){e.preventDefault();e.target.click()}});
  f.ageUnit.addEventListener("change",()=>{f.age.max=AGE_MAX[f.ageUnit.value]});
  draw();fill();
  sb.from("members").select("*").order("created_at").then(({data})=>{members=data||[];draw()});
  // When booking for "Myself", keep the profile in sync automatically (fills a blank phone/age, e.g. Google accounts).
  return{selected:()=>sel==="self"?null:sel,syncSelf:async()=>{clearTimeout(saveT);if(differs())await savePerson(true)}}}

// ---------- booking (checkout) ----------
async function initBooking(){const f=$("#bookingForm");if(!f)return;const c=await guard();if(!c)return;
  f.date.min=today();f.name.value=c.profile.full_name||"";f.phone.value=c.profile.phone||"";
  const who=memberPicker(f,c);
  const items=await getCart().catch(e=>(fail(e),[]));
  if(!items.length){$("#selectedTest").innerHTML='<div class="notice">Your cart is empty. <a href="index.html#tests">Browse tests</a>.</div>';f.hidden=true;return}
  $("#selectedTest").innerHTML=items.map(t=>`<div class="test" style="margin-bottom:8px"><div class="test-top"><div><b>${esc(t.name)}</b><div class="muted" style="font-size:13px;margin-top:5px">Report in ${esc(t.turnaround)} · Home collection</div></div><div class="price" style="font-size:19px">${money(t.price)}</div></div></div>`).join("")+`<div style="display:flex;justify-content:space-between"><b>Total</b><span class="price">${money(items.reduce((s,t)=>s+t.price,0))}</span></div>`;
  // Prep / fasting instructions for everything in the cart.
  const prep=items.filter(t=>t.instructions);
  $("#prepNotice").innerHTML=prep.length?`<div class="prep-notice"><b>Before your sample collection</b><ul>${prep.map(t=>`<li><b>${esc(t.name)}:</b> ${esc(t.instructions)}</li>`).join("")}</ul></div>`:"";
  // Time slots: grey out slots that are full or have already started today.
  f.slot.innerHTML='<option value="">Select slot</option>'+SLOTS.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join("");
  const updateSlots=async()=>{const date=f.date.value,hint=$("#slotHint");if(!date){hint.textContent="Pick a date to see open slots.";return}
    const list=await slotAvailability(date),keep=f.slot.value;
    f.slot.innerHTML='<option value="">Select slot</option>'+list.map(s=>`<option value="${esc(s.slot)}"${s.disabled?" disabled":""}>${esc(s.label)}</option>`).join("");
    if(list.some(s=>s.slot===keep&&!s.disabled))f.slot.value=keep;
    const open=list.filter(s=>!s.disabled).length;
    hint.textContent=open?`${open} of ${list.length} slots open on this day.`:"No slots left on this day. Please pick another date."};
  f.date.addEventListener("change",updateSlots);
  const{data:addrs}=await sb.from("addresses").select("*").order("created_at",{ascending:false});
  const addrPicker=renderAddresses(addrs||[],f);
  $("#useLocationBtn").onclick=()=>{const btn=$("#useLocationBtn");
    if(!navigator.geolocation)return toast("Location isn't supported in this browser");
    btn.disabled=true;btn.querySelector("span").textContent="Locating...";
    const reset=()=>{btn.disabled=false;btn.querySelector("span").textContent="Use current location"};
    navigator.geolocation.getCurrentPosition(async pos=>{const{latitude:lat,longitude:lng}=pos.coords;
      try{const r=await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`);const j=await r.json();const a=j.address||{};
        f.area.value=a.suburb||a.neighbourhood||a.village||a.town||a.city_district||f.area.value;
        f.address.value=j.display_name||`${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        toast("Location filled in — please check it's correct")}
      catch{f.address.value=`${lat.toFixed(5)}, ${lng.toFixed(5)}`;toast("Couldn't look up the address, added coordinates instead")}
      f.dataset.lat=lat;f.dataset.lng=lng;reset()},
      err=>{toast("Couldn't get your location: "+err.message);reset()},{enableHighAccuracy:true,timeout:10000})};
  f.onsubmit=async e=>{e.preventDefault();const b=$("#confirmBtn");b.disabled=true;
    try{
      const sel=addrPicker.getSelected();let area,address,saveNew=false;
      if(sel){area=sel.area;address=sel.address}
      else{area=f.area.value.trim();address=f.address.value.trim();
        if(!area||!address){toast("Please enter the collection address");b.disabled=false;return}
        saveNew=f.saveAddr.checked}
      const method=f.paymethod.value;
      const{data,error}=await sb.rpc("place_booking",{p_name:f.name.value.trim(),p_phone:f.phone.value.trim(),p_date:f.date.value,p_slot:f.slot.value,p_area:area,p_address:address,p_payment_method:method,p_age:+f.age.value,p_age_unit:f.ageUnit.value,p_gender:f.gender.value,p_consent:f.consent.checked,p_member_id:who.selected()});
      if(error){fail(error);b.disabled=false;updateSlots();return}
      await who.syncSelf();
      if(saveNew)await sb.from("addresses").insert({label:f.addrLabel.value.trim()||null,area,address,lat:f.dataset.lat?+f.dataset.lat:null,lng:f.dataset.lng?+f.dataset.lng:null});
      if(method==="Cash")return location.href="account.html?new="+encodeURIComponent(data);
      b.textContent="Opening payment...";
      const{data:bk}=await sb.from("bookings").select("id").eq("ref",data).single();
      await payOnline(bk.id,{name:f.name.value.trim(),contact:f.phone.value.trim(),email:c.user.email});
      location.href="account.html?new="+encodeURIComponent(data)
    }catch(err){toast(err.message||"Something went wrong placing the booking",false);b.disabled=false}}}

// ---------- my account (profile + password) ----------
async function initProfile(){const info=$("#profileInfo");if(!info)return;const c=await guard();if(!c)return;
  const initials=(c.profile.full_name||c.user.email||"U").trim().split(/\s+/).map(w=>w[0]).slice(0,2).join("").toUpperCase();
  const roleLabel=c.profile.role==="patient"?"":` · <span class="pill blue">${esc(c.profile.role)}</span>`;
  info.innerHTML=`<div style="display:flex;align-items:center;gap:15px"><div class="avatar">${esc(initials)}</div><div><b style="font-size:18px">${esc(c.profile.full_name||"Your account")}</b>${roleLabel}<div class="muted" style="font-size:13px;margin-top:4px">${[c.profile.email||c.user.email,c.profile.age!=null?c.profile.age+" y":"",c.profile.gender].filter(Boolean).map(esc).join(" · ")}</div>${c.profile.created_at?`<div class="muted" style="font-size:12px;margin-top:2px">Member since ${fmt(c.profile.created_at)}</div>`:""}</div></div>`;
  const pf=$("#profileForm");pf.name.value=c.profile.full_name||"";pf.phone.value=c.profile.phone||"";
  pf.age.value=c.profile.age??"";pf.gender.value=c.profile.gender||"";
  pf.onsubmit=async e=>{e.preventDefault();const btn=$("#profileBtn");btn.disabled=true;
    const{error}=await sb.from("profiles").update({full_name:pf.name.value.trim(),phone:pf.phone.value.trim(),age:pf.age.value===""?null:+pf.age.value,gender:pf.gender.value||null}).eq("id",c.user.id);
    btn.disabled=false;if(error)return fail(error);_ctx=null;toast("Profile updated");initNav();initProfile()};
  const lo=$("#profileLogout");if(lo)lo.onclick=async()=>{await sb.auth.signOut();location.href="index.html"};
  const pw=$("#passwordForm");
  pw.onsubmit=async e=>{e.preventDefault();if(pw.password.value!==pw.confirm.value)return toast("Passwords don't match");
    const btn=$("#passwordBtn");btn.disabled=true;
    const{error}=await sb.auth.updateUser({password:pw.password.value});btn.disabled=false;
    if(error)return fail(error);pw.reset();toast("Password updated")}}

// ---------- patient: my bookings + report download ----------
const ICONS={cal:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"></rect><path d="M16 2v4M8 2v4M3 10h18"></path></svg>',
  pin:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"></path><circle cx="12" cy="10" r="3"></circle></svg>',
  user:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"></circle><path d="M4 21c0-4 4-7 8-7s8 3 8 7"></path></svg>',
  clock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 3"></path></svg>',
  dl:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4"></path><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"></path></svg>'};
const statusMeta=s=>s==="Report ready"?{cls:"green"}:s==="Cancelled"?{cls:"red"}:{cls:"amber"};
const payLabel=b=>b.payment==="Refund pending"?"Refund in progress":b.payment==="Refunded"?"Refunded":`${b.payment} · ${b.payment_method||"Cash"}`;
const canChange=b=>["Confirmed","Assigned"].includes(b.status)&&!slotStarted(b.collect_date,b.slot);
// ---------- Live tracking: shared map + helpers ----------
// Uses Google Maps when GOOGLE_MAPS_KEY is set in assets/supabase.js, otherwise free OpenStreetMap (no key needed).
const geoKm=(a,b)=>{const R=6371,r=x=>x*Math.PI/180,dLat=r(b.lat-a.lat),dLng=r(b.lng-a.lng);
  const h=Math.sin(dLat/2)**2+Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dLng/2)**2;return 2*R*Math.asin(Math.sqrt(h))};
const tripEta=km=>Math.max(1,Math.round(km*1.35/18*60)); // roads ~1.35× straight line, ~18 km/h city traffic on a two-wheeler
const kmText=km=>km<1?Math.round(km*1000/10)*10+" m":km.toFixed(1)+" km";
const agoText=t=>{const s=Math.max(0,(Date.now()-new Date(t).getTime())/1000);return s<15?"just now":s<60?Math.round(s)+" s ago":s<3600?Math.round(s/60)+" min ago":Math.round(s/3600)+" h ago"};
const SCOOTER_ICON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="17" r="2.5"/><circle cx="18.5" cy="17" r="2.5"/><path d="M8 17h7l3-7h-3"/><path d="M15 10 13 6h-3"/><path d="M5.5 14.5 8 10h5"/></svg>';
const MAP_PINS={
  rider:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44" width="44" height="44"><circle cx="22" cy="22" r="19" fill="#1d70b7" stroke="#fff" stroke-width="3"/><g fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="14.5" cy="26" r="3"/><circle cx="29.5" cy="26" r="3"/><path d="M17.5 26h8l3.5-8h-3.5M25.5 18l-2-4h-3.5M14.5 23l3-5h6"/></g></svg>',
  home:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 44" width="36" height="44"><path d="M18 42s15-14 15-25.5A15 15 0 0 0 3 16.5C3 28 18 42 18 42Z" fill="#13834e" stroke="#fff" stroke-width="2.5"/><path d="M11.5 18 18 12l6.5 6v7.5h-4.3v-4.3h-4.4v4.3h-4.3z" fill="#fff"/></svg>'};
const PIN_SIZE={rider:[44,44,22,22],home:[36,44,18,42]}; // width, height, anchor x, anchor y
const RAIPUR={lat:21.2514,lng:81.6296};
let _mapLib=null;
const loadScript=src=>new Promise((ok,no)=>{const s=document.createElement("script");s.src=src;s.async=true;s.onload=ok;s.onerror=no;document.head.appendChild(s)});
function mapLib(){if(_mapLib)return _mapLib;const key=typeof GOOGLE_MAPS_KEY==="string"?GOOGLE_MAPS_KEY.trim():"";
  _mapLib=key?new Promise((ok,no)=>{window.__lmGmapsReady=()=>ok("google");loadScript(`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=__lmGmapsReady&loading=async`).catch(no)})
    :(()=>{const l=document.createElement("link");l.rel="stylesheet";l.href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";document.head.appendChild(l);
      return loadScript("https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js").then(()=>"leaflet")})();
  _mapLib.catch(()=>{_mapLib=null});return _mapLib}
// Slide a marker smoothly to its new spot (like delivery apps) instead of jumping.
function glide(from,to,set){if(!from||geoKm(from,to)>2){set(to);return}const t0=performance.now(),D=900;
  const step=now=>{const k=Math.min(1,(now-t0)/D),e=k<.5?2*k*k:1-(-2*k+2)**2/2;set({lat:from.lat+(to.lat-from.lat)*e,lng:from.lng+(to.lng-from.lng)*e});if(k<1)requestAnimationFrame(step)};
  requestAnimationFrame(step)}
// One small interface for both map libraries: pin / line / drop / keepOnly / fit / focus / resize.
async function makeLiveMap(el){const lib=await mapLib(),items={};el.classList.add("lm-map");
  if(lib==="google"){const g=google.maps,info=new g.InfoWindow();
    const map=new g.Map(el,{center:RAIPUR,zoom:12,disableDefaultUI:true,zoomControl:true,gestureHandling:"cooperative",clickableIcons:false,
      styles:[{featureType:"poi",stylers:[{visibility:"off"}]},{featureType:"transit",stylers:[{visibility:"off"}]}]});
    const api={lib,
      pin(id,{lat,lng,kind,label}){const pos={lat,lng},it=items[id];
        if(!it){const[w,h,ax,ay]=PIN_SIZE[kind];const m=new g.Marker({map,position:pos,title:label||"",zIndex:kind==="rider"?20:10,
            icon:{url:"data:image/svg+xml;charset=UTF-8,"+encodeURIComponent(MAP_PINS[kind]),scaledSize:new g.Size(w,h),anchor:new g.Point(ax,ay)}});
          m.addListener("click",()=>{if(m.getTitle()){info.setContent(esc(m.getTitle()));info.open({map,anchor:m})}});items[id]={m,pos};return}
        it.m.setTitle(label||"");const from=it.pos;it.pos=pos;glide(from,pos,p=>it.m.setPosition(p))},
      line(id,pts){const it=items[id];if(!pts||pts.length<2)return api.drop(id);
        if(it){it.l.setPath(pts);return}
        items[id]={l:new g.Polyline({map,path:pts,strokeOpacity:0,icons:[{icon:{path:"M 0,-1 0,1",strokeOpacity:.8,strokeColor:"#1d70b7",scale:3},offset:"0",repeat:"14px"}]})}},
      drop(id){const it=items[id];if(!it)return;(it.m||it.l).setMap(null);delete items[id]},
      keepOnly(ids){Object.keys(items).forEach(id=>{if(!ids.has(id))api.drop(id)})},
      fit(pts){if(!pts.length)return;if(pts.length===1){map.setCenter(pts[0]);map.setZoom(15);return}const b=new g.LatLngBounds();pts.forEach(p=>b.extend(p));map.fitBounds(b,60)},
      focus(p){map.panTo(p);map.setZoom(16)},resize(){}};
    return api}
  const map=L.map(el,{zoomControl:true,scrollWheelZoom:false}).setView([RAIPUR.lat,RAIPUR.lng],12);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'}).addTo(map);
  const api={lib,
    pin(id,{lat,lng,kind,label}){const pos={lat,lng},it=items[id];
      if(!it){const[w,h,ax,ay]=PIN_SIZE[kind];
        const m=L.marker([lat,lng],{zIndexOffset:kind==="rider"?1000:0,title:label||"",icon:L.divIcon({className:"lm-pin "+kind,html:(kind==="rider"?'<span class="pin-pulse"></span>':"")+MAP_PINS[kind],iconSize:[w,h],iconAnchor:[ax,ay],popupAnchor:[0,-ay+4]})}).addTo(map);
        if(label)m.bindPopup(esc(label));items[id]={m,pos,label};return}
      if(label!==it.label){it.label=label;it.m.bindPopup(esc(label||""))}const from=it.pos;it.pos=pos;glide(from,pos,p=>it.m.setLatLng([p.lat,p.lng]))},
    line(id,pts){const it=items[id];if(!pts||pts.length<2)return api.drop(id);const ll=pts.map(p=>[p.lat,p.lng]);
      if(it){it.l.setLatLngs(ll);return}items[id]={l:L.polyline(ll,{color:"#1d70b7",weight:3,opacity:.75,dashArray:"6 9"}).addTo(map)}},
    drop(id){const it=items[id];if(!it)return;map.removeLayer(it.m||it.l);delete items[id]},
    keepOnly(ids){Object.keys(items).forEach(id=>{if(!ids.has(id))api.drop(id)})},
    fit(pts){if(!pts.length)return;if(pts.length===1){map.setView([pts[0].lat,pts[0].lng],15);return}map.fitBounds(L.latLngBounds(pts.map(p=>[p.lat,p.lng])),{padding:[45,45],maxZoom:16})},
    focus(p){map.setView([p.lat,p.lng],16)},resize(){map.invalidateSize()}};
  setTimeout(()=>map.invalidateSize(),50);return api}

// Patient side: a live "staff on the way" card inside each upcoming booking on My Bookings.
function patientTracking(root,reloadBookings){let trips={},maps={},on=false;
  const fetchTrips=async()=>{const{data,error}=await sb.from("trips").select("*").neq("status","ended");
    if(error)return; // live tracking not set up yet: simply show nothing
    const prev=trips;trips=Object.fromEntries((data||[]).map(t=>[t.booking_id,t]));
    if(Object.keys(prev).some(id=>!trips[id]))reloadBookings();else draw()};
  const draw=()=>root.querySelectorAll("[data-track]").forEach(box=>{const id=box.dataset.track,t=trips[id];
    if(!t){box.hidden=true;box.innerHTML="";delete maps[id];return}
    if(!box.firstChild)box.innerHTML=`<div class="tk-head"><span class="tk-live"><i></i>LIVE</span><b class="tk-title"></b></div>
      <div class="tk-eta"></div><div class="tk-map"></div>
      <div class="tk-foot"><small class="tk-upd"></small><a class="tk-call" href="tel:${BUSINESS.phone.replace(/\s/g,"")}">${PHONE_ICON}<span>Call lab</span></a></div>`;
    box.hidden=false;paint(box,t)});
  const paint=async(box,t)=>{const name=esc(t.staff_name||"Our collection staff"),arrived=t.status==="arrived",stale=!arrived&&Date.now()-new Date(t.updated_at)>180e3;
    const rider=t.lat!=null&&!arrived?{lat:t.lat,lng:t.lng}:null,home=t.dest_lat!=null?{lat:t.dest_lat,lng:t.dest_lng}:null,km=rider&&home?geoKm(rider,home):null;
    box.classList.toggle("arrived",arrived);
    box.querySelector(".tk-title").innerHTML=arrived?`${name} has arrived at your address`:`${name} is on the way`;
    box.querySelector(".tk-eta").innerHTML=arrived?`<b>Arrived</b><span>Please keep the patient ready for the sample.</span>`
      :km!=null?`<b>${km<.15?"Arriving now":"~"+tripEta(km)+" min"}</b><span>${kmText(km)} away</span>`:`<b>On the way</b><span>Coming to your address now</span>`;
    box.querySelector(".tk-upd").textContent=(stale?"⚠ Location last updated ":"Location updated ")+agoText(t.updated_at);
    const mapEl=box.querySelector(".tk-map");if(!rider&&!home){mapEl.hidden=true;return}mapEl.hidden=false;
    let m=maps[t.booking_id];if(!m)m=maps[t.booking_id]=makeLiveMap(mapEl).catch(()=>{mapEl.innerHTML='<p class="muted tk-nomap">Map couldn\'t load.</p>';return null});
    m=await m;if(!m)return;
    if(home)m.pin("home",{...home,kind:"home",label:"Your address"});else m.drop("home");
    if(rider)m.pin("rider",{...rider,kind:"rider",label:t.staff_name||"Collection staff"});else m.drop("rider");
    m.line("route",rider&&home?[rider,home]:null);m.fit([rider,home].filter(Boolean))};
  return{draw(){maps={};draw()},start(){if(on)return;on=true;fetchTrips();let tm;
    sb.channel("my-trips").on("postgres_changes",{event:"*",schema:"public",table:"trips"},()=>{clearTimeout(tm);tm=setTimeout(fetchTrips,300)}).subscribe();
    setInterval(fetchTrips,20000)}}} // the poll also catches a trip ending (patients can't see ended trips, so no live event arrives)

// Admin: every active trip on one live map.
function adminLive(){const rowsEl=$("#liveRows");if(!rowsEl)return;let trips=[],map=null,mapP=null,fitted=-1;
  const load=async()=>{const{data,error}=await sb.from("trips").select("*,bookings(ref,patient_name,address,area,slot,collect_date)").neq("status","ended").order("started_at",{ascending:false});
    if(error){rowsEl.innerHTML=`<tr><td colspan="6" class="muted">${/trips/.test(error.message)?"Live tracking isn't set up yet. Run supabase/live_tracking.sql in the Supabase SQL Editor.":esc(error.message)}</td></tr>`;return}
    trips=data||[];draw()};
  const ensureMap=()=>{if(!mapP)mapP=makeLiveMap($("#adminMap")).then(m=>{map=m;paintMap()}).catch(()=>{$("#adminMap").innerHTML='<p class="muted" style="padding:20px">The map couldn\'t load. Check your internet connection.</p>'});
    return mapP.then(()=>{if(map){map.resize();paintMap()}})};
  const draw=()=>{const on=trips.filter(t=>t.status==="on_the_way").length,arr=trips.length-on;
    const tile=$("#liveTile");if(tile)tile.textContent=on;$("#livePill").textContent=`${on} on the way${arr?` · ${arr} arrived`:""}`;
    const cnt=$("#liveCount");if(cnt){cnt.textContent=trips.length||"";cnt.hidden=!trips.length}
    rowsEl.innerHTML=trips.length?trips.map(t=>{const b=t.bookings||{},km=t.lat!=null&&t.dest_lat!=null&&t.status==="on_the_way"?geoKm(t,{lat:t.dest_lat,lng:t.dest_lng}):null,
        stale=t.status==="on_the_way"&&Date.now()-new Date(t.updated_at)>180e3;
      return`<tr><td><div class="user-name"><span class="user-avatar live-av">${SCOOTER_ICON}</span><div><b>${esc(t.staff_name||"Staff")}</b><br><small class="muted">started ${new Date(t.started_at).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}</small></div></div></td>
        <td><b>${esc(b.patient_name||"")}</b><br><small class="muted">${esc(b.ref||"")} · ${esc(b.area||"")}</small></td>
        <td>${t.status==="arrived"?'<span class="pill green">Arrived</span>':stale?'<span class="pill amber">No signal</span>':'<span class="pill blue">On the way</span>'}</td>
        <td>${t.status==="arrived"?"—":km!=null?`<b>${kmText(km)}</b> · ~${tripEta(km)} min`:'<span class="muted">No address pin</span>'}</td>
        <td>${agoText(t.updated_at)}</td>
        <td style="white-space:nowrap">${t.lat!=null&&t.status==="on_the_way"?`<button type="button" class="light sm" data-live-focus="${t.booking_id}">Show on map</button> `:""}<button type="button" class="light sm" data-live-end="${t.booking_id}">End trip</button></td></tr>`}).join("")
      :'<tr><td colspan="6" class="muted">No staff travelling right now. Trips appear here as soon as staff press "Start trip".</td></tr>';
    if(map)paintMap()};
  const paintMap=()=>{const ids=new Set(),pts=[];
    trips.forEach(t=>{const b=t.bookings||{};
      if(t.dest_lat!=null){const h={lat:t.dest_lat,lng:t.dest_lng};map.pin("h-"+t.booking_id,{...h,kind:"home",label:`${b.patient_name||"Patient"} · ${b.ref||""}`});ids.add("h-"+t.booking_id);pts.push(h)}
      if(t.lat!=null&&t.status==="on_the_way"){const r={lat:t.lat,lng:t.lng};map.pin("r-"+t.booking_id,{...r,kind:"rider",label:`${t.staff_name||"Staff"} → ${b.patient_name||""}`});ids.add("r-"+t.booking_id);pts.push(r);
        if(t.dest_lat!=null){map.line("l-"+t.booking_id,[r,{lat:t.dest_lat,lng:t.dest_lng}]);ids.add("l-"+t.booking_id)}}});
    map.keepOnly(ids);if(pts.length!==fitted){map.fit(pts.length?pts:[RAIPUR]);fitted=pts.length}};
  rowsEl.addEventListener("click",e=>{const f=e.target.closest("[data-live-focus]");
    if(f){const t=trips.find(x=>x.booking_id===f.dataset.liveFocus);if(t&&map){map.focus({lat:t.lat,lng:t.lng});$("#adminMap").scrollIntoView({behavior:"smooth",block:"center"})}return}
    const x=e.target.closest("[data-live-end]");if(!x)return;const t=trips.find(y=>y.booking_id===x.dataset.liveEnd);
    const body=openModal("End this trip?",`<p>Stop live tracking for <b>${esc(t?.staff_name||"this staff member")}</b> going to <b>${esc(t?.bookings?.patient_name||"the patient")}</b>? The patient will stop seeing the map. Use this if staff forgot to end a trip.</p><div class="modal-actions"><button type="button" class="light" data-close>Keep tracking</button><button type="button" class="danger" id="liveEndOk">End trip</button></div>`);
    body.querySelector("#liveEndOk").onclick=async ev=>{ev.target.disabled=true;const{error}=await sb.rpc("set_trip_status",{p_booking:x.dataset.liveEnd,p_status:"ended"});
      if(error){ev.target.disabled=false;return fail(error)}closeModal();toast("Trip ended");load()}});
  document.addEventListener("lm-tab",e=>{if(e.detail==="live")ensureMap()});
  if(location.hash==="#live")ensureMap();
  let tm;sb.channel("admin-trips").on("postgres_changes",{event:"*",schema:"public",table:"trips"},()=>{clearTimeout(tm);tm=setTimeout(load,300)}).subscribe();
  setInterval(()=>{if(trips.length)draw()},15000);load()}

async function initAccount(){const root=$("#myBookings");if(!root||!await guard())return;
  const n=new URLSearchParams(location.search).get("new");if(n)$("#newMsg").innerHTML=`<div class="notice">Booking <b>${esc(n)}</b> confirmed. Our staff will visit at your selected slot.</div>`;
  let byId={};const track=patientTracking(root,()=>load());
  const load=async()=>{const{data,error}=await sb.from("bookings").select("*,booking_items(name,price,instructions),reports(id,path,created_at)").order("created_at",{ascending:false});if(error)return fail(error);
  byId=Object.fromEntries(data.map(b=>[b.id,b]));
  root.innerHTML=data.length?data.map(b=>{const sm=statusMeta(b.status);
    return`<section class="job bk" data-status="${sm.cls}"><div class="jobhead"><span class="bk-ref">${esc(b.ref)}</span><span class="pill ${sm.cls}">${esc(b.status)}</span></div>
    <div class="patient">${ICONS.user}${esc(b.patient_name)}</div>
    ${["Confirmed","Assigned"].includes(b.status)?`<div class="trackbox" data-track="${b.id}" hidden></div>`:""}
    <div class="bk-meta">
      <div class="bk-row">${ICONS.cal}<span>${fmt(b.collect_date)} · ${esc(b.slot)}</span></div>
      <div class="bk-row">${ICONS.pin}<span>${esc(b.address)}, ${esc(b.area)}</span></div>
    </div>
    <div class="tests">${b.booking_items.map(i=>`<span class="test-chip">${esc(i.name)}</span>`).join("")}</div>
    ${["Confirmed","Assigned"].includes(b.status)?b.booking_items.filter(i=>i.instructions).map(i=>prepLine(`${i.name}: ${i.instructions}`)).join(""):""}
    ${b.status==="Cancelled"&&b.cancel_reason?`<div class="muted" style="font-size:12.5px;margin-top:8px">Cancelled: ${esc(b.cancel_reason)}</div>`:""}
    <div class="bk-foot">
      <div class="bk-pay"><span class="${b.payment==="Paid"?"":"muted"}">${esc(payLabel(b))}</span><b>${money(b.total)}</b></div>
      ${b.payment==="Pending"&&b.payment_method==="Online"&&b.status!=="Cancelled"?`<button class="btn" data-paynow="${b.id}" style="background:#1d70b7">Pay now</button>`:""}
      ${b.status==="Cancelled"?"":b.reports.length?b.reports.map(r=>`<button class="green" data-path="${esc(r.path)}">${ICONS.dl}Download report</button>`).join(""):`<span class="bk-pending">${ICONS.clock}Report not ready yet</span>`}
    </div>
    <div class="bk-actions">
      <a href="#" data-timeline="${b.id}" data-ref="${esc(b.ref)}">Track booking</a>
      <a href="receipt.html?id=${b.id}" target="_blank">${b.payment==="Paid"||b.payment==="Refunded"?"Receipt":"Booking summary"}</a>
      ${canChange(b)?`<a href="#" data-resched="${b.id}">Reschedule</a><a href="#" class="danger-link" data-cancel="${b.id}">Cancel booking</a>`:""}
    </div></section>`}).join(""):`<div class="empty">No bookings yet. <a href="index.html#tests"><b>Browse tests</b></a></div>`;track.draw()};
  root.addEventListener("click",async e=>{
    const dl=e.target.closest("[data-path]");if(dl){const{data,error}=await sb.storage.from("reports").createSignedUrl(dl.dataset.path,120);if(error)return fail(error);window.open(data.signedUrl,"_blank");return}
    const pay=e.target.closest("[data-paynow]");if(pay){pay.disabled=true;const ok=await payOnline(pay.dataset.paynow,{name:_ctx?.profile?.full_name||"",email:_ctx?.user?.email||"",contact:_ctx?.profile?.phone||""});pay.disabled=false;if(ok)load();return}
    const cx=e.target.closest("[data-cancel]");if(cx){e.preventDefault();cancelDialog(byId[cx.dataset.cancel],load);return}
    const rs=e.target.closest("[data-resched]");if(rs){e.preventDefault();rescheduleDialog(byId[rs.dataset.resched],load)}});
  load();track.start()}

// ---------- receipt page (receipt.html?id=<booking id>) ----------
async function initReceipt(){const root=$("#receipt");if(!root)return;const c=await guard();if(!c)return;
  const id=new URLSearchParams(location.search).get("id");if(!id){root.innerHTML='<p class="muted">No booking selected.</p>';return}
  if(c.profile.role!=="patient")$(".receipt-tools a").href=c.profile.role==="admin"?"98991/admin/dashboard.html#bookings":"staff/dashboard.html";
  const{data:b,error}=await sb.from("bookings").select("*,booking_items(name,price)").eq("id",id).maybeSingle();
  if(error||!b){root.innerHTML='<p class="muted">Booking not found, or you don\'t have access to it.</p>';return}
  const paid=b.payment==="Paid"||b.payment==="Refunded";
  const title=b.payment==="Refunded"?"Receipt · Refunded":paid?"Payment Receipt":b.status==="Cancelled"?"Cancelled Booking":"Booking Summary";
  document.title=`${b.ref} · ${title} | LabMitra`;
  const row=(k,v)=>v?`<div class="rc-row"><span>${k}</span><b>${v}</b></div>`:"";
  root.innerHTML=`<header class="rc-head"><div><div class="brand"><img class="logo" src="assets/logo-mark.svg" alt="" width="38" height="38"><span class="wordmark">${BUSINESS.name==="LabMitra"?"Lab<b>Mitra</b>":esc(BUSINESS.name)}</span></div>
      <div class="rc-biz">${BUSINESS.legal?`<b>${esc(BUSINESS.legal)}</b><br>`:""}${esc(BUSINESS.address)}${BUSINESS.phone?`<br>Phone: ${esc(BUSINESS.phone)}`:""}${BUSINESS.email?`<br>${esc(BUSINESS.email)}`:""}${BUSINESS.gstin?`<br>GSTIN: ${esc(BUSINESS.gstin)}`:""}</div></div>
      <div class="rc-title"><h1>${title}</h1><div>No. <b>${esc(b.ref)}</b></div><div>Issued ${fmt(new Date())}</div></div></header>
    ${b.status==="Cancelled"?`<div class="rc-stamp">CANCELLED${b.cancelled_at?" · "+fmt(b.cancelled_at):""}</div>`:""}
    <section class="rc-grid">
      <div><h3>Patient</h3>${row("Name",esc(b.patient_name))}${row("Age / Gender",b.patient_age!=null?`${ageText(b.patient_age,b.patient_age_unit,true)} · ${esc(b.patient_gender||"")}`:"")}${row("Phone",esc(b.phone))}${row("Address",`${esc(b.address)}, ${esc(b.area)}`)}</div>
      <div><h3>Booking</h3>${row("Booked on",fmt(b.created_at))}${row("Collection",`${fmt(b.collect_date)} · ${esc(b.slot)}`)}${row("Sample ID",esc(b.sample_id||""))}${row("Status",esc(b.status))}</div>
    </section>
    <table class="rc-items"><thead><tr><th>#</th><th>Test</th><th style="text-align:right">Amount</th></tr></thead>
      <tbody>${b.booking_items.map((i,n)=>`<tr><td>${n+1}</td><td>${esc(i.name)}</td><td style="text-align:right">${money(i.price)}</td></tr>`).join("")}</tbody>
      <tfoot><tr><td></td><td>Total${BUSINESS.gstin?" (incl. taxes, if any)":""}</td><td style="text-align:right">${money(b.total)}</td></tr></tfoot></table>
    <section class="rc-pay"><h3>Payment</h3>${row("Status",esc(payLabel(b)))}${row("Method",b.payment_method==="Online"?"Online (Razorpay)":"Cash on collection")}
      ${row("Payment ID",esc(b.razorpay_payment_id||""))}${row("Paid on",b.collected_at&&b.payment_method==="Cash"?fmt(b.collected_at):"")}${row("Refund ID",esc(b.refund_id||""))}
      ${paid?"":`<p class="muted" style="font-size:12.5px">Payment not received yet. This is a booking summary, not a receipt.</p>`}</section>
    <footer class="rc-foot">This is a computer-generated document and does not need a signature.<br>Questions? ${BUSINESS.phone||BUSINESS.email?`Contact us at ${esc([BUSINESS.phone,BUSINESS.email].filter(Boolean).join(" · "))}.`:"Contact LabMitra support."}</footer>`}

// ---------- cancel / reschedule popups (patients, and admin from the dashboard) ----------
function cancelDialog(b,done){if(!b)return;
  const refund=b.payment==="Paid"&&b.payment_method==="Online";
  const body=openModal(`Cancel ${b.ref}?`,`<p>Collection on <b>${fmt(b.collect_date)} · ${esc(b.slot)}</b> for <b>${esc(b.patient_name)}</b> will be cancelled.</p>
    ${refund?`<div class="notice">You paid ${money(b.total)} online. It will be refunded to your original payment method, usually within 5–7 working days.</div>`:""}
    <label>Reason (optional)</label><select id="cxReason"><option value="">Choose a reason</option><option>Plans changed</option><option>Booked by mistake</option><option>Will book another day</option><option>Patient not well / travelling</option><option>Other</option></select>
    <div class="modal-actions"><button type="button" class="light" data-close>Keep booking</button><button type="button" class="danger" id="cxGo">Yes, cancel booking</button></div>`);
  body.querySelector("#cxGo").onclick=async ev=>{const btn=ev.target;btn.disabled=true;btn.textContent="Cancelling...";
    const{data:pay,error}=await sb.rpc("cancel_booking",{p_id:b.id,p_reason:body.querySelector("#cxReason").value||null});
    if(error){btn.disabled=false;btn.textContent="Yes, cancel booking";return fail(error)}
    if(pay==="Refund pending"){const{error:rErr}=await invokeFn("razorpay-refund",{booking_id:b.id});
      toast(rErr?`Booking cancelled. We'll process your ${money(b.total)} refund within 5–7 working days.`:`Booking cancelled. Refund of ${money(b.total)} started.`)}
    else toast("Booking cancelled");
    closeModal();done&&done()}}
function rescheduleDialog(b,done){if(!b)return;
  const body=openModal(`Reschedule ${b.ref}`,`<p class="muted" style="margin-top:0">Currently: <b>${fmt(b.collect_date)} · ${esc(b.slot)}</b></p>
    <label>New date</label><input type="date" id="rsDate" min="${today()}">
    <label>New time slot</label><select id="rsSlot" disabled><option value="">Pick a date first</option></select><small class="muted" id="rsHint" style="display:block;margin-top:6px;font-size:12px"></small>
    <div class="modal-actions"><button type="button" class="light" data-close>Keep current time</button><button type="button" class="green" id="rsGo">Save new time</button></div>`);
  const d=body.querySelector("#rsDate"),s=body.querySelector("#rsSlot");
  d.onchange=async()=>{if(!d.value)return;s.disabled=true;
    const list=await slotAvailability(d.value,d.value===String(b.collect_date)?b.slot:null);
    s.innerHTML='<option value="">Select slot</option>'+list.map(x=>{const same=d.value===String(b.collect_date)&&x.slot===b.slot;
      return`<option value="${esc(x.slot)}"${x.disabled||same?" disabled":""}>${esc(same?x.slot+" — current":x.label)}</option>`}).join("");
    s.disabled=false;const open=list.filter(x=>!x.disabled).length;body.querySelector("#rsHint").textContent=open?"":"No slots left on this day. Please pick another date."};
  body.querySelector("#rsGo").onclick=async ev=>{if(!d.value||!s.value)return toast("Pick a new date and time slot",false);
    const btn=ev.target;btn.disabled=true;btn.textContent="Saving...";
    const{error}=await sb.rpc("reschedule_booking",{p_id:b.id,p_date:d.value,p_slot:s.value});
    if(error){btn.disabled=false;btn.textContent="Save new time";return fail(error)}
    toast(`Rescheduled to ${fmt(d.value)} · ${s.value}`);closeModal();done&&done()}}

// ---------- shared bookings table (used by BOTH admin and staff dashboards) ----------
const STATUSES=["Confirmed","Assigned","Sample collected","Handed over to lab","Lab received sample","Processing started","Report ready","Cancelled"];
const PAYMENTS=["Pending","Paid","Refund pending","Refunded"],PAY_CLS={Paid:"green",Pending:"amber","Refund pending":"red"};
const opts=(arr,cur)=>arr.map(v=>`<option${v===cur?" selected":""}>${esc(v)}</option>`).join("");
const bookingRowHTML=b=>`<tr data-id="${b.id}">
  <td><span class="bk-ref">${esc(b.ref)}</span>${b.sample_id?`<div class="sample-tag">Sample ${esc(b.sample_id)}</div>`:""}
    <div class="row-links"><a href="#" data-timeline="${b.id}" data-ref="${esc(b.ref)}">Timeline</a><a href="../../receipt.html?id=${b.id}" target="_blank">Receipt</a>${["Confirmed","Assigned"].includes(b.status)?`<a href="#" data-resched="${b.id}">Reschedule</a>`:""}</div></td>
  <td><b>${esc(b.patient_name)}</b><br><small class="muted">${b.patient_age!=null?`${ageText(b.patient_age,b.patient_age_unit)} · ${esc(b.patient_gender||"")} · `:""}${esc(b.phone)}</small></td>
  <td><div class="cell-tests">${b.booking_items.map(i=>`<span class="test-chip">${esc(i.name)}</span>`).join("")}</div></td>
  <td>${fmt(b.collect_date)}<br><small class="muted">${esc(b.slot)}</small></td>
  <td><b>${money(b.total)}</b></td>
  <td><select data-f="status" class="cell-select ${statusMeta(b.status).cls}">${opts(STATUSES,b.status)}</select></td>
  <td><select data-f="payment" class="cell-select pay ${PAY_CLS[b.payment]||""}">${opts(PAYMENTS,b.payment)}</select>${b.payment==="Refund pending"&&b.payment_method==="Online"?`<button type="button" class="danger sm" data-refund="${b.id}">Issue refund</button>`:""}<div class="muted" style="font-size:11px;margin-top:5px">${esc(b.payment_method||"Cash")}${b.payment==="Paid"&&b.payment_method==="Cash"&&b.collected_at?" · "+fmt(b.collected_at):""}${b.collected_by_name?` · by ${esc(b.collected_by_name)}`:""}</div></td>
  <td>${b.reports.length?`<a href="#" class="pill green" data-view="${esc(b.reports[0].path)}">View PDF</a>`:'<span class="pill">Not uploaded</span>'}</td></tr>`;
// Loads all bookings and calls onRows again whenever ANY dashboard changes a booking or
// uploads a report (Supabase Realtime). Returns a function to force a reload.
function liveBookings(onRows){
  const load=async()=>{const{data:rows,error}=await sb.from("bookings").select("*,booking_items(name,instructions),reports(id,path)").order("created_at",{ascending:false});
    if(error)return fail(error);onRows(rows)};
  let t;const refresh=()=>{clearTimeout(t);t=setTimeout(load,300)};
  sb.channel("bookings-live").on("postgres_changes",{event:"*",schema:"public",table:"bookings"},refresh)
    .on("postgres_changes",{event:"*",schema:"public",table:"reports"},refresh).subscribe();
  load();return load}
// Admin bookings table: renders rows, saves dropdown changes, refreshes live.
function bookingsTable(body,onRows){
  let byId={};
  const load=liveBookings(rows=>{byId=Object.fromEntries(rows.map(b=>[b.id,b]));body.innerHTML=rows.map(bookingRowHTML).join("")||'<tr><td colspan="8" class="muted">No bookings yet.</td></tr>';
    onRows&&onRows(rows)});
  body.addEventListener("change",async e=>{const id=e.target.closest("tr")?.dataset.id;if(!id||!e.target.dataset.f)return;
    const f=e.target.dataset.f,v=e.target.value,patch={[f]:v},b=byId[id];
    // Cancelling goes through cancel_booking() so online payments are marked for refund and the reason is logged.
    if(f==="status"&&v==="Cancelled"&&b&&["Confirmed","Assigned"].includes(b.status)){e.target.value=b.status;return cancelDialog(b,load)}
    // Admin marking a cash booking Paid by hand = cash received at the office, not by a staff member.
    if(f==="payment"&&v==="Paid"&&!(b&&b.collected_by_name))Object.assign(patch,{collected_at:new Date().toISOString(),collected_by_name:"Office"});
    if(f==="payment"&&v==="Pending")Object.assign(patch,{collected_at:null,collected_by_name:null});
    const{error}=await sb.from("bookings").update(patch).eq("id",id);
    if(error){fail(error);return load()}toast("Saved");load()});
  body.addEventListener("click",async e=>{
    const rs=e.target.closest("[data-resched]");if(rs){e.preventDefault();return rescheduleDialog(byId[rs.dataset.resched],load)}
    const rf=e.target.closest("[data-refund]");if(rf){rf.disabled=true;rf.textContent="Refunding...";
      const{error}=await invokeFn("razorpay-refund",{booking_id:rf.dataset.refund});
      if(error){rf.disabled=false;rf.textContent="Issue refund";return fail(error)}
      toast("Refund issued");return load()}
    const a=e.target.closest("[data-view]");if(!a)return;e.preventDefault();
    const{data,error}=await sb.storage.from("reports").createSignedUrl(a.dataset.view,120);if(error)return fail(error);window.open(data.signedUrl,"_blank")});
  return load}

// ---------- cash accountability (shared by admin + staff) ----------
const normName=s=>String(s||"").trim().toLowerCase();
// Per person: cash they collected, cash they handed to the office, and what's still with them.
function cashLedger(rows,handovers){const people={};
  const get=name=>{const k=normName(name)||"(not recorded)";return people[k]||(people[k]={name:String(name||"").trim()||"Not recorded",office:k==="office",collected:0,handed:0,received:0,jobs:0})};
  rows.filter(b=>b.payment==="Paid"&&b.payment_method==="Cash").forEach(b=>{const p=get(b.collected_by_name);p.collected+=b.total;p.jobs++});
  handovers.forEach(h=>{const p=get(h.handed_by);p.handed+=h.amount;if(h.received)p.received+=h.amount});
  return Object.values(people).map(p=>({...p,inHand:p.office?0:p.collected-p.handed})).sort((a,b)=>b.inHand-a.inHand)}
// Loads cash handovers and reloads live when any dashboard records or confirms one.
function liveHandovers(onData){
  const load=async()=>{const{data,error}=await sb.from("cash_handovers").select("*").order("created_at",{ascending:false});
    if(error){console.warn("cash_handovers:",error.message);return onData([])}onData(data)};
  let t;sb.channel("cash-live").on("postgres_changes",{event:"*",schema:"public",table:"cash_handovers"},()=>{clearTimeout(t);t=setTimeout(load,300)}).subscribe();
  load();return load}

// ---------- admin ----------
// Admin overview analytics: weekly / monthly / yearly, compared with the previous period.
function periodRange(kind,off){const n=new Date();let s,e;
  if(kind==="week"){s=new Date(n.getFullYear(),n.getMonth(),n.getDate());s.setDate(s.getDate()-((s.getDay()+6)%7)+7*off);e=new Date(s);e.setDate(e.getDate()+7)}
  else if(kind==="month"){s=new Date(n.getFullYear(),n.getMonth()+off,1);e=new Date(n.getFullYear(),n.getMonth()+off+1,1)}
  else{s=new Date(n.getFullYear()+off,0,1);e=new Date(n.getFullYear()+off+1,0,1)}
  return{s,e}}
function adminAnalytics(){if(!$("#kpiTiles"))return{setRows(){}};
  let kind="week",off=0,rows=[];
  const DOW=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const NOUN={week:"week",month:"month",year:"year"};
  const inR=(d,r)=>{const t=new Date(d);return t>=r.s&&t<r.e};
  const pct=(a,b)=>b?Math.round(a/b*100):0;
  const dshort=d=>d.toLocaleDateString("en-IN",{day:"numeric",month:"short"});
  const hrs=h=>h==null?"—":h<48?Math.round(h)+" h":(h/24).toFixed(1)+" days";
  const slotStart=b=>{const d=new Date(String(b.collect_date).slice(0,10)+"T00:00:00");d.setHours(slotHour(b.slot)??0);return d};
  const label=()=>{const{s,e}=periodRange(kind,off),last=new Date(e-864e5);
    if(off===0)return"This "+NOUN[kind];if(off===-1)return"Last "+NOUN[kind];
    return kind==="week"?`${dshort(s)} – ${dshort(last)} ${last.getFullYear()}`:kind==="month"?`${MON[s.getMonth()]} ${s.getFullYear()}`:String(s.getFullYear())};
  // Every number for one date range.
  const metrics=(r,first)=>{const B=rows.filter(b=>inR(b.created_at,r)),paid=B.filter(b=>b.payment==="Paid"),sum=a=>a.reduce((s,b)=>s+b.total,0);
    const rep=rows.filter(b=>b.reports?.length&&b.collect_date).map(b=>({b,t:new Date(Math.min(...b.reports.map(x=>+new Date(x.created_at||b.created_at))))})).filter(x=>x.t>=r.s&&x.t<r.e)
      .map(x=>(x.t-slotStart(x.b))/36e5).filter(h=>h>=0);
    return{B,bookings:B.length,revenue:sum(paid),cash:sum(paid.filter(b=>b.payment_method==="Cash")),online:sum(paid.filter(b=>b.payment_method==="Online")),
      avg:paid.length?Math.round(sum(paid)/paid.length):0,cancel:pct(B.filter(b=>b.status==="Cancelled").length,B.length),
      newPts:Object.values(first).filter(t=>t>=r.s&&t<r.e).length,tat:rep.length?rep.reduce((a,h)=>a+h,0)/rep.length:null}};
  const delta=(c,p,lowerBetter)=>{if(p==null||c==null)return"";if(!p)return c?`<i class="dl ${lowerBetter?"down":"up"}">New</i>`:"";const d=Math.round((c-p)/p*100);if(!d)return'<i class="dl">± 0%</i>';
    const good=lowerBetter?d<0:d>0;return`<i class="dl ${good?"up":"down"}">${d>0?"▲":"▼"} ${Math.abs(d)}%</i>`};
  // Horizontal bar list. items: [{label,value,tip}]
  const hbars=(items,f=String,color="")=>{const max=Math.max(1,...items.map(i=>i.value));
    return items.length?items.map(i=>`<div class="hb" data-tip="${esc(i.tip||i.label+": "+f(i.value))}"><span class="hb-l">${esc(i.label)}</span><span class="hb-t"><span class="hb-f ${color}" style="width:${i.value?Math.max(3,i.value/max*100):0}%"></span></span><b class="hb-v">${f(i.value)}</b></div>`).join("")
      :'<p class="muted an-empty">No data for this period.</p>'};
  const count=(arr,key)=>{const m={};arr.forEach(x=>{const k=key(x);if(k)m[k]=(m[k]||0)+1});return m};
  const draw=()=>{const r=periodRange(kind,off),p=periodRange(kind,off-1),now=new Date();
    if(off===0)p.e=new Date(p.s.getTime()+(now-r.s)); // like-for-like: same point in the previous period
    $("#perLabel").textContent=label();$("#perNext").disabled=off>=0;
    document.querySelectorAll("#periodSeg button").forEach(b=>b.classList.toggle("on",b.dataset.p===kind));
    const first={};rows.slice().reverse().forEach(b=>{if(b.user_id&&!first[b.user_id])first[b.user_id]=new Date(b.created_at)});
    const c=metrics(r,first),q=metrics(p,first),vs=off===0?`vs same time last ${NOUN[kind]}`:`vs previous ${NOUN[kind]}`;
    const tile=(name,val,d,note)=>`<div class="stat"><span>${name}</span><b>${val}</b><em>${d||""} <small>${d?vs:note||""}</small></em></div>`;
    $("#kpiTiles").innerHTML=[
      tile("Bookings",c.bookings,delta(c.bookings,q.bookings)),
      tile("Paid revenue",money(c.revenue),delta(c.revenue,q.revenue)),
      tile("Cash revenue",money(c.cash),delta(c.cash,q.cash)),
      tile("Online revenue",money(c.online),delta(c.online,q.online)),
      tile("Avg booking value",money(c.avg),delta(c.avg,q.avg)),
      tile("New patients",c.newPts,delta(c.newPts,q.newPts),"First booking ever"),
      tile("Cancellation rate",c.cancel+"%",delta(c.cancel,q.cancel,true),"Of bookings made"),
      tile("Avg report time",hrs(c.tat),c.tat!=null&&q.tat!=null?delta(c.tat,q.tat,true):"","Collection → PDF uploaded")].join("");
    // Revenue trend: one bar per day (week/month) or per month (year).
    const n=kind==="year"?12:Math.round((r.e-r.s)/864e5),bk=Array.from({length:n},()=>({rev:0,cnt:0}));
    c.B.forEach(b=>{const d=new Date(b.created_at),i=kind==="year"?d.getMonth():Math.round((new Date(d.getFullYear(),d.getMonth(),d.getDate())-r.s)/864e5);
      if(bk[i]){bk[i].cnt++;if(b.payment==="Paid")bk[i].rev+=b.total}});
    const bDate=i=>kind==="year"?new Date(r.s.getFullYear(),i,1):new Date(r.s.getFullYear(),r.s.getMonth(),r.s.getDate()+i);
    const bName=i=>kind==="year"?MON[i]+" "+r.s.getFullYear():kind==="week"?DOW[i]+" "+dshort(bDate(i)):dshort(bDate(i));
    const axis=i=>kind==="year"?MON[i]:kind==="week"?DOW[i]:(i===0||(i+1)%5===0?String(i+1):"");
    const max=Math.max(1,...bk.map(x=>x.rev)),best=bk.reduce((a,x,i)=>x.rev>bk[a].rev?i:a,0);
    $("#trendNote").textContent=`Total ${money(c.revenue)} · peak ${money(bk[best].rev)}`;
    $("#trendChart").innerHTML=`<div class="vb-max">${money(max)}</div><div class="vb-cols">${bk.map((x,i)=>{const fut=bDate(i)>now;
      return`<div class="vb ${fut?"fut":""}" data-tip="${esc(bName(i))} · ${money(x.rev)} paid · ${x.cnt} booking${x.cnt===1?"":"s"}"><span class="vb-f" style="height:${x.rev?Math.max(2,x.rev/max*100):0}%"></span><small>${axis(i)}</small></div>`}).join("")}</div>`;
    // Payment mix
    const tot=c.cash+c.online,pend=c.B.filter(b=>b.payment==="Pending"&&b.status!=="Cancelled").reduce((s,b)=>s+b.total,0),
      refd=c.B.filter(b=>/Refund/.test(b.payment)).reduce((s,b)=>s+b.total,0);
    $("#payMix").innerHTML=tot?`<div class="stack"><span class="st-cash" style="width:${c.cash/tot*100}%" data-tip="Cash · ${money(c.cash)} (${pct(c.cash,tot)}%)"></span><span class="st-online" style="width:${c.online/tot*100}%" data-tip="Online · ${money(c.online)} (${pct(c.online,tot)}%)"></span></div>
      <div class="legend"><span><i class="sw st-cash"></i>Cash <b>${money(c.cash)}</b> · ${pct(c.cash,tot)}%</span><span><i class="sw st-online"></i>Online <b>${money(c.online)}</b> · ${pct(c.online,tot)}%</span></div>
      <p class="muted mini">Still unpaid: <b>${money(pend)}</b> · Refunds: <b>${money(refd)}</b></p>`:`<p class="muted an-empty">No paid bookings in this period.${pend?` Unpaid: <b>${money(pend)}</b>`:""}</p>`;
    // Top tests (count + revenue), areas, slots, days
    const live=c.B.filter(b=>b.status!=="Cancelled"),tm={};
    live.forEach(b=>(b.booking_items||[]).forEach(it=>{const t=tm[it.name]||(tm[it.name]={n:0,rev:0});t.n++;t.rev+=it.price||0}));
    const tests=Object.entries(tm).sort((a,b)=>b[1].n-a[1].n||b[1].rev-a[1].rev);
    $("#topTests").innerHTML=hbars(tests.slice(0,6).map(([k,v])=>({label:k,value:v.n,tip:`${k}: booked ${v.n}× · ${money(v.rev)}`})),v=>v+"×");
    const areas=Object.entries(count(live,b=>(b.area||"").trim()||"Not given")).sort((a,b)=>b[1]-a[1]);
    $("#topAreas").innerHTML=hbars(areas.slice(0,6).map(([k,v])=>({label:k,value:v,tip:`${k}: ${v} booking${v===1?"":"s"} (${pct(v,live.length)}%)`})),String,"teal");
    const sl=count(live,b=>b.slot),slots=[...SLOTS,...Object.keys(sl).filter(s=>!SLOTS.includes(s))];
    $("#slotChart").innerHTML=live.length?hbars(slots.map(s=>({label:s,value:sl[s]||0,tip:`${s}: ${sl[s]||0} bookings (${pct(sl[s]||0,live.length)}%)`}))):hbars([]);
    const dw=count(live,b=>b.collect_date?DOW[(new Date(String(b.collect_date).slice(0,10)+"T00:00:00").getDay()+6)%7]:null);
    $("#dowChart").innerHTML=live.length?hbars(DOW.map(d=>({label:d,value:dw[d]||0,tip:`${d}: ${dw[d]||0} collections`}))):hbars([]);
    // Patients: new vs returning, gender, age groups
    const ret=c.B.filter(b=>first[b.user_id]&&first[b.user_id]<new Date(b.created_at)).length,g=count(c.B,b=>b.patient_gender||"Not given");
    const yrs=b=>b.patient_age==null?null:(b.patient_age_unit&&b.patient_age_unit!=="years")?0:b.patient_age;
    const AG=[["0–12",0,12],["13–17",13,17],["18–35",18,35],["36–59",36,59],["60+",60,999]];
    const ag=AG.map(([l,a,z])=>({label:l+" yrs",value:c.B.filter(b=>{const y=yrs(b);return y!=null&&y>=a&&y<=z}).length}));
    $("#patientMix").innerHTML=c.B.length?`<p class="mini"><b>${c.B.length-ret}</b> first-time · <b>${ret}</b> returning (${pct(ret,c.B.length)}% repeat)</p>
      <div class="sub-h">Gender</div>${hbars(["Female","Male","Other","Not given"].filter(k=>g[k]).map(k=>({label:k,value:g[k]})),String,"teal")}
      <div class="sub-h">Age group</div>${hbars(ag)}`:hbars([]);
    // Funnel
    const after=s=>STATUSES.indexOf(s)>=STATUSES.indexOf("Sample collected")&&s!=="Cancelled",
      F=[["Booked",c.B.length],["Sample collected",c.B.filter(b=>after(b.status)).length],["Report delivered",c.B.filter(b=>b.reports?.length).length],["Paid",c.B.filter(b=>b.payment==="Paid").length]];
    $("#funnel").innerHTML=c.B.length?hbars(F.map(([l,v])=>({label:l,value:v,tip:`${l}: ${v} (${pct(v,c.B.length)}% of booked)`})),v=>`${v} · ${pct(v,c.B.length)}%`):hbars([]);
    // Smart insights: plain-language takeaways.
    const ins=[],add=(ic,t)=>ins.push(`<li><span class="ic">${ic}</span><span>${t}</span></li>`);
    if(!c.B.length)add("📭",`No bookings ${label().toLowerCase()} yet.`);
    else{
      if(q.revenue||c.revenue){const d=q.revenue?Math.round((c.revenue-q.revenue)/q.revenue*100):null;
        add(d==null?"🚀":d>=0?"📈":"📉",d==null?`Revenue of <b>${money(c.revenue)}</b>. Nothing in the previous ${NOUN[kind]} to compare with.`:`Revenue is <b>${d>=0?"up":"down"} ${Math.abs(d)}%</b> (${money(c.revenue)} vs ${money(q.revenue)}) ${vs}.`)}
      if(bk[best].rev)add("🏆",`Best ${kind==="year"?"month":"day"}: <b>${esc(bName(best))}</b> with ${money(bk[best].rev)}.`);
      if(tests[0])add("🧪",`<b>${esc(tests[0][0])}</b> is the most booked test (${tests[0][1].n}×, ${money(tests[0][1].rev)}).`);
      const topSlot=Object.entries(sl).sort((a,b)=>b[1]-a[1])[0];
      if(topSlot&&live.length>=3&&pct(topSlot[1],live.length)>=40)add("⏰",`<b>${esc(topSlot[0])}</b> gets ${pct(topSlot[1],live.length)}% of bookings. Consider extra staff or capacity for that slot.`);
      if(areas[0]&&areas[0][0]!=="Not given"&&live.length>=3)add("📍",`Most bookings come from <b>${esc(areas[0][0])}</b> (${pct(areas[0][1],live.length)}%). A good place for local promotion.`);
      if(c.B.length>=3)add("🔁",`${pct(ret,c.B.length)}% of bookings are from returning patients.${pct(ret,c.B.length)<20?" Retest reminders could bring more people back.":""}`);
      if(c.cancel>=15&&c.B.length>=3)add("⚠️",`<b>${c.cancel}% of bookings were cancelled.</b> Worth calling a few patients to ask why.`);
      if(tot>=1000&&pct(c.online,tot)<25)add("💳",`Only ${pct(c.online,tot)}% paid online. A small online-payment discount could cut cash handling.`)}
    const overdue=rows.filter(b=>!b.reports?.length&&after(b.status)&&b.collect_date&&now-slotStart(b)>24*36e5).length;
    if(overdue)add("⏳",`<b>${overdue} report${overdue===1?" is":"s are"} overdue</b> (sample collected over 24 h ago, no PDF yet). <a href="#bookings">Check bookings →</a>`);
    $("#insights").innerHTML=ins.join("")};
  $("#periodSeg").onclick=e=>{const b=e.target.closest("[data-p]");if(!b)return;kind=b.dataset.p;off=0;try{localStorage.setItem("lm_period",kind)}catch(_){}draw()};
  $("#perPrev").onclick=()=>{off--;draw()};$("#perNext").onclick=()=>{if(off<0){off++;draw()}};
  // Click the period label to jump straight to any week, month or year.
  const pick=$("#perPick"),lbl=$("#perLabel");let pickYear;
  const monday=d=>{const m=new Date(d.getFullYear(),d.getMonth(),d.getDate());m.setDate(m.getDate()-((m.getDay()+6)%7));return m};
  const closePick=()=>{pick.hidden=true;lbl.setAttribute("aria-expanded","false")};
  const go=o=>{off=Math.min(0,o);closePick();draw()};
  const drawPick=()=>{const now=new Date(),ny=now.getFullYear(),cur=periodRange(kind,off).s;
    const oldest=rows.length?new Date(rows[rows.length-1].created_at).getFullYear():ny,years=[];for(let y=ny;y>=Math.min(oldest,ny-4);y--)years.push(y);
    if(kind==="year")pick.innerHTML=`<div class="pp-h">Choose a year</div><div class="pp-grid">${years.map(y=>`<button type="button" data-y="${y}" class="${y===cur.getFullYear()?"on":""}">${y}</button>`).join("")}</div>`;
    else if(kind==="month")pick.innerHTML=`<div class="pp-year"><button type="button" class="light sm" data-yr="-1" aria-label="Previous year">‹</button><b>${pickYear}</b><button type="button" class="light sm" data-yr="1" aria-label="Next year" ${pickYear>=ny?"disabled":""}>›</button></div>
      <div class="pp-grid">${MON.map((m,i)=>`<button type="button" data-m="${i}" class="${pickYear===cur.getFullYear()&&i===cur.getMonth()?"on":""}" ${pickYear===ny&&i>now.getMonth()?"disabled":""}>${m}</button>`).join("")}</div>`;
    else pick.innerHTML=`<div class="pp-h">Pick any day in the week</div><input type="date" id="ppDate" max="${today()}" value="${cur.toLocaleDateString("en-CA")}"><button type="button" class="pp-now" data-now>Go to this week</button>`;
    const d=$("#ppDate");if(d)d.onchange=()=>{if(!d.value)return;go(Math.round((monday(new Date(d.value+"T00:00:00"))-monday(new Date()))/(7*864e5)))}};
  lbl.onclick=e=>{e.stopPropagation();if(!pick.hidden)return closePick();pickYear=periodRange(kind,off).s.getFullYear();drawPick();pick.hidden=false;lbl.setAttribute("aria-expanded","true")};
  pick.onclick=e=>{e.stopPropagation();const b=e.target.closest("button");if(!b||b.disabled)return;const now=new Date();
    if(b.dataset.yr){pickYear+=+b.dataset.yr;return drawPick()}
    if(b.dataset.m)return go((pickYear-now.getFullYear())*12+(+b.dataset.m-now.getMonth()));
    if(b.dataset.y)return go(+b.dataset.y-now.getFullYear());
    if("now" in b.dataset)go(0)};
  document.addEventListener("click",e=>{if(!pick.hidden&&!e.target.closest(".per-wrap"))closePick()});
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!pick.hidden)closePick()});
  $("#periodSeg").addEventListener("click",closePick);
  try{const k=localStorage.getItem("lm_period");if(NOUN[k])kind=k}catch(_){}
  // Shared hover/tap tooltip for every chart mark.
  const tip=$("#chartTip"),ov=$('[data-tab="overview"]');
  const show=(el,x,y)=>{tip.textContent=el.dataset.tip;tip.hidden=false;const w=tip.offsetWidth;tip.style.left=Math.max(8,Math.min(innerWidth-w-8,x-w/2))+"px";tip.style.top=Math.max(8,y-tip.offsetHeight-12)+"px"};
  ov.addEventListener("mousemove",e=>{const el=e.target.closest("[data-tip]");if(el)show(el,e.clientX,e.clientY);else tip.hidden=true});
  ov.addEventListener("mouseleave",()=>tip.hidden=true);
  ov.addEventListener("click",e=>{const el=e.target.closest("[data-tip]");if(el){const r=el.getBoundingClientRect();show(el,r.left+r.width/2,r.top)}else tip.hidden=true});
  draw();
  return{setRows(r){rows=r;draw()}}}
// Admin: File manager, Windows Explorer style. Folders: Reports > Year > Month > Booking (patient) > PDF files.
const PDF_ICON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 15h6M9 18h4"/></svg>';
const FX_ICO={
  folder:full=>`<svg viewBox="0 0 48 40" aria-hidden="true"><path d="M3 7a4 4 0 0 1 4-4h11.5l4.5 4.5h18a4 4 0 0 1 4 4V14H3z" fill="#dfa424"/>${full?'<rect x="7" y="8" width="34" height="14" rx="1.5" fill="#fff" stroke="#e7d7ae"/>':""}<path d="M3 13h42v20a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z" fill="#f8c74c"/><path d="M3 13h42v3H3z" fill="#fbd877"/></svg>`,
  pdf:'<svg viewBox="0 0 40 48" aria-hidden="true"><path d="M6 2h21l11 11v31a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="#fff" stroke="#c3cdd8" stroke-width="1.5"/><path d="M27 2v9a2 2 0 0 0 2 2h9" fill="#edf1f5" stroke="#c3cdd8" stroke-width="1.5" stroke-linejoin="round"/><path d="M11 20h17M11 24h12" stroke="#d6dde5" stroke-width="2" stroke-linecap="round"/><rect x="1" y="28" width="27" height="12" rx="2" fill="#d93025"/><text x="14.5" y="37.2" text-anchor="middle" font-size="9" font-weight="800" fill="#fff" font-family="Arial,sans-serif">PDF</text></svg>',
  drive:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="13" width="20" height="8" rx="2"/><path d="M5.5 13 8 4h8l2.5 9"/><path d="M17 17h.01"/></svg>',
  clock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  wait:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h12M6 22h12M7 2v4l5 6-5 6v4M17 2v4l-5 6 5 6v4"/></svg>',
  back:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
  fwd:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  up:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  upload:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M20 16v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3"/></svg>',
  open:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  dl:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/></svg>',
  replace:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 21v-5h-5"/></svg>',
  del:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3"/></svg>',
  details:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  tiles:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  pane:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></svg>',
  menu:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  search:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
  chev:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>'};
const FX_MONTHS=["January","February","March","April","May","June","July","August","September","October","November","December"];
function adminFiles(){const root=$("#fx");if(!root)return{setRows(){}};
  const pref=(k,d)=>{try{return localStorage.getItem(k)||d}catch{return d}},save=(k,v)=>{try{localStorage.setItem(k,v)}catch{}};
  let rows=[],loc={k:"root"},hist=[],fwd=[],sel=new Set(),anchor=null,q="",busy="",
    mode=pref("lm_fx_view","details"),pane=pref("lm_fx_pane","1")==="1",sort={c:"date",d:-1},
    expanded=new Set([String(new Date().getFullYear())]),items=[],sizes={},sized={},urls={};
  const list=$("#fxList"),menu=document.createElement("div");menu.className="fx-menu";menu.hidden=true;document.body.appendChild(menu);
  // ---------- data ----------
  const okPdf=f=>f&&(f.type==="application/pdf"||/\.pdf$/i.test(f.name))&&f.size<=10*1048576;
  const ymOf=b=>String(b.collect_date||b.created_at||"").slice(0,7);
  const shown=()=>rows.filter(b=>b.status!=="Cancelled"||(b.reports||[]).length);
  const reps=b=>(b.reports||[]).slice().sort((x,y)=>new Date(x.created_at||0)-new Date(y.created_at||0));
  const fileName=(b,i,n)=>`${b.ref}-report${n>1?"-"+(i+1):""}.pdf`;
  const fileItems=b=>reps(b).map((r,i,a)=>({t:"file",id:"f:"+r.id,r,b,name:fileName(b,i,a.length),date:r.created_at}));
  const bkItem=b=>({t:"bk",id:"b:"+b.id,b,name:`${b.ref} – ${b.patient_name}`,date:b.collect_date,n:(b.reports||[]).length});
  const byId=id=>rows.find(b=>b.id===id);
  const years=()=>{const m={};shown().forEach(b=>{const y=ymOf(b).slice(0,4);if(y)(m[y]=m[y]||[]).push(b)});return m};
  const months=y=>{const m={};shown().forEach(b=>{const ym=ymOf(b);if(ym.slice(0,4)===y)(m[ym]=m[ym]||[]).push(b)});return m};
  const latest=bs=>bs.map(b=>b.collect_date||"").sort().pop();
  const waiting=()=>rows.filter(b=>b.status!=="Cancelled"&&!(b.reports||[]).length);
  const allFiles=()=>rows.flatMap(fileItems);
  function itemsFor(l){
    if(q){const s=q.toLowerCase(),hit=b=>`${b.ref} ${b.patient_name} ${b.phone||""} ${b.sample_id||""}`.toLowerCase().includes(s);
      return[...shown().filter(hit).map(bkItem),...allFiles().filter(f=>hit(f.b)||f.name.toLowerCase().includes(s))]}
    if(l.k==="root")return Object.entries(years()).map(([y,bs])=>({t:"dir",id:"y:"+y,name:y,go:{k:"year",y},date:latest(bs),n:bs.length,sk:y}));
    if(l.k==="year")return Object.entries(months(l.y)).map(([ym,bs])=>({t:"dir",id:"m:"+ym,name:FX_MONTHS[+ym.slice(5)-1],go:{k:"month",ym},date:latest(bs),n:bs.length,sk:ym}));
    if(l.k==="month")return shown().filter(b=>ymOf(b)===l.ym).map(bkItem);
    if(l.k==="bk"){const b=byId(l.id);return b?fileItems(b):[]}
    if(l.k==="recent")return allFiles().sort((x,y)=>new Date(y.date||0)-new Date(x.date||0)).slice(0,60);
    if(l.k==="waiting")return waiting().map(bkItem);return[]}
  const sorted=arr=>{const{c,d}=sort,isDir=i=>i.t!=="file",key=i=>c==="name"?(i.sk||i.name).toLowerCase():c==="type"?(isDir(i)?"0":"1"):c==="size"?(i.t==="file"?sizes[i.r.path]||0:i.n||0):String(i.date||"");
    return arr.slice().sort((a,b)=>(isDir(b)-isDir(a))||(key(a)<key(b)?-d:key(a)>key(b)?d:0))};
  const parent=l=>l.k==="bk"?(()=>{const b=byId(l.id);return b?{k:"month",ym:ymOf(b)}:{k:"root"}})():l.k==="month"?{k:"year",y:l.ym.slice(0,4)}:{k:"root"};
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const ctxBooking=()=>{if(loc.k==="bk"&&!q)return byId(loc.id);const s=selItems();return s.length===1&&s[0].t==="bk"?s[0].b:s.length&&s.every(i=>i.t==="file"&&i.b===s[0].b)?s[0].b:null};
  const selItems=()=>items.filter(i=>sel.has(i.id));
  // ---------- storage ----------
  const signed=async(path,dl)=>{const{data,error}=await sb.storage.from("reports").createSignedUrl(path,300,dl?{download:dl}:undefined);if(error){fail(error);return null}return data.signedUrl};
  const uploadTo=async(b,file)=>{const path=`${b.id}/${Date.now()}-${Math.random().toString(36).slice(2,6)}.pdf`;
    let r=await sb.storage.from("reports").upload(path,file,{contentType:"application/pdf"});if(r.error)throw r.error;
    r=await sb.rpc("staff_upload_report",{p_booking_id:b.id,p_path:path});if(r.error){await sb.storage.from("reports").remove([path]);throw r.error}sizes[path]=file.size;return path};
  const removeRep=async rep=>{const r1=await sb.storage.from("reports").remove([rep.path]);if(r1.error)throw r1.error;
    const r2=await sb.from("reports").delete().eq("id",rep.id);if(r2.error)throw r2.error};
  const loadSizes=async b=>{const key=(b.reports||[]).map(r=>r.id).join();if(!key||sized[b.id]===key)return;sized[b.id]=key;
    const{data}=await sb.storage.from("reports").list(b.id,{limit:100});(data||[]).forEach(o=>{if(o.metadata?.size!=null)sizes[`${b.id}/${o.name}`]=o.metadata.size});draw()};
  const kb=n=>n==null?"":n<1048576?Math.max(1,Math.round(n/1024))+" KB":(n/1048576).toFixed(1)+" MB";
  // ---------- file picking / uploading ----------
  const hidden=document.createElement("input");hidden.type="file";hidden.accept="application/pdf";hidden.hidden=true;document.body.appendChild(hidden);
  const pickFiles=multi=>new Promise(ok=>{hidden.multiple=multi;hidden.value="";hidden.onchange=()=>ok([...hidden.files]);hidden.click()});
  async function uploadMany(b,files){const good=files.filter(okPdf),bad=files.length-good.length;
    if(bad)toast(`${bad} file${bad>1?"s":""} skipped: only PDFs up to 10 MB`,false);if(!good.length)return;let done=0;
    try{for(const f of good){busy=`Uploading ${done+1} of ${good.length} to ${b.ref}…`;drawStatus();await uploadTo(b,f);done++}
      toast(`${done} PDF${done>1?"s":""} uploaded for ${b.patient_name}. The patient can download ${done>1?"them":"it"} now.`);
      if(!(loc.k==="bk"&&loc.id===b.id))go({k:"bk",id:b.id})}
    catch(err){fail(err)}finally{busy="";drawStatus()}}
  function choosePatient(files){
    const body=openModal("Upload to which patient?",`<p class="muted" style="margin-top:0">Reports live inside each patient's booking folder. Pick the booking first${files?`, then your ${files.length} file${files.length>1?"s":""} upload straight away`:""}.</p>
      <input id="fxPickQ" placeholder="Patient name, booking ref, phone or sample ID…" autocomplete="off"><div class="fx-picks" id="fxPicks"></div>`);
    const inp=body.querySelector("#fxPickQ"),out=body.querySelector("#fxPicks");
    const paint=()=>{const s=inp.value.trim().toLowerCase();
      const hits=(s?rows.filter(b=>b.status!=="Cancelled"&&`${b.ref} ${b.patient_name} ${b.phone||""} ${b.sample_id||""}`.toLowerCase().includes(s)):waiting()).slice(0,8);
      out.innerHTML=(s?"":`<small class="muted fx-picks-h">Waiting for a report</small>`)+(hits.length?hits.map(b=>`<button type="button" class="fx-pick" data-pick="${b.id}"><span class="fx-ico sm">${FX_ICO.folder((b.reports||[]).length)}</span><span><b>${esc(b.ref)} – ${esc(b.patient_name)}</b><small class="muted">${b.collect_date?fmt(b.collect_date):""} · ${esc(b.status)} · ${(b.reports||[]).length} PDF${(b.reports||[]).length===1?"":"s"}</small></span></button>`).join(""):'<p class="muted" style="font-size:13px">No booking found.</p>')};
    inp.addEventListener("input",paint);paint();setTimeout(()=>inp.focus(),30);
    out.addEventListener("click",async e=>{const h=e.target.closest("[data-pick]");if(!h)return;const b=byId(h.dataset.pick);
      if(files){closeModal();uploadMany(b,files)}else{const p=pickFiles(true);closeModal();const f=await p;if(f.length)uploadMany(b,f)}})}
  async function doUpload(){const b=ctxBooking();if(!b)return choosePatient(null);const f=await pickFiles(true);if(f.length)uploadMany(b,f)}
  // ---------- actions ----------
  function openItem(i){if(!i)return;if(i.t==="dir")go(i.go);else if(i.t==="bk")go({k:"bk",id:i.b.id});else viewFile(i)}
  async function viewFile(i){const w=window.open("","_blank");const u=await signed(i.r.path);if(u&&w)w.location=u;else if(w)w.close()}
  async function download(arr){for(const i of arr){const u=await signed(i.r.path,i.name);if(!u)return;const a=document.createElement("a");a.href=u;a.download=i.name;document.body.appendChild(a);a.click();a.remove();await new Promise(r=>setTimeout(r,350))}}
  async function replace(i){const[f]=await pickFiles(false);if(!f)return;if(!okPdf(f))return toast("Choose a PDF up to 10 MB",false);
    busy=`Replacing ${i.name}…`;drawStatus();try{await uploadTo(i.b,f);await removeRep(i.r);delete urls[i.r.path];toast(`${i.name} replaced. The patient now sees the new file.`)}catch(err){fail(err)}finally{busy="";drawStatus()}}
  function del(arr){if(!arr.length)return;const byBk=new Map();arr.forEach(i=>byBk.set(i.b,[...(byBk.get(i.b)||[]),i]));
    const back=[...byBk].filter(([b,fs])=>b.status==="Report ready"&&fs.length>=(b.reports||[]).length).map(([b])=>b);
    const body=openModal(arr.length>1?`Delete ${arr.length} PDFs?`:"Delete this PDF?",`<p>${arr.length>1?`These <b>${arr.length} files</b> will`:`<b>${esc(arr[0].name)}</b> for <b>${esc(arr[0].b.patient_name)}</b> will`} be deleted permanently. Patients won't be able to download ${arr.length>1?"them":"it"} any more.</p>
      ${back.length?`<div class="notice">${back.length>1?`${back.length} bookings`:esc(back[0].ref)} will have no report left, so the status goes back to <b>Processing started</b>.</div>`:""}
      <div class="modal-actions"><button type="button" class="light" data-close>Keep</button><button type="button" class="danger" id="fxDelOk">Delete</button></div>`);
    body.querySelector("#fxDelOk").onclick=async ev=>{ev.target.disabled=true;ev.target.textContent="Deleting…";
      try{for(const i of arr)await removeRep(i.r);for(const b of back)await sb.from("bookings").update({status:"Processing started"}).eq("id",b.id);
        closeModal();sel.clear();toast(arr.length>1?`${arr.length} PDFs deleted`:"PDF deleted")}catch(err){ev.target.disabled=false;ev.target.textContent="Delete";fail(err)}}}
  function act(a){const s=selItems(),files=s.filter(i=>i.t==="file");
    ({back:()=>{if(hist.length){fwd.push(loc);go(hist.pop(),false)}},fwd:()=>{if(fwd.length){hist.push(loc);go(fwd.pop(),false)}},
      up:()=>{if(q){clearQ();return}if(loc.k!=="root")go(parent(loc))},upload:doUpload,open:()=>openItem(s[0]),
      download:()=>download(files),replace:()=>files.length===1&&replace(files[0]),delete:()=>del(files),
      details:()=>{mode="details";save("lm_fx_view",mode);draw()},tiles:()=>{mode="tiles";save("lm_fx_view",mode);draw()},
      pane:()=>{pane=!pane;save("lm_fx_pane",pane?"1":"0");draw()},nav:()=>root.classList.toggle("nav-open"),
      selall:()=>{items.forEach(i=>sel.add(i.id));paintSel()}})[a]?.()}
  // ---------- navigation ----------
  function go(l,push=true){if(push&&!same(l,loc)){hist.push(loc);fwd=[]}loc=l;q="";$("#fxSearch").value="";sel.clear();anchor=null;
    if(l.k==="year")expanded.add(l.y);if(l.k==="month"||l.k==="bk"){const ym=l.k==="month"?l.ym:ymOf(byId(l.id)||{});expanded.add(ym.slice(0,4))}
    root.classList.remove("nav-open");draw();list.scrollTop=0}
  const clearQ=()=>{q="";$("#fxSearch").value="";sel.clear();draw()};
  const crumbs=()=>{if(q)return[{n:"Reports",l:{k:"root"}},{n:`Search results for “${q}”`}];
    const c=[{n:"Reports",l:{k:"root"}}];
    if(loc.k==="recent")return[{n:"Quick access"},{n:"Recent uploads"}];if(loc.k==="waiting")return[{n:"Quick access"},{n:"Waiting for report"}];
    let ym=loc.k==="month"?loc.ym:loc.k==="bk"?ymOf(byId(loc.id)||{}):"",y=loc.k==="year"?loc.y:ym.slice(0,4);
    if(y)c.push({n:y,l:{k:"year",y}});if(ym)c.push({n:FX_MONTHS[+ym.slice(5)-1],l:{k:"month",ym}});
    if(loc.k==="bk"){const b=byId(loc.id);if(b)c.push({n:`${b.ref} – ${b.patient_name}`,l:loc})}return c};
  // ---------- drawing ----------
  const icon=(i,big)=>`<span class="fx-ico${big?" big":""}">${i.t==="file"?FX_ICO.pdf:FX_ICO.folder(i.n>0)}</span>`;
  const typeOf=i=>i.t==="file"?"PDF Document":i.t==="bk"?"Patient folder":"File folder";
  const sizeOf=i=>i.t==="file"?kb(sizes[i.r.path]):i.t==="bk"?(i.n?`${i.n} file${i.n>1?"s":""}`:"Empty"):`${i.n} booking${i.n>1?"s":""}`;
  const infoOf=i=>i.t==="bk"?`<span class="pill ${statusMeta(i.b.status).cls}">${esc(i.b.status)}</span>`:i.t==="file"?esc(i.b.patient_name):"";
  const dateOf=i=>!i.date?"—":i.t==="file"?fmtDT(i.date):fmt(i.date);
  function drawTree(){const ys=years(),cur=l=>!q&&same(l,loc)?" on":"",wn=waiting().length;
    $("#fxNav").innerHTML=`<div class="fx-nav-h">Quick access</div>
      <button type="button" class="fx-node${cur({k:"recent"})}" data-go='{"k":"recent"}'><span class="fx-nico">${FX_ICO.clock}</span>Recent uploads</button>
      <button type="button" class="fx-node${cur({k:"waiting"})}" data-go='{"k":"waiting"}'><span class="fx-nico wait">${FX_ICO.wait}</span>Waiting for report${wn?`<span class="fx-badge">${wn}</span>`:""}</button>
      <div class="fx-nav-h">This lab</div>
      <button type="button" class="fx-node${cur({k:"root"})}" data-go='{"k":"root"}'><span class="fx-nico drive">${FX_ICO.drive}</span>Reports</button>
      ${Object.keys(ys).sort().reverse().map(y=>{const op=expanded.has(y);
        return`<div class="fx-tree-row"><button type="button" class="fx-tw${op?" open":""}" data-tw="${y}" aria-label="${op?"Collapse":"Expand"} ${y}">${FX_ICO.chev}</button><button type="button" class="fx-node l1${cur({k:"year",y})}" data-go='{"k":"year","y":"${y}"}'><span class="fx-ico xs">${FX_ICO.folder(1)}</span>${y}</button></div>`
        +(op?Object.keys(months(y)).sort().reverse().map(ym=>`<button type="button" class="fx-node l2${cur({k:"month",ym})}" data-go='{"k":"month","ym":"${ym}"}'><span class="fx-ico xs">${FX_ICO.folder(1)}</span>${FX_MONTHS[+ym.slice(5)-1]}</button>`).join(""):"")}).join("")}`}
  function drawList(){items=sorted(itemsFor(loc));const keep=new Set(items.map(i=>i.id));[...sel].forEach(id=>keep.has(id)||sel.delete(id));
    const arrow=c=>sort.c===c?`<i>${sort.d>0?"▲":"▼"}</i>`:"";
    const head=mode==="details"?`<div class="fx-head"><button type="button" data-sort="name">Name${arrow("name")}</button><button type="button" data-sort="date">Date modified${arrow("date")}</button><button type="button" data-sort="type">Type${arrow("type")}</button><button type="button" data-sort="size">Size${arrow("size")}</button><span>${loc.k==="bk"&&!q?"Patient":"Status"}</span></div>`:"";
    const empty=q?`<div class="fx-empty"><b>No items match your search.</b><span>Try a patient name, booking ref, phone number or sample ID.</span></div>`
      :loc.k==="bk"?`<div class="fx-empty">${FX_ICO.pdf}<b>This folder is empty</b><span>Drag PDF files here to upload them for this patient, or</span><button type="button" class="green sm" data-act="upload">${FX_ICO.upload}Upload PDF</button></div>`
      :loc.k==="waiting"?`<div class="fx-empty"><b>Every booking has its report 🎉</b></div>`:`<div class="fx-empty"><b>Nothing here yet</b><span>Folders appear as bookings come in.</span></div>`;
    list.className="fx-list "+mode;
    list.innerHTML=head+(items.length?`<div class="fx-items">${items.map(i=>mode==="details"
      ?`<div class="fx-item" data-id="${i.id}">${icon(i)}<span class="fx-name" title="${esc(i.name)}">${esc(i.name)}</span><span class="fx-c">${dateOf(i)}</span><span class="fx-c">${typeOf(i)}</span><span class="fx-c">${sizeOf(i)}</span><span class="fx-c">${infoOf(i)}</span></div>`
      :`<div class="fx-item" data-id="${i.id}" title="${esc(i.name)}">${icon(i,1)}<span class="fx-name">${i.t==="bk"?`${esc(i.b.ref)}<small>${esc(i.b.patient_name)}</small>`:esc(i.name)}</span></div>`).join("")}</div>`:empty);
    paintSel();if(loc.k==="bk"&&!q){const b=byId(loc.id);if(b)loadSizes(b)}}
  function paintSel(){list.querySelectorAll(".fx-item").forEach(el=>el.classList.toggle("sel",sel.has(el.dataset.id)));drawTools();drawStatus();drawPane()}
  function drawTools(){const s=selItems(),f=s.filter(i=>i.t==="file"),only=f.length&&f.length===s.length;
    const en={back:hist.length,fwd:fwd.length,up:q||loc.k!=="root",open:s.length===1,download:only,replace:only&&f.length===1,delete:only};
    root.querySelectorAll("[data-act]").forEach(b=>{if(b.dataset.act in en)b.disabled=!en[b.dataset.act]});
    root.querySelectorAll("[data-act=details],[data-act=tiles]").forEach(b=>b.classList.toggle("on",b.dataset.act===mode));
    root.querySelector("[data-act=pane]").classList.toggle("on",pane);root.classList.toggle("no-pane",!pane);
    const b=ctxBooking();$("#fxUpLabel").textContent=b?`Upload to ${b.ref}`:"Upload";
    $("#fxCrumbs").innerHTML=crumbs().map((c,i,a)=>(i?`<span class="fx-sep">${FX_ICO.chev}</span>`:`<span class="fx-ico xs">${q?FX_ICO.search:i===0&&a[0].l?FX_ICO.folder(1):FX_ICO.clock}</span>`)+(c.l&&i<a.length-1?`<button type="button" data-crumb='${JSON.stringify(c.l)}'>${esc(c.n)}</button>`:`<b>${esc(c.n)}</b>`)).join("")}
  function drawStatus(){const n=items.length,s=sel.size;
    $("#fxStatus").innerHTML=`<span>${n} item${n===1?"":"s"}</span>${s?`<span>${s} item${s===1?"":"s"} selected</span>`:""}${busy?`<span class="fx-busy"><i></i>${esc(busy)}</span>`:""}<span class="fx-live"><i></i>Live · ${allFiles().length} PDFs · ${waiting().length} waiting</span>`}
  let paneKey="";
  function drawPane(){if(!pane)return;const el=$("#fxPane"),s=selItems();
    const target=s.length===1?s[0]:!s.length&&loc.k==="bk"&&!q&&byId(loc.id)?bkItem(byId(loc.id)):null,key=s.length>1?"multi"+s.length:target?target.id+(target.t==="bk"?target.b.status+target.n:""):"loc"+JSON.stringify(loc)+items.length;
    if(key===paneKey)return;paneKey=key;
    if(s.length>1){el.innerHTML=`<div class="fx-p-ico">${FX_ICO.pdf}</div><b class="fx-p-name">${s.length} items selected</b>`;return}
    if(!target){el.innerHTML=`<div class="fx-p-ico">${FX_ICO.folder(items.length)}</div><b class="fx-p-name">${esc(crumbs().pop().n)}</b><p class="muted">${items.length} item${items.length===1?"":"s"}</p><p class="fx-p-tip">Select a file to preview it here.<br>Double-click a folder to open it.</p>`;return}
    if(target.t==="dir"){el.innerHTML=`<div class="fx-p-ico">${FX_ICO.folder(1)}</div><b class="fx-p-name">${esc(target.name)}</b><p class="muted">File folder · ${sizeOf(target)}</p>`;return}
    const b=target.b,info=`<dl class="fx-dl"><dt>Patient</dt><dd>${esc(b.patient_name)}${b.patient_age?` · ${esc(ageText(b.patient_age,b.patient_age_unit,true))}`:""}${b.patient_gender?` · ${esc(b.patient_gender)}`:""}</dd>
      <dt>Booking</dt><dd>${esc(b.ref)}${b.sample_id?` · Sample ${esc(b.sample_id)}`:""}</dd>${b.phone?`<dt>Phone</dt><dd>${esc(b.phone)}</dd>`:""}
      <dt>Visit</dt><dd>${b.collect_date?fmt(b.collect_date):"—"}${b.slot?` · ${esc(b.slot)}`:""}</dd><dt>Status</dt><dd><span class="pill ${statusMeta(b.status).cls}">${esc(b.status)}</span></dd>
      <dt>Tests</dt><dd><div class="cell-tests">${(b.booking_items||[]).map(t=>`<span class="test-chip">${esc(t.name)}</span>`).join("")||"—"}</div></dd></dl>`;
    if(target.t==="bk"){el.innerHTML=`<div class="fx-p-ico">${FX_ICO.folder(target.n)}</div><b class="fx-p-name">${esc(target.name)}</b><p class="muted">${sizeOf(target)}</p>${info}<button type="button" class="green sm fx-p-btn" data-act="upload">${FX_ICO.upload}Upload PDF here</button>`;return}
    el.innerHTML=`<div class="fx-prev"><div class="fx-prev-load">Loading preview…</div></div><b class="fx-p-name">${esc(target.name)}</b><p class="muted">PDF Document${sizes[target.r.path]?` · ${kb(sizes[target.r.path])}`:""}<br>Uploaded ${target.date?fmtDT(target.date):"—"}</p>
      <div class="fx-p-acts"><button type="button" class="light sm" data-act="open">${FX_ICO.open}Open</button><button type="button" class="light sm" data-act="download">${FX_ICO.dl}Download</button></div>${info}`;
    const path=target.r.path,show=u=>{const box=el.querySelector(".fx-prev");if(box&&paneKey===key)box.innerHTML=`<iframe src="${u}#toolbar=0&navpanes=0&view=FitH" title="Preview of ${esc(target.name)}"></iframe>`};
    const c=urls[path];if(c&&c.exp>Date.now())show(c.u);else signed(path).then(u=>{if(u){urls[path]={u,exp:Date.now()+240000};show(u)}})}
  function draw(){drawTree();drawList()}
  // ---------- events ----------
  root.addEventListener("click",e=>{const a=e.target.closest("[data-act]");if(a&&!a.disabled){act(a.dataset.act);return}
    const g=e.target.closest("[data-go],[data-crumb]");if(g){go(JSON.parse(g.dataset.go||g.dataset.crumb));return}
    const tw=e.target.closest("[data-tw]");if(tw){const y=tw.dataset.tw;expanded.has(y)?expanded.delete(y):expanded.add(y);drawTree();return}
    const so=e.target.closest("[data-sort]");if(so){const c=so.dataset.sort;sort=sort.c===c?{c,d:-sort.d}:{c,d:c==="name"||c==="type"?1:-1};drawList();return}});
  list.addEventListener("click",e=>{const it=e.target.closest(".fx-item");list.focus({preventScroll:true});
    if(!it){if(!e.target.closest("button")){sel.clear();paintSel()}return}const id=it.dataset.id;
    if(e.shiftKey&&anchor){const ids=items.map(i=>i.id),a=ids.indexOf(anchor),b=ids.indexOf(id);if(!(e.ctrlKey||e.metaKey))sel.clear();ids.slice(Math.min(a,b),Math.max(a,b)+1).forEach(x=>sel.add(x))}
    else if(e.ctrlKey||e.metaKey){sel.has(id)?sel.delete(id):sel.add(id);anchor=id}else{sel=new Set([id]);anchor=id}paintSel()});
  list.addEventListener("dblclick",e=>{const it=e.target.closest(".fx-item");if(it)openItem(items.find(i=>i.id===it.dataset.id))});
  list.addEventListener("keydown",e=>{const k=e.key,ids=items.map(i=>i.id),cur=ids.indexOf(anchor);
    if(k==="Enter"){e.preventDefault();const s=selItems();if(s.length===1)openItem(s[0]);else if(s.length&&s.every(i=>i.t==="file"))s.forEach(viewFile);return}
    if(k==="Delete"){e.preventDefault();const f=selItems().filter(i=>i.t==="file");if(f.length)del(f);return}
    if(k==="Backspace"||(e.altKey&&k==="ArrowUp")){e.preventDefault();act("up");return}
    if(e.altKey&&k==="ArrowLeft"){e.preventDefault();act("back");return}if(e.altKey&&k==="ArrowRight"){e.preventDefault();act("fwd");return}
    if((e.ctrlKey||e.metaKey)&&k.toLowerCase()==="a"){e.preventDefault();act("selall");return}
    const step={ArrowDown:1,ArrowRight:mode==="tiles"?1:0,ArrowUp:-1,ArrowLeft:mode==="tiles"?-1:0,Home:-1e9,End:1e9}[k];if(step===undefined||!ids.length)return;
    e.preventDefault();if(!step)return;const from=cur<0?(step>0?-1:ids.length):cur;let n=Math.max(0,Math.min(ids.length-1,from+step));
    if(mode==="tiles"&&(k==="ArrowDown"||k==="ArrowUp")&&cur>=0){const per=Math.max(1,Math.floor(list.querySelector(".fx-items").clientWidth/list.querySelector(".fx-item").offsetWidth));n=Math.max(0,Math.min(ids.length-1,cur+(k==="ArrowDown"?per:-per)))}
    sel=new Set([ids[n]]);anchor=ids[n];paintSel();list.querySelector(`[data-id="${ids[n]}"]`)?.scrollIntoView({block:"nearest"})});
  // context menu
  const closeMenu=()=>{menu.hidden=true};
  list.addEventListener("contextmenu",e=>{e.preventDefault();const it=e.target.closest(".fx-item");
    if(it&&!sel.has(it.dataset.id)){sel=new Set([it.dataset.id]);anchor=it.dataset.id;paintSel()}if(!it&&sel.size){sel.clear();paintSel()}
    const s=selItems(),f=s.filter(i=>i.t==="file"),only=f.length&&f.length===s.length,b=ctxBooking();
    const opts=s.length?[[s.length===1,"open",FX_ICO.open,s[0]?.t==="file"?"Open":"Open folder"],[only,"download",FX_ICO.dl,f.length>1?`Download ${f.length} files`:"Download"],[only&&f.length===1,"replace",FX_ICO.replace,"Replace with new PDF…"],[!!b,"upload",FX_ICO.upload,b?`Upload PDF to ${b.ref}…`:""],"-",[only,"delete",FX_ICO.del,"Delete",1]]
      :[[1,"upload",FX_ICO.upload,b?`Upload PDF to ${b.ref}…`:"Upload PDF…"],"-",[1,"details",FX_ICO.details,"View: Details"],[1,"tiles",FX_ICO.tiles,"View: Large icons"],[1,"selall",FX_ICO.details,"Select all"]];
    menu.innerHTML=opts.filter(o=>o==="-"||o[0]).map(o=>o==="-"?"<hr>":`<button type="button" data-m="${o[1]}"${o[4]?' class="danger-t"':""}>${o[2]}${esc(o[3])}</button>`).join("");
    menu.hidden=false;const r=menu.getBoundingClientRect();menu.style.left=Math.min(e.clientX,innerWidth-r.width-8)+"px";menu.style.top=Math.min(e.clientY,innerHeight-r.height-8)+"px"});
  menu.addEventListener("click",e=>{const m=e.target.closest("[data-m]");if(!m)return;closeMenu();act(m.dataset.m)});
  document.addEventListener("click",e=>{if(!menu.contains(e.target))closeMenu()});document.addEventListener("keydown",e=>{if(e.key==="Escape")closeMenu()});
  addEventListener("scroll",closeMenu,true);addEventListener("resize",closeMenu);
  // drag & drop PDFs from the computer
  let dropTo=null;const hasFiles=e=>[...(e.dataTransfer?.types||[])].includes("Files");
  list.addEventListener("dragover",e=>{if(!hasFiles(e))return;e.preventDefault();const it=e.target.closest(".fx-item"),i=it&&items.find(x=>x.id===it.dataset.id);
    list.querySelectorAll(".fx-item.drop").forEach(x=>x!==it&&x.classList.remove("drop"));
    const b=i&&i.t==="bk"?i.b:loc.k==="bk"&&!q?byId(loc.id):null;if(i&&i.t==="bk")it.classList.add("drop");
    dropTo=b;list.classList.add("dragging");list.dataset.drop=b?`Drop to upload to ${b.ref} – ${b.patient_name}`:"Drop to upload. You'll pick the patient next."});
  list.addEventListener("dragleave",e=>{if(!list.contains(e.relatedTarget)){list.classList.remove("dragging");list.querySelectorAll(".fx-item.drop").forEach(x=>x.classList.remove("drop"))}});
  list.addEventListener("drop",e=>{if(!hasFiles(e))return;e.preventDefault();list.classList.remove("dragging");list.querySelectorAll(".fx-item.drop").forEach(x=>x.classList.remove("drop"));
    const f=[...e.dataTransfer.files];if(!f.length)return;dropTo?uploadMany(dropTo,f):choosePatient(f)});
  // search
  $("#fxSearch").addEventListener("input",e=>{q=e.target.value.trim();sel.clear();anchor=null;drawList();drawTree()});
  $("#fxSearch").addEventListener("keydown",e=>{if(e.key==="Escape"&&q)clearQ();if(e.key==="ArrowDown"){e.preventDefault();list.focus()}});
  // Toolbar icons (markup stays light in the HTML)
  root.querySelectorAll("[data-ico]").forEach(el=>el.insertAdjacentHTML("afterbegin",FX_ICO[el.dataset.ico]));
  draw();
  return{setRows(r){rows=r;if(loc.k==="bk"&&!byId(loc.id))loc={k:"root"};draw()}}}
// Mirror a wide table's horizontal scrollbar above it, so you can scroll sideways without going to the bottom.
function topScroll(bar,wrap){if(!bar||!wrap)return;const inner=bar.firstElementChild;
  const size=()=>{inner.style.width=wrap.scrollWidth+"px";bar.hidden=wrap.scrollWidth<=wrap.clientWidth+1;bar.scrollLeft=wrap.scrollLeft};
  const sync=(from,to)=>()=>{if(to.scrollLeft!==from.scrollLeft)to.scrollLeft=from.scrollLeft};
  bar.addEventListener("scroll",sync(bar,wrap));wrap.addEventListener("scroll",sync(wrap,bar));
  const ro=new ResizeObserver(size);ro.observe(wrap);if(wrap.firstElementChild)ro.observe(wrap.firstElementChild);
  new MutationObserver(size).observe(wrap,{childList:true,subtree:true});size()}
async function initAdmin(){const body=$("#bookingRows");if(!body||!await guard(["admin"],"login.html"))return;
  $("#logout").onclick=async e=>{e.preventDefault();await sb.auth.signOut();location.href="login.html"};
  // Sidebar tabs: the URL hash (#bookings, #reports...) decides which section is visible.
  let refreshUsers=null; // set once the Users tab code below is ready
  const showTab=()=>{const t=(location.hash||"#overview").slice(1);const valid=$(`[data-tab="${t}"]`)?t:"overview";
    if((valid==="users"||valid==="staffaccess")&&refreshUsers)refreshUsers();
    document.querySelectorAll("[data-tab]").forEach(s=>s.hidden=s.dataset.tab!==valid);
    document.querySelectorAll("[data-tab-link]").forEach(a=>a.classList.toggle("active",a.dataset.tabLink===valid));
    document.dispatchEvent(new CustomEvent("lm-tab",{detail:valid}));
    window.scrollTo(0,0)};
  window.addEventListener("hashchange",showTab);showTab();
  // --- Cash tab: who collected what, what was handed over, what's still with staff ---
  let adminRows=[],handovers=[];
  const drawCash=()=>{const ledger=cashLedger(adminRows,handovers),staff=ledger.filter(p=>!p.office);
    const collected=ledger.reduce((s,p)=>s+p.collected,0),handed=handovers.reduce((s,h)=>s+h.amount,0),
      waiting=handovers.filter(h=>!h.received).reduce((s,h)=>s+h.amount,0),withStaff=staff.reduce((s,p)=>s+Math.max(0,p.inHand),0);
    $("#cashWithStaff").textContent=money(withStaff);
    $("#cashTiles").innerHTML=`<div class="stat"><span>Cash collected</span><b>${money(collected)}</b><em>All cash bookings marked paid</em></div>
      <div class="stat"><span>Handed to office</span><b>${money(handed)}</b><em>Recorded by staff</em></div>
      <div class="stat"><span>Awaiting your confirmation</span><b>${money(waiting)}</b><em>Handovers not yet confirmed</em></div>
      <div class="stat"><span>Still with staff</span><b>${money(withStaff)}</b><em>Collected but not handed over</em></div>`;
    $("#cashPeople").innerHTML=ledger.map(p=>`<tr><td><b>${esc(p.office?"Office (marked paid by admin)":p.name)}</b></td><td>${p.jobs}</td><td>${money(p.collected)}</td><td>${p.office?"—":money(p.handed)}</td><td>${p.office?"—":`<span class="pill ${p.inHand>0?"amber":"green"}">${money(p.inHand)}</span>`}</td></tr>`).join("")
      ||'<tr><td colspan="5" class="muted">No cash collected yet.</td></tr>';
    $("#cashHandovers").innerHTML=handovers.map(h=>`<tr><td>${fmt(h.created_at)}<br><small class="muted">${new Date(h.created_at).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}</small></td><td><b>${esc(h.handed_by)}</b></td><td><b>${money(h.amount)}</b></td><td style="white-space:normal;max-width:260px">${esc(h.note||"—")}</td>
      <td>${h.received?`<span class="pill green">Received${h.received_at?" · "+fmt(h.received_at):""}</span>`:`<button class="green" data-receive="${h.id}" style="padding:7px 12px;font-size:12px">Confirm received</button>`}</td></tr>`).join("")
      ||'<tr><td colspan="5" class="muted">No handovers recorded yet.</td></tr>'};
  liveHandovers(d=>{handovers=d;drawCash()});
  $("#cashHandovers").addEventListener("click",async e=>{const b=e.target.closest("[data-receive]");if(!b)return;b.disabled=true;
    const{error}=await sb.from("cash_handovers").update({received:true,received_at:new Date().toISOString()}).eq("id",b.dataset.receive);
    if(error){b.disabled=false;return fail(error)}toast("Marked as received")});
  topScroll($("#bkTopScroll"),$("#bkTableWrap"));const analytics=adminAnalytics();adminLive();const files=adminFiles();
  bookingsTable(body,rows=>{adminRows=rows;drawCash();analytics.setRows(rows);files.setRows(rows);
    $("#recentRows").innerHTML=rows.slice(0,5).map(b=>`<tr><td><b>${esc(b.ref)}</b></td><td>${esc(b.patient_name)}</td><td>${fmt(b.collect_date)} · ${esc(b.slot)}</td><td>${money(b.total)}</td><td><span class="pill ${statusMeta(b.status).cls}">${esc(b.status)}</span></td><td>${esc(b.payment)} · ${esc(b.payment_method||"Cash")}</td></tr>`).join("")||'<tr><td colspan="6" class="muted">No bookings yet.</td></tr>';
    const t=today(),live=rows.filter(x=>x.status!=="Cancelled");
    $("#bookingCount").textContent=rows.length;$("#todayCount").textContent=rows.filter(x=>new Date(x.created_at).toLocaleDateString("en-CA")===t).length;
    $("#pendingCount").textContent=live.filter(x=>["Confirmed","Assigned"].includes(x.status)).length;
    $("#labCount").textContent=live.filter(x=>["Handed over to lab","Lab received sample","Processing started"].includes(x.status)).length;
    $("#repPending").textContent=live.filter(x=>!x.reports.length).length});

  // --- Users tab ---
  let users=[];
  const loadUsers=async()=>{const[{data:profiles,error},{data:addrs},{data:bks}]=await Promise.all([
      sb.from("profiles").select("*").order("created_at",{ascending:false}),
      sb.from("addresses").select("user_id,label,address,area").order("created_at",{ascending:false}),
      sb.from("bookings").select("user_id,address,area,created_at").order("created_at",{ascending:false})]);
    if(error)return fail(error);
    users=(profiles||[]).map(p=>{const mine=(bks||[]).filter(b=>b.user_id===p.id);
      return{...p,saved:(addrs||[]).filter(a=>a.user_id===p.id),bookings:mine.length,lastAt:mine[0]?.created_at||null,lastAddr:mine[0]?`${mine[0].address}, ${mine[0].area}`:""}});
    drawUsers()};
  refreshUsers=async()=>{await loadUsers();drawStaffAccess()};
  const filteredUsers=()=>{const q=$("#userSearch").value.trim().toLowerCase(),role=$("#userRole").value;
    return users.filter(u=>(role==="all"||u.role===role)&&[u.full_name,u.phone,u.email,u.gender,u.lastAddr,...u.saved.map(a=>`${a.label} ${a.address} ${a.area}`)].join(" ").toLowerCase().includes(q))};
  const drawUsers=()=>{const list=filteredUsers();
    $("#userCount").textContent=`${list.length} ${list.length===1?"user":"users"}`;
    $("#userRows").innerHTML=list.map(u=>{
      const addr=u.saved.length?u.saved.map(a=>`<div class="user-addr">${a.label?`<b>${esc(a.label)}:</b> `:""}${esc(a.address)}, ${esc(a.area)}</div>`).join("")
        :u.lastAddr?`<div class="user-addr">${esc(u.lastAddr)} <span class="muted">(from last booking)</span></div>`:'<span class="muted">—</span>';
      const initials=(u.full_name||u.email||"?").trim().split(/\s+/).map(w=>w[0]).slice(0,2).join("").toUpperCase();
      return`<tr><td><div class="user-name"><span class="user-avatar">${esc(initials)}</span><div><b>${esc(u.full_name||"No name")}</b>${u.role!=="patient"?` <span class="pill blue">${esc(u.role)}</span>`:""}</div></div></td>
        <td>${u.age!=null||u.gender?`${u.age!=null?u.age+" y":""}${u.age!=null&&u.gender?" · ":""}${esc(u.gender||"")}`:'<span class="muted">—</span>'}</td>
        <td>${u.phone?`<a href="tel:${esc(u.phone.replace(/\s/g,""))}">${esc(u.phone)}</a>`:'<span class="muted">—</span>'}</td>
        <td>${u.email?`<a href="mailto:${esc(u.email)}">${esc(u.email)}</a>`:'<span class="muted">—</span>'}</td>
        <td class="user-addr-cell">${addr}</td><td><b>${u.bookings}</b></td><td>${u.created_at?fmt(u.created_at):"—"}</td></tr>`}).join("")
      ||`<tr><td colspan="7" class="muted">${users.length?"No users match your search.":"No users yet."}</td></tr>`};
  // --- Staff access tab ---
  const personCells=u=>`<td><div class="user-name"><span class="user-avatar">${esc((u.full_name||u.email||"?").trim().split(/\s+/).map(w=>w[0]).slice(0,2).join("").toUpperCase())}</span><b>${esc(u.full_name||"No name")}</b></div></td><td>${esc(u.phone||"—")}</td><td>${esc(u.email||"—")}</td>`;
  const drawStaffAccess=()=>{const staff=users.filter(u=>u.role==="staff");
    $("#staffCountPill").textContent=`${staff.length} staff`;
    $("#staffAccessRows").innerHTML=staff.map(u=>`<tr>${personCells(u)}<td>${u.created_at?fmt(u.created_at):"—"}</td><td><button type="button" class="light sm" data-role-set="patient" data-uid="${u.id}">Remove access</button></td></tr>`).join("")
      ||'<tr><td colspan="5" class="muted">No staff yet. Search for an account below to give staff access.</td></tr>';
    const q=$("#saSearch").value.trim().toLowerCase(),box=$("#saResults");
    if(q.length<2){box.innerHTML="";return}
    const found=users.filter(u=>u.role==="patient"&&[u.full_name,u.phone,u.email].join(" ").toLowerCase().includes(q)).slice(0,8);
    box.innerHTML=found.length?found.map(u=>`<div class="sa-row"><div class="user-name"><span class="user-avatar">${esc((u.full_name||u.email||"?").trim().split(/\s+/).map(w=>w[0]).slice(0,2).join("").toUpperCase())}</span><div><b>${esc(u.full_name||"No name")}</b><div class="muted" style="font-size:12px">${esc([u.phone,u.email].filter(Boolean).join(" · ")||"No contact details")}</div></div></div><button type="button" class="green sm" data-role-set="staff" data-uid="${u.id}">Give staff access</button></div>`).join("")
      :'<p class="muted" style="font-size:13px;margin:12px 2px 0">No matching patient account. They need to sign up on the website first.</p>'};
  $("#saSearch").addEventListener("input",drawStaffAccess);
  $("[data-tab=staffaccess]").addEventListener("click",e=>{const b=e.target.closest("[data-role-set]");if(!b)return;
    const u=users.find(x=>x.id===b.dataset.uid),toStaff=b.dataset.roleSet==="staff";if(!u)return;
    const body=openModal(toStaff?"Give staff access?":"Remove staff access?",`<p><b>${esc(u.full_name||"This account")}</b>${u.phone||u.email?` (${esc(u.phone||u.email)})`:""} ${toStaff
        ?"will be able to use the staff portal: see every booking's patient details and address, update collection status, mark cash collected and upload reports."
        :"will go back to a normal patient account and lose access to the staff portal."}</p>
      <div class="modal-actions"><button type="button" class="light" data-close>Cancel</button><button type="button" class="${toStaff?"green":"danger"}" id="roleGo">${toStaff?"Give staff access":"Remove access"}</button></div>`);
    body.querySelector("#roleGo").onclick=async ev=>{ev.target.disabled=true;
      const{error}=await sb.rpc("set_user_role",{p_user:u.id,p_role:toStaff?"staff":"patient"});
      if(error){ev.target.disabled=false;return fail(/set_user_role/.test(error.message)?new Error("Run supabase/staff_access.sql in Supabase first"):error)}
      closeModal();toast(toStaff?`${u.full_name||"Account"} now has staff access`:"Staff access removed");$("#saSearch").value="";refreshUsers()}});
  // Export the users currently shown (search + role filter applied) as a real Excel file.
  $("#exportUsers").onclick=async()=>{const btn=$("#exportUsers"),list=filteredUsers();if(!list.length)return toast("No users to export",false);
    const d=v=>v?new Date(v).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}):"";
    const header=["Name","Role","Age","Gender","Phone","Email","Saved addresses","Last booking address","Bookings","Last booking","Joined"];
    const data=list.map(u=>[u.full_name||"",u.role||"",u.age??"",u.gender||"",u.phone||"",u.email||"",
      u.saved.map(a=>`${a.label?a.label+": ":""}${a.address}, ${a.area}`).join("\n"),u.lastAddr||"",u.bookings,d(u.lastAt),d(u.created_at)]);
    const role=$("#userRole").value,name=`LabMitra-users${role!=="all"?"-"+role:""}-${today()}`;
    btn.disabled=true;
    try{if(!window.XLSX)await new Promise((ok,no)=>{const s=document.createElement("script");s.src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";s.onload=ok;s.onerror=no;document.head.appendChild(s)});
      const ws=XLSX.utils.aoa_to_sheet([header,...data]);
      ws["!cols"]=header.map((h,i)=>({wch:Math.min(50,Math.max(h.length,...data.map(r=>Math.max(...String(r[i]).split("\n").map(l=>l.length))))+2)}));
      ws["!autofilter"]={ref:XLSX.utils.encode_range({s:{r:0,c:0},e:{r:data.length,c:header.length-1}})};
      const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Users");XLSX.writeFile(wb,name+".xlsx");
      toast(`Exported ${list.length} ${list.length===1?"user":"users"}`)}
    catch(_){downloadCSV(name+".csv",header,data);toast("Excel export unavailable, downloaded as CSV (opens in Excel)")}
    finally{btn.disabled=false}};
  $("#userSearch").addEventListener("input",drawUsers);$("#userRole").addEventListener("change",drawUsers);

  // --- Test Pricing tab ---
  // 600+ tests: search, filter and show 100 rows at a time. "Home page" tick = trending test on the home page.
  let TP=[],tpHas=false,tpLimit=100;
  const drawTP=()=>{const q=catNorm($("#tpSearch").value),f=$("#tpShow").value;
    const list=TP.filter(t=>(!q||catNorm(`${t.name} ${t.category} ${t.code??""}`).includes(q))&&(f==="all"||(f==="trending"?t.trending:f==="hidden"?!t.active:t.category===f)));
    $("#tpCount").textContent=`${list.length} of ${TP.length} tests`;
    $("#testRows").innerHTML=list.length?list.slice(0,tpLimit).map(t=>`<tr data-test="${t.id}"><td><input name="name" value="${esc(t.name)}" style="min-width:220px">${t.code?`<small class="muted tp-code">BYOS #${t.code} · ${esc(t.sample||"")}</small>`:""}</td><td><input name="category" value="${esc(t.category)}" style="min-width:150px" list="tpCats"></td><td><input name="price" type="number" min="0" value="${t.price}" style="width:90px"></td><td><input name="mrp" type="number" min="0" value="${t.mrp??""}" style="width:90px"></td><td><input name="turnaround" value="${esc(t.turnaround)}" style="width:110px"></td><td><input name="instructions" value="${esc(t.instructions||"")}" placeholder="e.g. Fast 10-12 hours" style="min-width:220px"></td><td class="tp-tick"><input name="trending" type="checkbox" style="width:auto"${t.trending?" checked":""}${tpHas?"":' disabled title="Run supabase/test_catalog.sql first"'}></td><td class="tp-tick"><input name="active" type="checkbox" style="width:auto"${t.active?" checked":""}></td><td><button class="green" data-save-test style="padding:7px 12px;font-size:12px">Save</button></td></tr>`).join("")
      +(list.length>tpLimit?`<tr><td colspan="9"><button type="button" class="light" id="tpMore">Show ${Math.min(100,list.length-tpLimit)} more (${tpLimit} of ${list.length} shown)</button></td></tr>`:"")
      :`<tr><td colspan="9" class="muted">No tests match.</td></tr>`};
  const loadTests=async()=>{const{data,error}=await sb.from("tests").select("*").order("trending",{ascending:false}).order("name");
    if(error){if(!/trending/.test(error.message))return fail(error);const r=await sb.from("tests").select("*").order("id");if(r.error)return fail(r.error);TP=r.data}else TP=data;
    tpHas=TP.some(t=>"trending" in t);const cats=[...new Set(TP.map(t=>t.category).filter(Boolean))].sort();
    $("#tpCats").innerHTML=cats.map(c=>`<option value="${esc(c)}">`).join("");
    const sel=$("#tpShow"),cur=sel.value;sel.innerHTML=`<option value="all">All tests</option>${tpHas?'<option value="trending">On home page (trending)</option>':""}<option value="hidden">Hidden from website</option><optgroup label="Category">${cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("")}</optgroup>`;
    if([...sel.options].some(o=>o.value===cur))sel.value=cur;drawTP()};
  $("#tpSearch").addEventListener("input",()=>{tpLimit=100;drawTP()});$("#tpShow").addEventListener("change",()=>{tpLimit=100;drawTP()});
  $("#testRows").addEventListener("click",async e=>{if(e.target.id==="tpMore"){tpLimit+=100;drawTP();return}
    if(!e.target.closest("[data-save-test]"))return;const tr=e.target.closest("tr"),v=n=>tr.querySelector(`[name=${n}]`);
    const row={name:v("name").value.trim(),category:v("category").value.trim(),price:+v("price").value,mrp:v("mrp").value?+v("mrp").value:null,turnaround:v("turnaround").value.trim(),instructions:v("instructions").value.trim()||null,active:v("active").checked};
    if(tpHas)row.trending=v("trending").checked;
    const{error}=await sb.from("tests").update(row).eq("id",+tr.dataset.test);
    if(error)return fail(error);const t=TP.find(x=>x.id===+tr.dataset.test);if(t)Object.assign(t,row);toast("Test saved")});
  $("#newTestForm").onsubmit=async e=>{e.preventDefault();const f=e.target;const row={name:f.name.value.trim(),category:f.category.value.trim(),price:+f.price.value,mrp:+f.mrp.value,sample:f.sample.value.trim(),turnaround:f.turnaround.value.trim(),instructions:f.instructions.value.trim()||null};
    if(tpHas)row.trending=f.trending.checked;const{error}=await sb.from("tests").insert(row);
    if(error)return fail(error);toast("Test added");f.reset();loadTests()};
  // Booking setting: max bookings per time slot.
  sb.from("app_settings").select("value").eq("key","slot_capacity").maybeSingle().then(({data})=>{if(data)$("#slotCapForm").cap.value=data.value});
  $("#slotCapForm").onsubmit=async e=>{e.preventDefault();const n=+e.target.cap.value;if(!(n>=1))return toast("Enter a number of 1 or more",false);
    const{error}=await sb.from("app_settings").upsert({key:"slot_capacity",value:String(n)});if(error)return fail(error);toast(`Each slot now takes up to ${n} bookings`)};

  // --- CSV exports (for accounts / GST) ---
  const inRange=(d,from,to)=>{const x=String(d||"").slice(0,10);return(!from||x>=from)&&(!to||x<=to)};
  $("#exportBookings").onclick=()=>{const from=$("#expFrom").value,to=$("#expTo").value,by=$("#expBy").value;
    const list=adminRows.filter(b=>inRange(by==="booked"?new Date(b.created_at).toLocaleDateString("en-CA"):b.collect_date,from,to));
    if(!list.length)return toast("No bookings in that date range",false);
    downloadCSV(`labmitra-bookings-${from||"start"}-to-${to||"today"}.csv`,
      ["Booking ref","Sample ID","Booked on","Collection date","Slot","Patient","Age","Gender","Phone","Area","Address","Tests","Amount (Rs)","Status","Payment","Payment method","Cash collected by","Collected on","Razorpay payment ID","Refund ID","Cancelled on","Cancel reason","Report uploaded"],
      list.map(b=>[b.ref,b.sample_id,fmtDT(b.created_at),b.collect_date,b.slot,b.patient_name,ageText(b.patient_age,b.patient_age_unit,true),b.patient_gender,b.phone,b.area,b.address,
        b.booking_items.map(i=>i.name).join("; "),b.total,b.status,b.payment,b.payment_method,b.collected_by_name,b.collected_at?fmtDT(b.collected_at):"",
        b.razorpay_payment_id,b.refund_id,b.cancelled_at?fmtDT(b.cancelled_at):"",b.cancel_reason,b.reports.length?"Yes":"No"]));
    toast(`Downloaded ${list.length} bookings`)};
  $("#exportHandovers").onclick=()=>{if(!handovers.length)return toast("No handovers to export",false);
    downloadCSV(`labmitra-cash-handovers-${today()}.csv`,["Recorded on","Handed by","Amount (Rs)","Note","Received by office","Confirmed on"],
      handovers.map(h=>[fmtDT(h.created_at),h.handed_by,h.amount,h.note,h.received?"Yes":"No",h.received_at?fmtDT(h.received_at):""]))};
  $("#exportCashPeople").onclick=()=>{const L=cashLedger(adminRows,handovers);if(!L.length)return toast("No cash collected yet",false);
    downloadCSV(`labmitra-cash-by-person-${today()}.csv`,["Name","Cash jobs","Collected (Rs)","Handed over (Rs)","Confirmed received (Rs)","Still with them (Rs)"],
      L.map(p=>[p.office?"Office (marked paid by admin)":p.name,p.jobs,p.collected,p.office?"":p.handed,p.office?"":p.received,p.office?"":p.inHand]))};

  loadTests();refreshUsers()}

// ---------- staff ----------
const PHONE_ICON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>';
const CHAT_ICON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 21l2.1-5.4A8.4 8.4 0 1 1 21 11.5z"/></svg>';
const NAV_ICON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>';
// Call / WhatsApp / Directions buttons for a staff job card.
function contactRow(j){const digits=String(j.phone||"").replace(/\D/g,"");if(!digits)return"";
  const intl=digits.length===10?"91"+digits:digits,pretty=digits.length===10?digits.slice(0,5)+" "+digits.slice(5):digits;
  const q=encodeURIComponent([j.address,j.area,"Raipur"].filter(Boolean).join(", "));
  return`<div class="contact-row"><a class="contact-btn call" href="tel:+${intl}">${PHONE_ICON}<span><b>Call patient</b><small>${esc(pretty)}</small></span></a><a class="contact-btn wa" href="https://wa.me/${intl}" target="_blank" rel="noopener">${CHAT_ICON}<span>WhatsApp</span></a><a class="contact-btn map" href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener">${NAV_ICON}<span>Directions</span></a></div>`}
async function initStaff(){const root=$("#staffJobs");if(!root)return;const c=await guard(["staff","admin"],"login.html");if(!c)return;
  $("#staffName").textContent="Hello, "+(c.profile.full_name||"Collection Partner")+"!";$("#todayDate").textContent=fmt(new Date());
  $("#logout").onclick=async e=>{e.preventDefault();await sb.auth.signOut();location.href="login.html"};
  const payLine=j=>j.payment==="Paid"?`<span class="pill green">Paid${j.payment_method==="Cash"?" · Cash":""}${j.collected_by_name?" · by "+esc(j.collected_by_name):""}</span>`:j.payment_method==="Cash"?`<button class="green" data-collect="${j.id}" style="margin-top:8px">💰 Mark ₹${j.total.toLocaleString("en-IN")} collected</button>`:`<span class="pill amber">Payment pending online</span>`;
  // One shared staff account, so every active booking is shown (no per-person assignment).
  const drawJobs=rows=>{const data=rows.filter(j=>!["Report ready","Cancelled"].includes(j.status)).sort((a,b)=>String(a.collect_date).localeCompare(String(b.collect_date)));
  $("#jobCount").textContent=data.length;
  root.innerHTML=data.length?data.map(j=>`<section class="job"><div class="jobhead"><b>${esc(j.ref)}</b><span style="display:flex;gap:10px;align-items:center"><a href="#" class="tl-link" data-timeline="${j.id}" data-ref="${esc(j.ref)}">Timeline</a><span class="pill amber" id="st-${j.id}">${esc(j.status)}</span></span></div>${j.sample_id?`<div class="sample-box"><span>Sample ID · write on every tube</span><b>${esc(j.sample_id)}</b></div>`:""}<div class="patient">${esc(j.patient_name)}${j.patient_age!=null?` <span class="muted" style="font-size:13px;font-weight:600">· ${ageText(j.patient_age,j.patient_age_unit)} · ${esc(j.patient_gender||"")}</span>`:""}</div><div class="detail">Collection: ${fmt(j.collect_date)} · ${esc(j.slot)}<br>Area: ${esc(j.area)}<br>Address: ${esc(j.address)}</div><div class="tests">${j.booking_items.map(i=>esc(i.name)).join(", ")}</div>${j.booking_items.filter(i=>i.instructions).map(i=>prepLine(`${i.name}: ${i.instructions}`)).join("")}${contactRow(j)}${tripBtn(j)?`<div class="trip-row">${tripBtn(j)}</div>`:""}<div id="pay-${j.id}">${payLine(j)}</div><div class="job-actions"><select id="up-${j.id}"><option>Sample collected</option><option>Handed over to lab</option><option>Lab received sample</option><option>Processing started</option></select><button class="green" data-job="${j.id}">Save update</button></div></section>`).join(""):'<div class="empty">No active bookings right now.</div>'};
  // Section slider: tabs + swipe. The URL hash (#all, #active, #reports) remembers the tab on reload.
  const TABS=["route","active","reports","history"];
  $(".seg-thumb").style.width=`calc((100% - 10px) / ${TABS.length})`;
  const showSTab=name=>{const i=Math.max(0,TABS.indexOf(name)),tab=TABS[i];
    document.querySelectorAll("[data-stab]").forEach(s=>s.hidden=s.dataset.stab!==tab);
    document.querySelectorAll("[data-stab-btn]").forEach(b=>{const on=b.dataset.stabBtn===tab;b.classList.toggle("active",on);b.setAttribute("aria-selected",on)});
    $(".seg-thumb").style.transform=`translateX(${i*100}%)`;history.replaceState(null,"","#"+tab)};
  $("#staffSeg").addEventListener("click",e=>{const b=e.target.closest("[data-stab-btn]");if(b)showSTab(b.dataset.stabBtn)});
  showSTab(location.hash.slice(1));
  let sx=null,sy=0;const main=$("main");
  main.addEventListener("touchstart",e=>{if(e.target.closest(".table-wrap"))return sx=null;sx=e.touches[0].clientX;sy=e.touches[0].clientY},{passive:true});
  main.addEventListener("touchend",e=>{if(sx===null)return;const dx=e.changedTouches[0].clientX-sx,dy=e.changedTouches[0].clientY-sy;sx=null;
    if(Math.abs(dx)<60||Math.abs(dx)<Math.abs(dy)*1.5)return;
    const cur=TABS.indexOf(location.hash.slice(1)),next=Math.min(TABS.length-1,Math.max(0,cur+(dx<0?1:-1)));showSTab(TABS[next])},{passive:true});

  // --- Today's route: visits still to do on a day, in slot order, grouped by area ---
  let routeRows=[],routeDay=0;
  const dayStr=n=>{const d=new Date();d.setDate(d.getDate()+n);return d.toLocaleDateString("en-CA")};
  const addrOf=b=>[b.address,b.area,"Raipur"].filter(Boolean).join(", ");
  const routeTodo=day=>routeRows.filter(b=>String(b.collect_date)===day&&["Confirmed","Assigned"].includes(b.status))
    .sort((a,b)=>(slotHour(a.slot)??99)-(slotHour(b.slot)??99)||String(a.area).localeCompare(String(b.area))||String(a.address).localeCompare(String(b.address)));
  const drawRoute=()=>{const day=dayStr(routeDay),todo=routeTodo(day);
    const done=routeRows.filter(b=>String(b.collect_date)===day&&!["Confirmed","Assigned","Cancelled"].includes(b.status));
    $("#routeSummary").innerHTML=`<span><b>${todo.length}</b> ${todo.length===1?"visit":"visits"} left</span><span><b>${done.length}</b> done</span>${todo[0]?`<span>First visit <b>${esc(todo[0].slot)}</b></span>`:""}<span>${fmt(day)}</span>`;
    const stops=todo.slice(0,10).map(addrOf),mapBtn=$("#routeMapBtn");mapBtn.hidden=!stops.length;
    if(stops.length){mapBtn.href=`https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${encodeURIComponent(stops[stops.length-1])}${stops.length>1?`&waypoints=${encodeURIComponent(stops.slice(0,-1).join("|"))}`:""}`;
      mapBtn.textContent=`Open route in Google Maps${todo.length>10?" (first 10 stops)":""}`}
    let n=0,html="";
    [...new Set(todo.map(b=>b.slot))].forEach(slot=>{const group=todo.filter(b=>b.slot===slot);
      html+=`<div class="route-slot"><span>${esc(slot)}</span><small>${group.length} ${group.length===1?"visit":"visits"}</small></div>`+group.map(b=>{
        const digits=String(b.phone||"").replace(/\D/g,""),tel=digits.length===10?"+91"+digits:"+"+digits;
        const pay=b.payment==="Paid"?'<span class="pill green">Paid</span>':b.payment_method==="Cash"?`<span class="pill amber">Collect ${money(b.total)} cash</span>`:'<span class="pill red">Online · not paid</span>';
        const prep=b.booking_items.some(i=>i.instructions)?'<span class="pill amber">Check fasting</span>':"";
        return`<div class="route-stop"><span class="stop-no">${++n}</span><div class="stop-main">
          <div class="stop-top"><b>${esc(b.patient_name)}</b>${b.patient_age!=null?`<span class="muted">${ageText(b.patient_age,b.patient_age_unit)} · ${esc(b.patient_gender||"")}</span>`:""}${b.sample_id?`<span class="sample-tag">${esc(b.sample_id)}</span>`:""}</div>
          <div class="muted stop-addr">${esc(b.area)} · ${esc(b.address)}</div>
          <div class="stop-tests">${b.booking_items.map(i=>esc(i.name)).join(", ")}</div>
          <div class="stop-actions">${tripBtn(b)}${digits?`<a class="contact-btn call sm" href="tel:${tel}">${PHONE_ICON}<span>Call</span></a>`:""}<a class="contact-btn map sm" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addrOf(b))}">${NAV_ICON}<span>Directions</span></a>${pay}${prep}</div>
        </div></div>`}).join("")});
    $("#routeList").innerHTML=(html||`<div class="empty">No visits left ${routeDay?"for tomorrow":"for today"}.</div>`)
      +(done.length?`<details class="route-done"><summary>${done.length} already collected</summary>${done.map(b=>`<div><b>${esc(b.patient_name)}</b> · ${esc(b.slot)} · <span class="muted">${esc(b.status)}</span></div>`).join("")}</details>`:"")};
  document.querySelectorAll("[data-day]").forEach(btn=>btn.onclick=()=>{routeDay=+btn.dataset.day;
    document.querySelectorAll("[data-day]").forEach(x=>x.classList.toggle("active",x===btn));drawRoute()});

  // --- History: every completed collection (Report ready / Cancelled) ---
  let histRows=[];
  const daysAgo=n=>{const d=new Date();d.setDate(d.getDate()-n);return d.toLocaleDateString("en-CA")};
  const drawHistory=()=>{const q=$("#histSearch").value.trim().toLowerCase(),range=$("#histRange").value,t=today();
    const from=range==="today"?t:range==="7"?daysAgo(6):range==="30"?daysAgo(29):range==="month"?t.slice(0,8)+"01":"";
    const list=histRows.filter(b=>(!from||String(b.collect_date)>=from)&&(`${b.patient_name} ${b.ref}`.toLowerCase().includes(q)));
    const done=list.filter(b=>b.status==="Report ready"),cash=list.filter(b=>b.payment==="Paid"&&b.payment_method==="Cash");
    $("#histSummary").innerHTML=`<span><b>${done.length}</b> completed</span><span><b>${list.length-done.length}</b> cancelled</span><span><b>${money(cash.reduce((s,b)=>s+b.total,0))}</b> cash collected</span>`;
    $("#staffHistory").innerHTML=list.length?list.map(b=>{const sm=statusMeta(b.status);
      const pay=b.payment==="Paid"?`Paid · ${esc(b.payment_method||"Cash")}${b.collected_at?" · collected "+fmt(b.collected_at):""}${b.collected_by_name?" by "+esc(b.collected_by_name):""}`:`${esc(b.payment)} · ${esc(b.payment_method||"Cash")}`;
      return`<section class="job bk" data-status="${sm.cls}"><div class="jobhead"><span class="bk-ref">${esc(b.ref)}</span>${b.sample_id?`<span class="sample-tag">Sample ${esc(b.sample_id)}</span>`:""}<span class="pill ${sm.cls}" style="margin-left:auto">${esc(b.status)}</span></div>
        <div class="patient">${ICONS.user}${esc(b.patient_name)}</div>
        <div class="bk-meta"><div class="bk-row">${ICONS.cal}<span>${fmt(b.collect_date)} · ${esc(b.slot)}</span></div><div class="bk-row">${ICONS.pin}<span>${esc(b.address)}, ${esc(b.area)}</span></div></div>
        <div class="tests">${b.booking_items.map(i=>`<span class="test-chip">${esc(i.name)}</span>`).join("")}</div>
        <div class="bk-foot"><div class="bk-pay"><span class="${b.payment==="Paid"?"":"muted"}">${pay}</span><b>${money(b.total)}</b></div>
        <span style="display:flex;gap:10px;align-items:center"><a href="#" class="tl-link" data-timeline="${b.id}" data-ref="${esc(b.ref)}">Timeline</a>${b.reports.length?`<a href="#" class="pill green" data-view="${esc(b.reports[0].path)}">View PDF</a>`:""}</span></div></section>`}).join("")
      :`<div class="empty">${histRows.length?"No collections match your search.":"No completed collections yet."}</div>`};
  $("#histSearch").addEventListener("input",drawHistory);$("#histRange").addEventListener("change",drawHistory);
  $("#staffHistory").addEventListener("click",async e=>{const a=e.target.closest("[data-view]");if(!a)return;e.preventDefault();
    const{data,error}=await sb.storage.from("reports").createSignedUrl(a.dataset.view,120);if(error)return fail(error);window.open(data.signedUrl,"_blank")});

  // --- Cash: name of the person using this device, their cash in hand, handovers to the office ---
  let staffRows=[],staffHandovers=[];const who=$("#staffWho");
  try{who.value=localStorage.getItem("lm_staff_name")||""}catch{}
  const drawCashBar=()=>{const me=normName(who.value);
    if(!me){$("#cashInHand").textContent="—";$("#cashHint").textContent="Type your name to see the cash you're holding";return}
    const p=cashLedger(staffRows,staffHandovers).find(x=>normName(x.name)===me);
    $("#cashInHand").textContent=money(p?p.inHand:0);
    const pending=staffHandovers.filter(h=>normName(h.handed_by)===me&&!h.received).reduce((s,h)=>s+h.amount,0);
    $("#cashHint").textContent=pending?`${money(pending)} handed over, waiting for office to confirm`:p&&p.collected?`Collected ${money(p.collected)} in total`:"No cash collected yet"};
  who.addEventListener("input",()=>{try{localStorage.setItem("lm_staff_name",who.value.trim())}catch{};drawCashBar()});
  liveHandovers(d=>{staffHandovers=d;drawCashBar()});
  const hf=$("#handoverForm");
  $("#handoverBtn").onclick=()=>{if(!who.value.trim()){toast("Type your name first",false);return who.focus()}
    const p=cashLedger(staffRows,staffHandovers).find(x=>normName(x.name)===normName(who.value));
    hf.hidden=!hf.hidden;if(!hf.hidden){hf.amount.value=p&&p.inHand>0?p.inHand:"";hf.amount.focus()}};
  $("#handoverCancel").onclick=()=>hf.hidden=true;
  hf.onsubmit=async e=>{e.preventDefault();const amount=+hf.amount.value;if(!(amount>0))return toast("Enter the amount you handed over",false);
    const b=hf.querySelector("button.green");b.disabled=true;
    const{error}=await sb.from("cash_handovers").insert({handed_by:who.value.trim(),amount,note:hf.note.value.trim()||null});
    b.disabled=false;if(error)return fail(error);hf.reset();hf.hidden=true;toast("Handover recorded. The office will confirm it.")};

  // --- Live trip: this phone shares its location with the patient while travelling (like delivery apps) ---
  const TRIP_KEY="lm_trip";let liveTrips={},trip=null,tripsOk=false;
  let watchId=null,beat=null,wakeLock=null,lastSent=0,lastSentPos=null,lastPos=null,sending=false,gpsNote="";
  const bar=document.createElement("div");bar.className="trip-bar";bar.hidden=true;$("#staffSeg").before(bar);
  const saveTrip=()=>{try{trip?localStorage.setItem(TRIP_KEY,JSON.stringify(trip)):localStorage.removeItem(TRIP_KEY)}catch{}};
  const redrawTrips=()=>{if(staffRows.length){drawJobs(staffRows);drawRoute()}drawBar()};
  const loadTrips=async()=>{const{data,error}=await sb.from("trips").select("*").neq("status","ended");if(error){tripsOk=false;return}
    tripsOk=true;liveTrips=Object.fromEntries((data||[]).map(t=>[t.booking_id,t]));
    if(trip&&!liveTrips[trip.id])stopLocal(trip.arrived?"":"This trip has ended. Location sharing stopped.");
    else if(!trip)resumeTrip();
    redrawTrips()};
  const resumeTrip=()=>{let saved=null;try{saved=JSON.parse(localStorage.getItem(TRIP_KEY)||"null")}catch{}
    if(!saved)return;const t=liveTrips[saved.id];if(!t){trip=null;saveTrip();return}
    trip=saved;if(t.status==="on_the_way")beginWatch();else trip.arrived=true};
  // Where the patient lives (used only if they never saved a map pin for this address).
  const geocode=async b=>{try{const ctl=new AbortController(),tm=setTimeout(()=>ctl.abort(),5000);
      const r=await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=in&q=${encodeURIComponent(addrOf(b))}`,{signal:ctl.signal});clearTimeout(tm);
      const j=await r.json();return j[0]?{lat:+j[0].lat,lng:+j[0].lon}:null}catch{return null}};
  const send=async force=>{if(!trip||trip.arrived||!lastPos||sending)return;const now=Date.now(),moved=lastSentPos?geoKm(lastPos,lastSentPos)*1000:1e9;
    if(now-lastSent<4000)return;if(!force&&now-lastSent<8000&&moved<25)return;if(!force&&moved<5&&now-lastSent<25000)return;
    sending=true;const c=lastPos;
    const{data,error}=await sb.rpc("update_trip",{p_booking:trip.id,p_lat:c.lat,p_lng:c.lng,p_accuracy:c.acc,p_heading:c.heading,p_speed:c.speed});
    sending=false;if(error){gpsNote="Connection problem, retrying…";return drawBar()}
    lastSent=now;lastSentPos=c;gpsNote="";if(data==="ended")return stopLocal("This trip was ended from the office. Location sharing stopped.");drawBar()};
  const onPos=p=>{const k=p.coords;lastPos={lat:k.latitude,lng:k.longitude,acc:Math.round(k.accuracy||0),heading:Number.isFinite(k.heading)?k.heading:null,speed:Number.isFinite(k.speed)?k.speed:null};
    if(gpsNote==="Weak GPS signal…")gpsNote="";send();drawBar()};
  const onErr=e=>{if(e.code===1){toast("Location permission was turned off, so live tracking stopped",false);return endTrip(true)}gpsNote="Weak GPS signal…";drawBar()};
  const keepAwake=async()=>{try{if("wakeLock" in navigator&&document.visibilityState==="visible"&&!wakeLock){wakeLock=await navigator.wakeLock.request("screen");wakeLock.addEventListener("release",()=>wakeLock=null)}}catch{}};
  const beginWatch=()=>{if(watchId!=null||!("geolocation" in navigator))return;
    watchId=navigator.geolocation.watchPosition(onPos,onErr,{enableHighAccuracy:true,maximumAge:5000,timeout:30000});
    beat=setInterval(()=>{send(Date.now()-lastSent>25000);drawBar()},5000);keepAwake()};
  const stopWatch=()=>{if(watchId!=null)navigator.geolocation.clearWatch(watchId);watchId=null;clearInterval(beat);beat=null;try{wakeLock&&wakeLock.release()}catch{};wakeLock=null};
  const stopLocal=msg=>{stopWatch();trip=null;lastPos=lastSentPos=null;lastSent=0;gpsNote="";saveTrip();if(msg)toast(msg);redrawTrips()};
  document.addEventListener("visibilitychange",()=>{if(trip&&!trip.arrived&&document.visibilityState==="visible"){keepAwake();send(true)}});
  const startTrip=async(id,btn)=>{const b=staffRows.find(x=>x.id===id);if(!b)return;
    const name=who.value.trim();if(!name){toast("Type your name at the top first, so the patient knows who is coming",false);window.scrollTo({top:0,behavior:"smooth"});return who.focus()}
    if(trip&&trip.id!==id)return toast("Finish your current trip first (use End in the blue bar)",false);
    if(!("geolocation" in navigator))return toast("This phone's browser can't share location",false);
    if(btn){btn.disabled=true;btn.querySelector("span").textContent="Getting location…"}
    try{const pos=await new Promise((ok,no)=>navigator.geolocation.getCurrentPosition(ok,no,{enableHighAccuracy:true,timeout:15000,maximumAge:10000}));
      const dest=await geocode(b),k=pos.coords;
      const{error}=await sb.rpc("start_trip",{p_booking:id,p_name:name,p_lat:k.latitude,p_lng:k.longitude,p_accuracy:Math.round(k.accuracy||0),p_dest_lat:dest?dest.lat:null,p_dest_lng:dest?dest.lng:null});
      if(error)throw error;
      trip={id,patient:b.patient_name,address:addrOf(b)};saveTrip();
      lastPos={lat:k.latitude,lng:k.longitude,acc:Math.round(k.accuracy||0),heading:null,speed:null};lastSentPos=lastPos;lastSent=Date.now();
      beginWatch();toast(`Trip started. ${b.patient_name} can now see you on the map.`);await loadTrips();window.scrollTo({top:0,behavior:"smooth"})}
    catch(err){if(btn){btn.disabled=false;btn.querySelector("span").textContent="Start trip"}
      toast(typeof err?.code==="number"?(err.code===1?"Location permission is blocked. Allow location for this site in your browser settings, then try again.":"Couldn't get your location. Turn on GPS and try again.")
        :/start_trip|function|trips/i.test(err?.message||"")?"Live tracking isn't set up yet. Ask the admin to run supabase/live_tracking.sql.":(err?.message||"Couldn't start the trip"),false)}};
  const endTrip=async silent=>{if(!trip)return;const{error}=await sb.rpc("set_trip_status",{p_booking:trip.id,p_status:"ended"});
    if(error&&!silent)return fail(error);stopLocal(silent?"":"Trip ended. Location sharing stopped.");loadTrips()};
  const markArrived=async()=>{if(!trip)return;const{error}=await sb.rpc("set_trip_status",{p_booking:trip.id,p_status:"arrived"});if(error)return fail(error);
    stopWatch();trip.arrived=true;saveTrip();toast("Marked as arrived. Location sharing stopped.");loadTrips()};
  // Pill or button shown on job cards and route stops.
  function tripBtn(b){if(!tripsOk||!["Confirmed","Assigned"].includes(b.status))return"";const t=liveTrips[b.id];
    if(t){const mine=trip&&trip.id===b.id;return`<span class="trip-pill ${t.status==="arrived"?"arrived":""}"><i></i>${t.status==="arrived"?"Arrived":"On the way"}${mine?" · you":t.staff_name?" · "+esc(t.staff_name):""}</span>`}
    return`<button type="button" class="trip-start" data-trip-start="${b.id}">${SCOOTER_ICON}<span>Start trip</span></button>`}
  const drawBar=()=>{if(!trip){bar.hidden=true;bar.innerHTML="";return}
    const t=liveTrips[trip.id]||{},arrived=trip.arrived||t.status==="arrived",dest=t.dest_lat!=null?{lat:t.dest_lat,lng:t.dest_lng}:null,km=dest&&lastPos?geoKm(lastPos,dest):null;
    const nav=`https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${dest?dest.lat+","+dest.lng:encodeURIComponent(trip.address||"")}`;
    bar.hidden=false;bar.classList.toggle("arrived",arrived);
    bar.innerHTML=arrived?`<div class="tb-main"><span class="tb-live done">ARRIVED</span><div><b>At ${esc(trip.patient)}'s address</b><small>Collect the sample, then save "Sample collected". The trip ends by itself.</small></div></div>
      <div class="tb-acts"><button type="button" class="light sm" data-trip-end>End trip</button></div>`
      :`<div class="tb-main"><span class="tb-live"><i></i>LIVE</span><div><b>Sharing your location with ${esc(trip.patient)}</b>
        <small>${km!=null?`${kmText(km)} away · ~${tripEta(km)} min · `:""}${gpsNote?esc(gpsNote):lastSent?"Updated "+agoText(lastSent):"Getting GPS…"}${lastPos&&lastPos.acc>100?` · GPS ±${lastPos.acc} m`:""}</small>
        <small class="tb-tip">Keep this page open while you travel. The screen stays on.</small></div></div>
      <div class="tb-acts"><a class="btn light sm" href="${nav}" target="_blank" rel="noopener">${NAV_ICON}Navigate</a><button type="button" class="green sm${km!=null&&km<.15?" nudge":""}" data-trip-arrived>I've arrived</button><button type="button" class="light sm" data-trip-end>End</button></div>`};
  document.addEventListener("click",e=>{const s=e.target.closest("[data-trip-start]");if(s){startTrip(s.dataset.tripStart,s);return}
    if(e.target.closest("[data-trip-arrived]"))return markArrived();
    if(e.target.closest("[data-trip-end]"))endTrip()});
  let tripTm;sb.channel("staff-trips").on("postgres_changes",{event:"*",schema:"public",table:"trips"},()=>{clearTimeout(tripTm);tripTm=setTimeout(loadTrips,300)}).subscribe();
  loadTrips();

  let reloadReports=null;initStaffReports().then(f=>reloadReports=f);
  // Job cards, report list, history and cash all refresh from the same live data.
  const reload=liveBookings(rows=>{staffRows=rows;routeRows=rows;drawRoute();$("#cntRoute").textContent=routeTodo(dayStr(0)).length;
    drawCashBar();drawJobs(rows);reloadReports&&reloadReports();
    histRows=rows.filter(j=>["Report ready","Cancelled"].includes(j.status)).sort((a,b)=>String(b.collect_date).localeCompare(String(a.collect_date)));drawHistory();
    $("#cntActive").textContent=rows.filter(j=>!["Report ready","Cancelled"].includes(j.status)).length;
    $("#cntReports").textContent=rows.filter(j=>j.status!=="Cancelled"&&!j.reports.length).length;
    $("#cntHistory").textContent=histRows.length});
  root.addEventListener("click",async e=>{
    const job=e.target.dataset.job;if(job){const v=$("#up-"+job).value;const{error}=await sb.rpc("set_status",{p_id:job,p_status:v});if(error)return fail(error);toast("Status updated");return reload()}
    const coll=e.target.closest("[data-collect]");if(coll){coll.disabled=true;
      const name=who.value.trim();if(!name){coll.disabled=false;toast("Type your name at the top first, so we know who has the cash",false);window.scrollTo({top:0,behavior:"smooth"});return who.focus()}
      const{error}=await sb.rpc("mark_cash_collected",{p_id:coll.dataset.collect,p_collector:name});if(error){coll.disabled=false;return fail(error)}
      toast("Cash collection recorded");reload()}})}

// ---------- staff: upload reports for ANY pending patient ----------
let ALL_BOOKINGS=[];
async function initStaffReports(){const root=$("#staffReports");if(!root)return;
  const load=async()=>{const{data,error}=await sb.from("bookings").select("id,ref,patient_name,status,booking_items(name),reports(id,path)").order("created_at",{ascending:false});
    if(error)return fail(error);ALL_BOOKINGS=data;draw()};
  const draw=()=>{const q=($("#reportSearch").value||"").toLowerCase();const showAll=$("#showUploaded").checked;
    const list=ALL_BOOKINGS.filter(b=>(showAll||!b.reports.length)&&(b.patient_name||"").toLowerCase().includes(q));
    root.innerHTML=list.length?list.map(b=>`<div class="job" data-id="${b.id}"><div class="jobhead"><b>${esc(b.ref)}</b>${b.reports.length?'<span class="pill green">Uploaded</span>':'<span class="pill amber">Pending</span>'}</div><div class="patient">${esc(b.patient_name)}</div><div class="tests">${b.booking_items.map(i=>esc(i.name)).join(", ")}</div><div class="job-actions st-row"><label class="st-label" for="rs-${b.id}">Status</label><select id="rs-${b.id}" data-st class="cell-select ${statusMeta(b.status).cls}">${STATUSES.map(v=>`<option${v===b.status?" selected":""}${v==="Cancelled"&&b.status!=="Cancelled"?" disabled":""}>${esc(v)}${v==="Cancelled"&&b.status!=="Cancelled"?" (admin only)":""}</option>`).join("")}</select></div><div class="job-actions" style="align-items:center">${b.reports.length?`<a href="#" data-view="${esc(b.reports[0].path)}"><b>View current PDF</b></a>`:""}<input type="file" accept="application/pdf" data-up style="max-width:260px"></div></div>`).join(""):`<div class="empty">${q?"No matching patient found.":"No pending reports right now 🎉"}</div>`};
  $("#reportSearch").addEventListener("input",draw);
  $("#showUploaded").addEventListener("change",draw);
  // Status dropdown: same list as admin. Saves instantly; Cancelled stays admin-only.
  root.addEventListener("change",async e=>{const sel=e.target.closest("[data-st]");if(!sel)return;
    const id=sel.closest("[data-id]").dataset.id,b=ALL_BOOKINGS.find(x=>x.id===id),v=sel.value;sel.disabled=true;
    const{error}=await sb.rpc("set_status",{p_id:id,p_status:v});sel.disabled=false;
    if(error){if(b)sel.value=b.status;return toast(/Not allowed/.test(error.message)?"Staff can't set this status yet. Ask the admin to run supabase/staff_status_update.sql.":error.message,false)}
    if(b)b.status=v;sel.className="cell-select "+statusMeta(v).cls;toast("Status updated to "+v)});
  root.addEventListener("change",async e=>{if(e.target.dataset.up===undefined)return;const id=e.target.closest("[data-id]").dataset.id;const file=e.target.files[0];if(!file)return;
    if(file.type!=="application/pdf"||file.size>10*1048576)return toast("Upload a PDF under 10 MB");
    const path=`${id}/${Date.now()}.pdf`;let r=await sb.storage.from("reports").upload(path,file,{contentType:"application/pdf"});if(r.error)return fail(r.error);
    r=await sb.rpc("staff_upload_report",{p_booking_id:id,p_path:path});if(r.error)return fail(r.error);
    toast("Report uploaded — now visible to the patient");load()});
  root.addEventListener("click",async e=>{const a=e.target.closest("[data-view]");if(!a)return;e.preventDefault();const{data,error}=await sb.storage.from("reports").createSignedUrl(a.dataset.view,120);if(error)return fail(error);window.open(data.signedUrl,"_blank")});
  load();return load}

// Light / dark theme toggle. Choice is remembered per device (localStorage "lm_theme").
const THEME_SVG={sun:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.2M12 19.8V22M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2 12h2.2M19.8 12H22M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6"/></svg>',
  moon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7Z"/></svg>'};
const curTheme=()=>document.documentElement.dataset.theme==="dark"?"dark":"light";
function paintThemeButtons(){const dark=curTheme()==="dark";
  const m=document.querySelector('meta[name="theme-color"]');if(m)m.content=dark?"#0b1320":"#123b69";
  document.querySelectorAll(".theme-btn").forEach(b=>{const label=dark?"Light mode":"Dark mode";
    b.innerHTML=(dark?THEME_SVG.sun:THEME_SVG.moon)+(b.classList.contains("with-text")?`<span>${label}</span>`:"");
    b.setAttribute("aria-label",dark?"Switch to light theme":"Switch to dark theme");b.title=b.getAttribute("aria-label");b.setAttribute("aria-pressed",String(dark))})}
function setTheme(t){const h=document.documentElement;h.classList.add("theme-anim");
  if(t==="dark")h.dataset.theme="dark";else delete h.dataset.theme;
  try{localStorage.setItem("lm_theme",t)}catch(_){}paintThemeButtons();setTimeout(()=>h.classList.remove("theme-anim"),450)}
function initTheme(){const make=(cls="")=>{const b=document.createElement("button");b.type="button";b.className="theme-btn "+cls;
    b.onclick=()=>{b.classList.remove("spin");void b.offsetWidth;b.classList.add("spin");setTheme(curTheme()==="dark"?"light":"dark")};return b};
  const nav=$(".topbar .navlinks"),side=$(".side nav"),staffOut=$(".staff-header #logout");
  if(nav)nav.appendChild(make());
  else if(side){const out=side.querySelector("#logout");side.insertBefore(make("with-text side-theme"),out||null)}
  else if(staffOut){const w=document.createElement("span");w.className="hdr-actions";staffOut.replaceWith(w);w.append(make("on-dark-btn"),staffOut)}
  else document.body.appendChild(make("floating"));
  paintThemeButtons()}
document.addEventListener("DOMContentLoaded",()=>{initTheme();showAuthLinkError();initNav();initLogin();initStaffLogin();initAdminLogin();initTagline();initHome();initCatalog();initCart();initBooking();initProfile();initAccount();initReceipt();initAdmin();initStaff()});
