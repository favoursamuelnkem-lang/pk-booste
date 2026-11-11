const API_URL="https://pk-booste.onrender.com"; const token=localStorage.getItem("pkBoosterAdminToken"); if(!token) location.href="./admin-login.html";
const $=id=>document.getElementById(id); const money=v=>`₦${Number(v||0).toLocaleString("en-NG",{minimumFractionDigits:0,maximumFractionDigits:2})}`; const date=v=>v?new Date(v).toLocaleString():"—";
async function api(path,options={}){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);try{const r=await fetch(API_URL+path,{...options,signal:controller.signal,headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`,...(options.headers||{})}});const d=await r.json().catch(()=>({}));if(r.status===401||r.status===403){localStorage.removeItem("pkBoosterAdminToken");location.href="./admin-login.html";throw Error("Admin session expired.")}if(!r.ok||d.success===false)throw Error(d.message||"Request failed.");return d}catch(e){if(e.name==="AbortError")throw Error("Request timed out. Please try again.");throw e}finally{clearTimeout(timer)}}
const esc=v=>String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
function badge(s){const v=String(s||"").toLowerCase();const c={completed:"bg-green-50 text-green-700",successful:"bg-green-50 text-green-700",processing:"bg-blue-50 text-blue-700",pending:"bg-yellow-50 text-yellow-700",partial:"bg-purple-50 text-purple-700",cancelled:"bg-red-50 text-red-700",refunded:"bg-purple-50 text-purple-700",failed:"bg-red-50 text-red-700",approved:"bg-green-50 text-green-700",rejected:"bg-red-50 text-red-700"};return `<span class="px-2.5 py-1 rounded-full text-xs font-bold ${c[v]||"bg-gray-100 text-gray-600"}">${esc(s||"unknown")}</span>`}
async function loadDashboard(){const d=await api("/api/admin/dashboard"),s=d.stats;let rev={sales:0,providerCost:0,profit:0};try{rev=(await api("/api/admin/revenue")).summary}catch{};$('statGrid').innerHTML=[["Total users",s.users,"👥"],["Wallet balance",money(s.walletBalance),"◉"],["Deposits",money(s.deposits),"＋"],["Order sales",money(s.sales),"▤"],["Orders",s.orders,"↗"],["Transactions",s.transactions,"↔"],["Provider cost",money(rev.providerCost),"◌"],["Gross profit",money(rev.profit),"◆"]].map(x=>`<div class="bg-white border border-gray-100 rounded-2xl p-5"><div class="flex justify-between"><p class="text-sm text-gray-400 font-medium">${x[0]}</p><span>${x[2]}</span></div><p class="text-2xl font-black mt-3">${x[1]}</p></div>`).join("");$('orderStatus').innerHTML=`<div class="flex justify-between p-3 rounded-xl bg-gray-50"><span>Pending / processing</span><b>${s.pendingOrders}</b></div><div class="flex justify-between p-3 rounded-xl bg-gray-50"><span>Completed</span><b>${s.completedOrders}</b></div><div class="flex justify-between p-3 rounded-xl bg-gray-50"><span>Cancelled / refunded</span><b>${s.refundedOrders}</b></div>`;$('recentUsers').innerHTML=d.recentUsers.map(u=>`<div class="py-3 flex justify-between"><div><b>${esc(u.fullName)}</b><p class="text-xs text-gray-400">${esc(u.email)}</p></div><b>${money(u.balance)}</b></div>`).join("")||`<p class="text-sm text-gray-400">No users yet.</p>`}
async function loadUsers(){const q=encodeURIComponent(($('userSearch').value||"").trim()),d=await api(`/api/admin/users?search=${q}&limit=100`);$('usersTable').innerHTML=d.users.map(u=>`<tr><td><b>${esc(u.fullName)}</b></td><td>${esc(u.email)}</td><td><b>${money(u.balance)}</b></td><td>${u.active===false?badge("suspended"):badge("active")}</td><td>${date(u.createdAt)}</td><td class="whitespace-nowrap"><button class="px-3 py-2 rounded-lg bg-purple-50 text-purple-600 font-bold" data-wallet="${u._id}" data-name="${esc(u.fullName)}" data-email="${esc(u.email)}">Wallet</button><button class="ml-2 px-3 py-2 rounded-lg font-bold ${u.active===false?"bg-green-50 text-green-700":"bg-red-50 text-red-600"}" data-toggle="${u._id}" data-active="${u.active!==false}">${u.active===false?"Activate User":"Suspend User"}</button></td></tr>`).join("")||`<tr><td colspan="6" class="text-center text-gray-400">No users found.</td></tr>`;document.querySelectorAll('[data-wallet]').forEach(b=>b.onclick=()=>openWallet(b.dataset.wallet,b.dataset.name,b.dataset.email));document.querySelectorAll('[data-toggle]').forEach(b=>b.onclick=async()=>{try{b.disabled=true;await api(`/api/admin/users/${b.dataset.toggle}/status`,{method:"PATCH",body:JSON.stringify({active:b.dataset.active!=="true"})});await loadUsers()}catch(e){showError(e);b.disabled=false}})}
async function loadOrders(){const q=encodeURIComponent($('orderSearch').value||""),st=encodeURIComponent($('orderStatusFilter').value||""),d=await api(`/api/admin/orders?search=${q}&status=${st}&limit=100`);$('ordersTable').innerHTML=d.orders.map(o=>{const profit=Number(o.amount||0)-Number(o.providerCharge||0);return `<tr><td><b>${esc(o.providerOrderId)}</b><p class="text-xs text-gray-400">${String(o._id).slice(-8)}</p></td><td>${esc((o.userId||o.user)?.fullName||"Unknown")}<p class="text-xs text-gray-400">${esc((o.userId||o.user)?.email||"")}</p></td><td><b>${esc(o.serviceName)}</b><p class="text-xs text-gray-400 truncate max-w-[220px]">${esc(o.link)}</p></td><td>${money(o.amount)}</td><td>${money(o.providerCharge)}</td><td class="font-bold">${money(profit)}</td><td>${badge(o.status)}</td><td><select class="px-2 py-2 rounded-lg border" data-order-status="${o._id}"><option>${esc(o.status)}</option><option>pending</option><option>processing</option><option>completed</option><option>partial</option><option>cancelled</option><option>refunded</option></select></td></tr>`}).join("")||`<tr><td colspan="8" class="text-center text-gray-400">No orders found.</td></tr>`;document.querySelectorAll('[data-order-status]').forEach(s=>s.onchange=async()=>{await api(`/api/admin/orders/${s.dataset.orderStatus}`,{method:"PATCH",body:JSON.stringify({status:s.value})});loadOrders();loadDashboard()})}
async function loadTransactions(){const d=await api("/api/admin/transactions?limit=100");$('transactionsTable').innerHTML=d.transactions.map(t=>`<tr><td>${esc(t.txRef)}</td><td>${esc((t.userId||t.user)?.fullName||"Unknown")}<p class="text-xs text-gray-400">${esc((t.userId||t.user)?.email||"")}</p></td><td>${esc(t.type)}</td><td><b>${money(t.amount)}</b></td><td>${badge(t.status)}</td><td>${date(t.createdAt)}</td></tr>`).join("")||`<tr><td colspan="6" class="text-center text-gray-400">No transactions.</td></tr>`}
async function loadDeposits(){const d=await api("/api/admin/deposits");$('depositsTable').innerHTML=d.transactions.map(t=>`<tr><td>${esc(t.txRef)}</td><td>${esc((t.userId||t.user)?.fullName||"Unknown")}<p class="text-xs text-gray-400">${esc((t.userId||t.user)?.email||"")}</p></td><td><b>${money(t.amount)}</b></td><td>${badge(t.status)}</td><td>${date(t.createdAt)}</td></tr>`).join("")||`<tr><td colspan="5" class="text-center text-gray-400">No deposits.</td></tr>`}
async function loadWithdrawals(){const d=await api("/api/admin/withdrawals");$('withdrawalsTable').innerHTML=d.withdrawals.map(w=>`<tr><td>${esc((w.userId||w.user)?.fullName||"Unknown")}<p class="text-xs text-gray-400">${esc((w.userId||w.user)?.email||"")}</p></td><td><b>${money(w.amount)}</b></td><td>${esc(w.method)}</td><td>${esc(w.destination)}</td><td>${badge(w.status)}</td><td><select class="px-2 py-2 rounded-lg border" data-withdrawal="${w._id}"><option>${w.status}</option><option>pending</option><option>approved</option><option>rejected</option></select></td></tr>`).join("")||`<tr><td colspan="6" class="text-center text-gray-400">No withdrawals.</td></tr>`;document.querySelectorAll('[data-withdrawal]').forEach(s=>s.onchange=async()=>{await api(`/api/admin/withdrawals/${s.dataset.withdrawal}`,{method:"PATCH",body:JSON.stringify({status:s.value})});loadWithdrawals()})}

let adminServicesCache=null,adminPricesCache=null,servicePage=1,pricePage=1;
const ADMIN_SERVICE_PAGE_SIZE=40;
function adminPager(targetId,page,pages,onPage){
 const host=$(targetId);
 const holder=host.closest(".card")||host.parentElement.parentElement;
 let pager=holder.querySelector(".admin-local-pager");
 if(!pager){pager=document.createElement("div");pager.className="admin-local-pager flex flex-wrap items-center justify-between gap-3 p-3 text-sm";holder.appendChild(pager);}
 pager.innerHTML=`<span class="text-gray-500">Page ${page} of ${Math.max(1,pages)}</span><div class="flex gap-2"><button type="button" class="btn" ${page<=1?"disabled":""} data-prev>Previous</button><button type="button" class="btn" ${page>=pages?"disabled":""} data-next>Next</button></div>`;
 pager.querySelector("[data-prev]").onclick=()=>onPage(page-1);
 pager.querySelector("[data-next]").onclick=()=>onPage(page+1);
}
async function loadServices(force=false){
 if(force||!adminServicesCache){
  const d=await api("/api/admin/services");
  adminServicesCache=d.services||[];
  if(d.refreshing && !adminServicesCache.length) setTimeout(()=>{adminServicesCache=null;loadServices().catch(showError)},10000);
 }
 const q=( $("serviceSearch").value||"").toLowerCase();
 const filtered=adminServicesCache.filter(x=>`${x.serviceId} ${x.name} ${x.displayName} ${x.category}`.toLowerCase().includes(q));
 const pages=Math.max(1,Math.ceil(filtered.length/ADMIN_SERVICE_PAGE_SIZE));servicePage=Math.min(Math.max(1,servicePage),pages);
 const rows=filtered.slice((servicePage-1)*ADMIN_SERVICE_PAGE_SIZE,servicePage*ADMIN_SERVICE_PAGE_SIZE);
 $("servicesTable").innerHTML=rows.map(x=>`<tr>
 <td data-label="Provider ID">${esc(x.serviceId)}</td>
 <td data-label="Provider service">${esc(x.name)}</td>
 <td data-label="Customer name"><input data-sname="${x.serviceId}" value="${esc(x.displayName)}" class="input w-full"></td>
 <td data-label="Category"><input data-scat="${x.serviceId}" value="${esc(x.category)}" class="input w-full"></td>
 <td data-label="Provider cost / 1K">${money(x.providerRate)}</td>
 <td data-label="Your selling price / 1K"><input data-selling="${x.serviceId}" type="number" min="0" step="0.01" value="${Number(x.sellingRate||0).toFixed(2)}" class="input w-full"></td>
 <td data-label="Enabled"><input data-enabled="${x.serviceId}" type="checkbox" ${x.enabled?"checked":""} class="w-5 h-5"></td>
 <td data-label="Minimum"><input data-min="${x.serviceId}" type="number" value="${x.minOverride??x.min}" class="input w-full"></td>
 <td data-label="Maximum"><input data-max="${x.serviceId}" type="number" value="${x.maxOverride??x.max}" class="input w-full"></td>
 <td data-label="Action"><button class="btn w-full" data-save-service="${x.serviceId}">Save</button></td></tr>`).join("")||`<tr><td colspan="10" class="text-center text-gray-400 py-8">${adminServicesCache.length===0?'No provider services are loaded yet. Use Refresh to retry the Owlet catalogue.':'No services found.'}</td></tr>`;
 adminPager("servicesTable",servicePage,pages,p=>{servicePage=p;loadServices().catch(showError)});
 document.querySelectorAll("[data-save-service]").forEach(b=>b.onclick=async()=>{
  const id=b.dataset.saveService,row=b.closest("tr");b.disabled=true;b.textContent="Saving...";
  try{
   await api(`/api/admin/services/${id}`,{method:"PUT",body:JSON.stringify({
    displayName:row.querySelector(`[data-sname="${CSS.escape(id)}"]`).value,
    category:row.querySelector(`[data-scat="${CSS.escape(id)}"]`).value,
    sellingRate:Number(row.querySelector(`[data-selling="${CSS.escape(id)}"]`).value),
    enabled:row.querySelector(`[data-enabled="${CSS.escape(id)}"]`).checked,
    minOverride:row.querySelector(`[data-min="${CSS.escape(id)}"]`).value,
    maxOverride:row.querySelector(`[data-max="${CSS.escape(id)}"]`).value
   })});
   adminServicesCache=null;await loadServices(true);
  }catch(e){showError(e);b.disabled=false;b.textContent="Save"}
 });
}
async function loadPrices(force=false){
 if(force||!adminPricesCache){const d=await api("/api/admin/prices");adminPricesCache=d.services||[];if(d.refreshing)setTimeout(()=>{adminPricesCache=null;loadPrices().catch(showError)},6000);}
 const q=($("priceSearch").value||"").toLowerCase();
 const filtered=adminPricesCache.filter(x=>`${x.serviceId} ${x.name} ${x.category}`.toLowerCase().includes(q));
 const pages=Math.max(1,Math.ceil(filtered.length/ADMIN_SERVICE_PAGE_SIZE));pricePage=Math.min(Math.max(1,pricePage),pages);
 const rows=filtered.slice((pricePage-1)*ADMIN_SERVICE_PAGE_SIZE,pricePage*ADMIN_SERVICE_PAGE_SIZE);
 $("pricesTable").innerHTML=rows.map(x=>{const p=Number(x.providerRate),s=Number(x.sellingRate),m=p?((s-p)/p*100):0;return `<tr>
 <td data-label="Provider ID">${esc(x.serviceId)}</td>
 <td data-label="Service"><b>${esc(x.name)}</b><p class="text-xs text-gray-400">${x.customized?"Custom":"Default"}</p></td>
 <td data-label="Provider cost / 1K">${p.toFixed(2)}</td>
 <td data-label="Your price / 1K"><input data-price="${x.serviceId}" type="number" min="0" step="0.01" value="${s.toFixed(2)}" class="input w-full"></td>
 <td data-label="Markup">${m.toFixed(2)}%</td>
 <td data-label="Action"><div class="flex flex-col gap-2"><button class="btn w-full" data-save-price="${x.serviceId}">Save</button><button class="px-3 py-2 rounded-xl bg-gray-100 font-bold w-full" data-reset-price="${x.serviceId}">Reset</button></div></td></tr>`}).join("")||`<tr><td colspan="6" class="text-center text-gray-400">No services found.</td></tr>`;
 adminPager("pricesTable",pricePage,pages,p=>{pricePage=p;loadPrices().catch(showError)});
 document.querySelectorAll("[data-save-price]").forEach(b=>b.onclick=async()=>{const id=b.dataset.savePrice,v=Number(document.querySelector(`[data-price="${CSS.escape(id)}"]`).value);await api(`/api/admin/prices/${id}`,{method:"PUT",body:JSON.stringify({sellingRate:v})});adminPricesCache=null;await loadPrices(true)});
 document.querySelectorAll("[data-reset-price]").forEach(b=>b.onclick=async()=>{if(confirm("Reset this price to the default markup?")){await api(`/api/admin/prices/${b.dataset.resetPrice}`,{method:"DELETE"});adminPricesCache=null;await loadPrices(true)}});
}
async function loadRevenue(){const d=await api("/api/admin/revenue");const s=d.summary;$('revenueStats').innerHTML=[["Sales",money(s.sales)],["Provider Cost",money(s.providerCost)],["Gross Profit",money(s.profit)],["Completed Orders",s.completedOrders]].map(x=>`<div class="bg-white border border-gray-100 rounded-2xl p-5"><p class="text-sm text-gray-400">${x[0]}</p><p class="text-2xl font-black mt-2">${x[1]}</p></div>`).join("");$('revenueTable').innerHTML=d.orders.map(o=>`<tr><td>${esc(o.providerOrderId)}</td><td>${money(o.amount)}</td><td>${money(o.providerCharge)}</td><td class="font-bold">${money(Number(o.amount||0)-Number(o.providerCharge||0))}</td><td>${badge(o.status)}</td><td>${date(o.createdAt)}</td></tr>`).join("")}
async function loadProvider(){const d=await api("/api/admin/provider"),b=d.balance||{};$('providerBalance').innerHTML=`<p class="text-white/70">Owlet provider balance</p><div class="text-3xl font-black mt-2">${esc(b.balance??b)}</div>`;$('providerTable').innerHTML=d.services.map(x=>`<tr><td>${esc(x.service)}</td><td>${esc(x.name)}</td><td>${esc(x.category||"")}</td><td>${Number(x.providerRate).toFixed(2)}</td><td>${Number(x.sellingRate).toFixed(2)}</td><td>${esc(x.min)} / ${esc(x.max)}</td></tr>`).join("")}
async function loadCoupons(){const d=await api("/api/admin/coupons");$('couponsTable').innerHTML=d.coupons.map(c=>`<tr><td><b>${esc(c.code)}</b></td><td>${c.type}</td><td>${c.type==='percent'?c.value+'%':money(c.value)}</td><td>${c.usedCount}/${c.usageLimit||'∞'}</td><td>${date(c.expiresAt)}</td><td>${badge(c.active?'active':'disabled')}</td><td><button class="px-3 py-2 rounded-lg bg-gray-100 font-bold" data-coupon-toggle="${c._id}" data-active="${c.active}">${c.active?'Disable':'Enable'}</button><button class="ml-2 px-3 py-2 rounded-lg bg-red-50 text-red-600 font-bold" data-coupon-delete="${c._id}">Delete</button></td></tr>`).join("")||`<tr><td colspan="7" class="text-center text-gray-400">No coupons.</td></tr>`;document.querySelectorAll('[data-coupon-toggle]').forEach(b=>b.onclick=async()=>{await api(`/api/admin/coupons/${b.dataset.couponToggle}`,{method:"PATCH",body:JSON.stringify({active:b.dataset.active!=="true"})});loadCoupons()});document.querySelectorAll('[data-coupon-delete]').forEach(b=>b.onclick=async()=>{if(confirm("Delete coupon?")){await api(`/api/admin/coupons/${b.dataset.couponDelete}`,{method:"DELETE"});loadCoupons()}})}
async function loadAnnouncements(){const d=await api("/api/admin/announcements");$('announcementsList').innerHTML=d.announcements.map(a=>`<div class="card"><div class="flex justify-between gap-3"><div><b>${esc(a.title)}</b><p class="text-gray-500 mt-1">${esc(a.message)}</p></div><button class="text-red-500 font-bold" data-ann-delete="${a._id}">Delete</button></div><div class="mt-3">${badge(a.active?'active':'disabled')}</div></div>`).join("")||`<p class="text-gray-400">No announcements.</p>`;document.querySelectorAll('[data-ann-delete]').forEach(b=>b.onclick=async()=>{if(confirm("Delete announcement?")){await api(`/api/admin/announcements/${b.dataset.annDelete}`,{method:"DELETE"});loadAnnouncements()}})}
async function loadActivity(){const d=await api("/api/admin/activity");$('activityTable').innerHTML=d.logs.map(x=>`<tr><td>${date(x.createdAt)}</td><td>${esc(x.adminEmail)}</td><td><b>${esc(x.action)}</b></td><td>${esc(x.targetType)} ${esc(x.targetId)}</td><td>${esc(x.details)}</td></tr>`).join("")||`<tr><td colspan="5" class="text-center text-gray-400">No activity yet.</td></tr>`}
async function loadSettings(){const d=await api("/api/admin/settings"),s=d.settings;$('settingWebsiteName').value=s.websiteName||"";$('settingSupportEmail').value=s.supportEmail||"";$('settingWhatsapp').value=s.whatsapp||"";$('settingMaintenance').checked=!!s.maintenanceMode;$('settingRegistration').checked=s.registrationEnabled!==false}
function showSection(n){document.querySelectorAll('.admin-section').forEach(x=>x.classList.add('hidden'));$(`section-${n}`).classList.remove('hidden');document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.section===n));$('sectionTitle').textContent={dashboard:'Dashboard',users:'Users',orders:'Orders',services:'Services',prices:'Manage Prices',transactions:'Transactions',deposits:'Deposits',withdrawals:'Withdrawals',revenue:'Revenue & Profit',coupons:'Coupons',announcements:'Announcements',provider:'Provider',activity:'Activity Logs',email:'Email',settings:'Settings',security:'Admin Security'}[n]||n;const f={dashboard:loadDashboard,users:loadUsers,orders:loadOrders,services:loadServices,prices:loadPrices,transactions:loadTransactions,deposits:loadDeposits,withdrawals:loadWithdrawals,revenue:loadRevenue,coupons:loadCoupons,announcements:loadAnnouncements,provider:loadProvider,activity:loadActivity,email:async()=>{},settings:loadSettings,security:async()=>{}};if(f[n])f[n]().catch(showError)}
function showError(e){alert(e.message||"Something went wrong.")}
async function openWallet(id,n,e){$('walletUserId').value=id;$('modalUser').textContent=`${n} • ${e}`;$('modalBalance').textContent='Loading current balance...';$('walletAmount').value="";$('walletReason').value="";$('walletMessage').className="hidden";$('modal').classList.remove('hidden');$('modal').classList.add('flex');try{const d=await api(`/api/admin/users/${id}`);$('modalBalance').textContent=`Current balance: ${money(d.user.balance)}`}catch(x){$('modalBalance').textContent='Unable to load current balance.'}}
function closeModal(){$('modal').classList.add('hidden');$('modal').classList.remove('flex')}
$('closeModal').onclick=closeModal;$('walletForm').onsubmit=async e=>{e.preventDefault();try{const d=await api(`/api/admin/users/${$('walletUserId').value}/wallet`,{method:'POST',body:JSON.stringify({action:$('walletAction').value,amount:Number($('walletAmount').value),reason:$('walletReason').value.trim()})});$('walletMessage').textContent=`${d.message} New balance: ${money(d.user.balance)}`;$('walletMessage').className='px-4 py-3 rounded-xl text-sm bg-green-50 text-green-700';loadUsers();loadDashboard()}catch(x){$('walletMessage').textContent=x.message;$('walletMessage').className='px-4 py-3 rounded-xl text-sm bg-red-50 text-red-700'}};
$('couponForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/admin/coupons',{method:'POST',body:JSON.stringify({code:$('couponCode').value,type:$('couponType').value,value:Number($('couponValue').value),minOrder:Number($('couponMin').value||0),maxDiscount:Number($('couponMax').value||0),usageLimit:Number($('couponLimit').value||0),expiresAt:$('couponExpiry').value||null})});e.target.reset();loadCoupons()}catch(x){showError(x)}};
$('announcementForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/admin/announcements',{method:'POST',body:JSON.stringify({title:$('announcementTitle').value,message:$('announcementMessage').value,type:$('announcementType').value,expiresAt:$('announcementExpiry').value||null})});e.target.reset();loadAnnouncements()}catch(x){showError(x)}};
$('settingsForm').onsubmit=async e=>{e.preventDefault();try{const d=await api('/api/admin/settings',{method:'PUT',body:JSON.stringify({websiteName:$('settingWebsiteName').value,supportEmail:$('settingSupportEmail').value,whatsapp:$('settingWhatsapp').value,maintenanceMode:$('settingMaintenance').checked,registrationEnabled:$('settingRegistration').checked})});$('settingsMessage').textContent=d.message;$('settingsMessage').className='px-4 py-3 rounded-xl text-sm bg-green-50 text-green-700'}catch(x){$('settingsMessage').textContent=x.message;$('settingsMessage').className='px-4 py-3 rounded-xl text-sm bg-red-50 text-red-700'}};
$('securityForm').onsubmit=async e=>{e.preventDefault();if($('newPassword').value!==$('confirmPassword').value)return alert('Passwords do not match.');try{const d=await api('/api/admin/change-password',{method:'POST',body:JSON.stringify({currentPassword:$('currentPassword').value,newPassword:$('newPassword').value})});alert(d.message);logout()}catch(x){$('securityMessage').textContent=x.message;$('securityMessage').className='px-4 py-3 rounded-xl text-sm bg-red-50 text-red-700'}};
$('userSearchBtn').onclick=()=>loadUsers().catch(showError);$('orderSearchBtn').onclick=()=>loadOrders().catch(showError);$('serviceRefreshBtn').onclick=()=>{adminServicesCache=null;loadServices(true).catch(showError)};$('serviceSearch').oninput=()=>loadServices().catch(showError);$('priceRefreshBtn').onclick=()=>{adminPricesCache=null;loadPrices(true).catch(showError)};$('priceSearch').oninput=()=>loadPrices().catch(showError);$('logoutBtn').onclick=logout;$('mobileLogout').onclick=logout;function logout(){localStorage.removeItem('pkBoosterAdminToken');localStorage.removeItem('pkBoosterAdmin');location.href='./admin-login.html'}document.querySelectorAll('.nav-btn').forEach(b=>b.onclick=()=>showSection(b.dataset.section));const admin=JSON.parse(localStorage.getItem('pkBoosterAdmin')||'{}');$('adminEmail').textContent=admin.email||'Administrator';api('/api/admin/me').then(()=>loadDashboard()).catch(showError);
const adminMenuBtn=$('adminMenuBtn'),adminMenuClose=$('adminMenuClose'),adminMobileDrawer=$('adminMobileDrawer'),adminMobileOverlay=$('adminMobileOverlay'),mobileAdminNav=$('mobileAdminNav');
const mobileItems=[['dashboard','⌂ Dashboard'],['users','♙ Users'],['orders','▤ Orders'],['services','⚙ Services'],['prices','₦ Prices'],['transactions','↔ Transactions'],['deposits','＋ Deposits'],['withdrawals','↗ Withdrawals'],['revenue','◈ Revenue & Profit'],['coupons','% Coupons'],['announcements','▣ Announcements'],['provider','✦ Provider'],['activity','☷ Activity Logs'],['email','✉ Email'],['settings','⚙ Settings'],['security','Security']];
mobileAdminNav.innerHTML=mobileItems.map(([id,label])=>`<button type="button" data-mobile-section="${id}" class="w-full text-left px-4 py-3 rounded-xl text-gray-600 font-semibold hover:bg-gray-50">${label}</button>`).join('');
function openAdminMenu(){
  if(!adminMobileDrawer||!adminMobileOverlay)return;
  adminMobileDrawer.style.setProperty('display','flex','important');
  adminMobileDrawer.style.setProperty('visibility','visible','important');
  adminMobileDrawer.style.setProperty('opacity','1','important');
  adminMobileDrawer.style.setProperty('pointer-events','auto','important');
  adminMobileDrawer.style.setProperty('transform','translate3d(0,0,0)','important');
  adminMobileOverlay.style.setProperty('display','block','important');
  adminMobileOverlay.style.setProperty('visibility','visible','important');
  adminMobileOverlay.style.setProperty('opacity','1','important');
  adminMobileOverlay.style.setProperty('pointer-events','auto','important');
  document.body.classList.add('admin-menu-open');
  adminMenuBtn?.setAttribute('aria-expanded','true');
}
function closeAdminMenu(){
  if(adminMobileDrawer){
    adminMobileDrawer.style.setProperty('visibility','hidden','important');
    adminMobileDrawer.style.setProperty('pointer-events','none','important');
    adminMobileDrawer.style.setProperty('transform','translate3d(-105%,0,0)','important');
  }
  if(adminMobileOverlay){
    adminMobileOverlay.style.setProperty('visibility','hidden','important');
    adminMobileOverlay.style.setProperty('opacity','0','important');
    adminMobileOverlay.style.setProperty('pointer-events','none','important');
  }
  document.body.classList.remove('admin-menu-open');
  adminMenuBtn?.setAttribute('aria-expanded','false');
}
adminMenuBtn?.addEventListener('click',(e)=>{e.preventDefault();e.stopPropagation();openAdminMenu()});
adminMenuClose?.addEventListener('click',(e)=>{e.preventDefault();e.stopPropagation();closeAdminMenu()});
adminMobileOverlay?.addEventListener('click',closeAdminMenu);
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeAdminMenu()});
document.querySelectorAll('[data-mobile-section]').forEach(b=>b.addEventListener('click',()=>{showSection(b.dataset.mobileSection);closeAdminMenu()}));
if($('mobileAdminEmail')) $('mobileAdminEmail').textContent=admin.email||'Administrator';

// Preserve older PK-BOOSTER admin deep links when migrating to the OG-style sections.
const legacyAdminHashMap={dashboard:"dashboard",usersPanel:"users",servicesPanel:"services",ordersPanel:"orders",transactionsPanel:"transactions"};
const legacyAdminHash=String(location.hash||"").replace(/^#/,"");
if(legacyAdminHashMap[legacyAdminHash])showSection(legacyAdminHashMap[legacyAdminHash]);
