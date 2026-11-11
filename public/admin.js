const $ = id => document.getElementById(id);
let records = [];
let activeImage = null;

async function api(url, options = {}) {
  const r = await fetch(url, options);
  const data = r.headers.get("content-type")?.includes("application/json") ? await r.json() : null;
  if (!r.ok) throw new Error(data?.error || "حدث خطأ.");
  return data;
}
function showDashboard(on) {
  $("loginPanel").classList.toggle("hidden", on);
  $("dashboard").classList.toggle("hidden", !on);
}
async function loadPhotos() {
  records = await api("/api/photos");
  $("count").textContent = `عدد الصور: ${records.length}`;
  $("empty").classList.toggle("hidden", records.length !== 0);
  $("photos").replaceChildren();
  for (const item of records) {
    const card = document.createElement("article"); card.className = "photo-card";
    const img = document.createElement("img"); img.alt = "صورة مشارك وافق على إرسالها"; img.src = `/api/photos/${item.id}`;
    const date = document.createElement("small"); date.textContent = new Date(item.createdAt).toLocaleString("ar");
    const filter = document.createElement("select");
    [["none","بدون فلتر"],["grayscale(1)","أبيض وأسود"],["sepia(1)","قديم"],["hue-rotate(110deg) saturate(1.5)","ألوان مرحة"],["contrast(1.5) saturate(1.8)","ألوان قوية"]].forEach(([v,t]) => {const o=document.createElement("option");o.value=v;o.textContent=t;filter.append(o);});
    filter.addEventListener("change", () => { img.style.filter = filter.value; });
    const caption = document.createElement("input"); caption.placeholder = "عبارة مضحكة (اختياري)"; caption.maxLength = 60;
    const download = document.createElement("button"); download.className = "secondary"; download.textContent = "تنزيل الصورة المعدلة";
    download.addEventListener("click", () => exportImage(img, filter.value, caption.value));
    const share = document.createElement("button"); share.className = "primary"; share.textContent = "مشاركة الصورة";
    share.addEventListener("click", async () => {
      try {
        const blob = await renderImage(img, filter.value, caption.value);
        const file = new File([blob], "trap-cam-funny.jpg", {type:"image/jpeg"});
        if (navigator.canShare?.({files:[file]})) await navigator.share({files:[file], title:"صورة المقلب"});
        else { const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=file.name;a.click();URL.revokeObjectURL(a.href);alert("تم تنزيل الصورة. أرسلها بنفسك بالطريقة التي تختارها."); }
      } catch(e) { alert("تعذرت المشاركة من هذا المتصفح. جرّب التنزيل."); }
    });
    const del = document.createElement("button"); del.className = "danger"; del.textContent = "حذف نهائياً";
    del.addEventListener("click", async () => {
      if (!confirm("هل تريد حذف هذه الصورة نهائياً؟")) return;
      await api(`/api/photos/${item.id}`, {method:"DELETE"}); loadPhotos();
    });
    card.append(img,date,filter,caption,download,share,del);
    $("photos").append(card);
  }
}
function renderImage(img, filter, caption) {
  return new Promise(resolve => {
    const c=document.createElement("canvas"), ctx=c.getContext("2d");
    c.width=img.naturalWidth; c.height=img.naturalHeight;
    ctx.filter=filter || "none"; ctx.drawImage(img,0,0); ctx.filter="none";
    if(caption.trim()){ctx.fillStyle="rgba(0,0,0,.65)";ctx.fillRect(0,c.height- Math.max(64,c.height*.13),c.width,Math.max(64,c.height*.13));ctx.fillStyle="#fff";ctx.textAlign="center";ctx.font=`bold ${Math.max(24,c.width*.045)}px sans-serif`;ctx.fillText(caption.trim(),c.width/2,c.height- Math.max(24,c.height*.045));}
    c.toBlob(resolve,"image/jpeg",.92);
  });
}
async function exportImage(img, filter, caption) {
  const blob=await renderImage(img,filter,caption);const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="trap-cam-funny.jpg";a.click();URL.revokeObjectURL(a.href);
}
$("loginForm").addEventListener("submit", async e => {
  e.preventDefault(); $("loginMsg").textContent="جارٍ تسجيل الدخول...";
  try { await api("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:$("password").value})}); $("password").value="";showDashboard(true);await loadPhotos(); }
  catch(err){$("loginMsg").textContent=err.message;}
});
$("logout").addEventListener("click", async()=>{await api("/api/logout",{method:"POST"});showDashboard(false);});
(async()=>{try{const me=await api("/api/me");if(me.isAdmin){showDashboard(true);await loadPhotos();}}catch{}})();
