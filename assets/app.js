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
    :[item("index.html",I.home,"Home",page==="index.html"),item("index.html#tests",I.search,"Tests",false),
      item("login.html",I.user,"Login",page==="login.html")];
  if(c&&c.profile.role==="admin")items.push(item("98991/admin/dashboard.html",I.shield,"Admin",false));
  if(c&&c.profile.role==="staff")items.push(item("staff/dashboard.html",I.shield,"Staff",false));
  n.style.setProperty("--n",items.length);n.innerHTML=items.join("")}
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
    if(el)drawMobileNav(null);
    return}
  if(hero)hero.innerHTML="";
  if(!el)return;
  const{count}=await sb.from("cart_items").select("*",{count:"exact",head:true});const r=c.profile.role;
  const bump=_lastCartCount!==null&&count>_lastCartCount;_lastCartCount=count;drawMobileNav(c,count);
  const cartIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>';
  const bookIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="4" rx="1"></rect><path d="M9 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-4"></path><path d="M9 14l2 2 4-4"></path></svg>';
  const userIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"></circle><path d="M4 21c0-4 4-7 8-7s8 3 8 7"></path></svg>';
  el.innerHTML=`<a href="cart.html" class="navpill cart">${cartIcon}Cart${count?`<span class="navbadge${bump?" bump":""}">${count}</span>`:""}</a><a href="account.html" class="navpill">${bookIcon}My Bookings</a><a href="profile.html" class="navpill">${userIcon}My Account</a>${r==="admin"?'<a href="98991/admin/dashboard.html">Admin</a>':""}${r==="staff"?'<a href="staff/dashboard.html">Staff</a>':""}<a class="btn" href="#" id="logout">Logout</a>`;
  $("#logout").onclick=async e=>{e.preventDefault();await sb.auth.signOut();location.href="index.html"}}
function initLogin(){const f=$("#authForm");if(!f)return;const qs=new URLSearchParams(location.search);let signup=qs.get("mode")==="signup";
  const sync=()=>{$("#signupFields").hidden=!signup;$("#authTitle").textContent=signup?"Create your account":"Welcome back";$("#authBtn").textContent=signup?"Sign up":"Login";
    $("#toggle").textContent=signup?"Already have an account? Login":"New here? Create an account";f.name.required=f.phone.required=signup};sync();
  $("#toggle").onclick=e=>{e.preventDefault();signup=!signup;sync()};
  // Google sign-in: same button for new and returning users. Supabase sends them to Google,
  // then back to `next` (or the home page) already logged in. The account is created on first use.
  const g=$("#googleBtn");if(g)g.onclick=async()=>{g.disabled=true;g.querySelector("span").textContent="Opening Google...";
    const back=new URL(qs.get("next")||"index.html",location.href).href;
    const{error}=await sb.auth.signInWithOAuth({provider:"google",options:{redirectTo:back}});
    if(error){fail(error);g.disabled=false;g.querySelector("span").textContent="Continue with Google"}};
  // Phone OTP sign-in: name + number -> SMS code -> logged in. New numbers get an account automatically.
  const pb=$("#phoneBtn");if(pb){const panel=$("#phonePanel");let phone="",timer;
    pb.onclick=()=>{panel.hidden=!panel.hidden;pb.classList.toggle("open",!panel.hidden);if(!panel.hidden)$("#phName").focus()};
    const startResend=()=>{let s=30;const a=$("#resendOtp");a.classList.add("disabled");clearInterval(timer);
      const tick=()=>{a.textContent=s>0?`Resend OTP in ${s}s`:"Resend OTP";if(s<=0){a.classList.remove("disabled");clearInterval(timer)}s--};tick();timer=setInterval(tick,1000)};
    const send=async()=>{const name=$("#phName").value.trim(),digits=$("#phNumber").value.replace(/\D/g,"");
      if(!name)return toast("Please enter your name",false);
      if(digits.length!==10)return toast("Enter a valid 10-digit mobile number",false);
      phone="+91"+digits;const b=$("#sendOtpBtn");b.disabled=true;b.textContent="Sending...";
      const{error}=await sb.auth.signInWithOtp({phone,options:{data:{full_name:name,phone:digits}}});
      b.disabled=false;b.textContent="Send OTP";if(error)return fail(error);
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
    try{if(signup){const{data,error}=await sb.auth.signUp({email:f.email.value,password:f.password.value,options:{data:{full_name:f.name.value,phone:f.phone.value}}});if(error)throw error;
        if(!data.session){toast("Account created. Check your email to confirm, then login.");b.disabled=false;return}}
      else{const{error}=await sb.auth.signInWithPassword({email:f.email.value,password:f.password.value});if(error)throw error}
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
  root.innerHTML=list.length?list.map(t=>`<article class="test"><div class="test-top"><div><h3>${esc(t.name)}</h3><small class="muted">${esc(t.category)} · ${esc(t.sample)} sample · ${esc(t.turnaround)}</small>${prepLine(t.instructions)}</div><div><div class="price">${money(t.price)}</div><div class="mrp">MRP ${money(t.mrp)}</div></div></div><div class="lab"><div><span>Report in ${esc(t.turnaround)} · Home collection</span></div>${addBtn(t.id,CART_IDS.has(t.id))}</div></article>`).join(""):`<div class="empty" style="grid-column:1/-1">No tests match your search. Try another test name.</div>`}
async function initHome(){if(!$("#testGrid"))return;const{data,error}=await sb.from("tests").select("*").eq("active",true).order("id");if(error)return fail(error);TESTS=data;
  const c=await me();if(c){const{data:ci}=await sb.from("cart_items").select("test_id");CART_IDS=new Set((ci||[]).map(x=>x.test_id))}
  renderTests();
  const cur=()=>$(".chip.active")?.dataset.cat||"All";
  $("#searchInput").addEventListener("input",e=>renderTests(e.target.value,cur()));
  document.querySelectorAll(".chip").forEach(c=>c.addEventListener("click",()=>{document.querySelectorAll(".chip").forEach(x=>x.classList.remove("active"));c.classList.add("active");renderTests($("#searchInput").value,c.dataset.cat)}));
  $("#testGrid").addEventListener("click",async e=>{const b=e.target.closest("[data-add]");if(!b||b.classList.contains("added"))return;
    const c=await me();if(!c){location.href="login.html?next=index.html";return}
    const id=+b.dataset.add;b.disabled=true;b.classList.add("pop");
    const{error}=await sb.from("cart_items").upsert({user_id:c.user.id,test_id:id},{onConflict:"user_id,test_id",ignoreDuplicates:true});
    if(error){b.disabled=false;b.classList.remove("pop");return fail(error)}
    CART_IDS.add(id);b.classList.add("added");b.innerHTML=`${CHECK_ICON}<span>In cart</span>`;
    toast("Added to cart");initNav()})}
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
  const pick=id=>{sel=id;draw();fill()};
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
  return{selected:()=>sel==="self"?null:sel}}

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
async function initAccount(){const root=$("#myBookings");if(!root||!await guard())return;
  const n=new URLSearchParams(location.search).get("new");if(n)$("#newMsg").innerHTML=`<div class="notice">Booking <b>${esc(n)}</b> confirmed. Our staff will visit at your selected slot.</div>`;
  let byId={};
  const load=async()=>{const{data,error}=await sb.from("bookings").select("*,booking_items(name,instructions),reports(id,path)").order("created_at",{ascending:false});if(error)return fail(error);
  byId=Object.fromEntries(data.map(b=>[b.id,b]));
  root.innerHTML=data.length?data.map(b=>{const sm=statusMeta(b.status);
    return`<section class="job bk" data-status="${sm.cls}"><div class="jobhead"><span class="bk-ref">${esc(b.ref)}</span><span class="pill ${sm.cls}">${esc(b.status)}</span></div>
    <div class="patient">${ICONS.user}${esc(b.patient_name)}</div>
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
    </div></section>`}).join(""):`<div class="empty">No bookings yet. <a href="index.html#tests"><b>Browse tests</b></a></div>`};
  root.addEventListener("click",async e=>{
    const dl=e.target.closest("[data-path]");if(dl){const{data,error}=await sb.storage.from("reports").createSignedUrl(dl.dataset.path,120);if(error)return fail(error);window.open(data.signedUrl,"_blank");return}
    const pay=e.target.closest("[data-paynow]");if(pay){pay.disabled=true;const ok=await payOnline(pay.dataset.paynow,{name:_ctx?.profile?.full_name||"",email:_ctx?.user?.email||"",contact:_ctx?.profile?.phone||""});pay.disabled=false;if(ok)load();return}
    const cx=e.target.closest("[data-cancel]");if(cx){e.preventDefault();cancelDialog(byId[cx.dataset.cancel],load);return}
    const rs=e.target.closest("[data-resched]");if(rs){e.preventDefault();rescheduleDialog(byId[rs.dataset.resched],load)}});
  load()}

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
async function initAdmin(){const body=$("#bookingRows");if(!body||!await guard(["admin"],"login.html"))return;
  $("#logout").onclick=async e=>{e.preventDefault();await sb.auth.signOut();location.href="login.html"};
  // Sidebar tabs: the URL hash (#bookings, #reports...) decides which section is visible.
  const showTab=()=>{const t=(location.hash||"#overview").slice(1);const valid=$(`[data-tab="${t}"]`)?t:"overview";
    document.querySelectorAll("[data-tab]").forEach(s=>s.hidden=s.dataset.tab!==valid);
    document.querySelectorAll("[data-tab-link]").forEach(a=>a.classList.toggle("active",a.dataset.tabLink===valid));
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
  bookingsTable(body,rows=>{adminRows=rows;drawCash();
    $("#recentRows").innerHTML=rows.slice(0,5).map(b=>`<tr><td><b>${esc(b.ref)}</b></td><td>${esc(b.patient_name)}</td><td>${fmt(b.collect_date)} · ${esc(b.slot)}</td><td>${money(b.total)}</td><td><span class="pill ${statusMeta(b.status).cls}">${esc(b.status)}</span></td><td>${esc(b.payment)} · ${esc(b.payment_method||"Cash")}</td></tr>`).join("")||'<tr><td colspan="6" class="muted">No bookings yet.</td></tr>';
    const t=today(),live=rows.filter(x=>x.status!=="Cancelled"),paid=rows.filter(x=>x.payment==="Paid");
    $("#bookingCount").textContent=rows.length;$("#todayCount").textContent=rows.filter(x=>x.created_at.slice(0,10)===t).length;
    $("#revenue").textContent=money(paid.reduce((s,x)=>s+x.total,0));
    $("#cashRevenue").textContent=money(paid.filter(x=>x.payment_method==="Cash").reduce((s,x)=>s+x.total,0));
    $("#onlineRevenue").textContent=money(paid.filter(x=>x.payment_method==="Online").reduce((s,x)=>s+x.total,0));
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
      return{...p,saved:(addrs||[]).filter(a=>a.user_id===p.id),bookings:mine.length,lastAddr:mine[0]?`${mine[0].address}, ${mine[0].area}`:""}});
    drawUsers()};
  const drawUsers=()=>{const q=$("#userSearch").value.trim().toLowerCase(),role=$("#userRole").value;
    const list=users.filter(u=>(role==="all"||u.role===role)&&[u.full_name,u.phone,u.email,u.gender,u.lastAddr,...u.saved.map(a=>`${a.label} ${a.address} ${a.area}`)].join(" ").toLowerCase().includes(q));
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
  $("#userSearch").addEventListener("input",drawUsers);$("#userRole").addEventListener("change",drawUsers);

  // --- Test Pricing tab ---
  const loadTests=async()=>{const{data,error}=await sb.from("tests").select("*").order("id");if(error)return fail(error);
    $("#testRows").innerHTML=data.map(t=>`<tr data-test="${t.id}"><td><input name="name" value="${esc(t.name)}" style="min-width:200px"></td><td><input name="category" value="${esc(t.category)}" style="min-width:120px"></td><td><input name="price" type="number" min="0" value="${t.price}" style="width:90px"></td><td><input name="mrp" type="number" min="0" value="${t.mrp??""}" style="width:90px"></td><td><input name="turnaround" value="${esc(t.turnaround)}" style="width:110px"></td><td><input name="instructions" value="${esc(t.instructions||"")}" placeholder="e.g. Fast 10-12 hours" style="min-width:220px"></td><td><input name="active" type="checkbox" style="width:auto"${t.active?" checked":""}></td><td><button class="green" data-save-test style="padding:7px 12px;font-size:12px">Save</button></td></tr>`).join("")};
  $("#testRows").addEventListener("click",async e=>{if(!e.target.closest("[data-save-test]"))return;const tr=e.target.closest("tr"),v=n=>tr.querySelector(`[name=${n}]`);
    const{error}=await sb.from("tests").update({name:v("name").value.trim(),category:v("category").value.trim(),price:+v("price").value,mrp:v("mrp").value?+v("mrp").value:null,turnaround:v("turnaround").value.trim(),instructions:v("instructions").value.trim()||null,active:v("active").checked}).eq("id",+tr.dataset.test);
    if(error)return fail(error);toast("Test saved")});
  $("#newTestForm").onsubmit=async e=>{e.preventDefault();const f=e.target;
    const{error}=await sb.from("tests").insert({name:f.name.value.trim(),category:f.category.value.trim(),price:+f.price.value,mrp:+f.mrp.value,sample:f.sample.value.trim(),turnaround:f.turnaround.value.trim(),instructions:f.instructions.value.trim()||null});
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

  loadTests();loadUsers()}

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
  root.innerHTML=data.length?data.map(j=>`<section class="job"><div class="jobhead"><b>${esc(j.ref)}</b><span style="display:flex;gap:10px;align-items:center"><a href="#" class="tl-link" data-timeline="${j.id}" data-ref="${esc(j.ref)}">Timeline</a><span class="pill amber" id="st-${j.id}">${esc(j.status)}</span></span></div>${j.sample_id?`<div class="sample-box"><span>Sample ID · write on every tube</span><b>${esc(j.sample_id)}</b></div>`:""}<div class="patient">${esc(j.patient_name)}${j.patient_age!=null?` <span class="muted" style="font-size:13px;font-weight:600">· ${ageText(j.patient_age,j.patient_age_unit)} · ${esc(j.patient_gender||"")}</span>`:""}</div><div class="detail">Collection: ${fmt(j.collect_date)} · ${esc(j.slot)}<br>Area: ${esc(j.area)}<br>Address: ${esc(j.address)}</div><div class="tests">${j.booking_items.map(i=>esc(i.name)).join(", ")}</div>${j.booking_items.filter(i=>i.instructions).map(i=>prepLine(`${i.name}: ${i.instructions}`)).join("")}${contactRow(j)}<div id="pay-${j.id}">${payLine(j)}</div><div class="job-actions"><select id="up-${j.id}"><option>Sample collected</option><option>Handed over to lab</option><option>Lab received sample</option><option>Processing started</option></select><button class="green" data-job="${j.id}">Save update</button></div></section>`).join(""):'<div class="empty">No active bookings right now.</div>'};
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
          <div class="stop-actions">${digits?`<a class="contact-btn call sm" href="tel:${tel}">${PHONE_ICON}<span>Call</span></a>`:""}<a class="contact-btn map sm" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addrOf(b))}">${NAV_ICON}<span>Directions</span></a>${pay}${prep}</div>
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
  const load=async()=>{const{data,error}=await sb.from("bookings").select("id,ref,patient_name,booking_items(name),reports(id,path)").order("created_at",{ascending:false});
    if(error)return fail(error);ALL_BOOKINGS=data;draw()};
  const draw=()=>{const q=($("#reportSearch").value||"").toLowerCase();const showAll=$("#showUploaded").checked;
    const list=ALL_BOOKINGS.filter(b=>(showAll||!b.reports.length)&&(b.patient_name||"").toLowerCase().includes(q));
    root.innerHTML=list.length?list.map(b=>`<div class="job" data-id="${b.id}"><div class="jobhead"><b>${esc(b.ref)}</b>${b.reports.length?'<span class="pill green">Uploaded</span>':'<span class="pill amber">Pending</span>'}</div><div class="patient">${esc(b.patient_name)}</div><div class="tests">${b.booking_items.map(i=>esc(i.name)).join(", ")}</div><div class="job-actions" style="align-items:center">${b.reports.length?`<a href="#" data-view="${esc(b.reports[0].path)}"><b>View current PDF</b></a>`:""}<input type="file" accept="application/pdf" data-up style="max-width:260px"></div></div>`).join(""):`<div class="empty">${q?"No matching patient found.":"No pending reports right now 🎉"}</div>`};
  $("#reportSearch").addEventListener("input",draw);
  $("#showUploaded").addEventListener("change",draw);
  root.addEventListener("change",async e=>{if(e.target.dataset.up===undefined)return;const id=e.target.closest("[data-id]").dataset.id;const file=e.target.files[0];if(!file)return;
    if(file.type!=="application/pdf"||file.size>10*1048576)return toast("Upload a PDF under 10 MB");
    const path=`${id}/${Date.now()}.pdf`;let r=await sb.storage.from("reports").upload(path,file,{contentType:"application/pdf"});if(r.error)return fail(r.error);
    r=await sb.rpc("staff_upload_report",{p_booking_id:id,p_path:path});if(r.error)return fail(r.error);
    toast("Report uploaded — now visible to the patient");load()});
  root.addEventListener("click",async e=>{const a=e.target.closest("[data-view]");if(!a)return;e.preventDefault();const{data,error}=await sb.storage.from("reports").createSignedUrl(a.dataset.view,120);if(error)return fail(error);window.open(data.signedUrl,"_blank")});
  load();return load}

document.addEventListener("DOMContentLoaded",()=>{initNav();initLogin();initStaffLogin();initAdminLogin();initTagline();initHome();initCart();initBooking();initProfile();initAccount();initReceipt();initAdmin();initStaff()});
