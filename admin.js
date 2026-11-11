const $=id=>document.getElementById(id);
async function api(url,opts={}){
  const headers={...(opts.headers||{})};
  if(opts.body && !(opts.body instanceof FormData)) headers["Content-Type"]="application/json";
  const r=await fetch(url,{...opts,headers,credentials:"same-origin",cache:"no-store"});
  if(!r.ok)throw new Error("تعذر تنفيذ الطلب");
  return r.status===204?null:r.json();
}
$("loginBtn").onclick=async()=>{try{await api("/api/admin/login",{method:"POST",body:JSON.stringify({password:$("password").value})});$("password").value="";$("login").hidden=true;$("panel").hidden=false;await load();}catch{$("msg").textContent="كلمة المرور غير صحيحة أو تعذر الدخول.";}};
async function load(){
  const items=await api("/api/admin/photos");$("photos").replaceChildren();
  if(!items.length){$("photos").textContent="لا توجد صور بعد.";return;}
  for(const p of items){
    const box=document.createElement("div");box.style.cssText="background:#11182c;padding:14px;border-radius:14px;margin-top:14px";
    const img=document.createElement("img");img.src="/api/admin/photos/"+encodeURIComponent(p.id);img.alt="صورة محفوظة";img.style.cssText="width:100%;border-radius:10px";
    const date=document.createElement("p");date.textContent=new Date(p.createdAt).toLocaleString("ar");
    const share=document.createElement("button");share.textContent="مشاركة الصورة يدوياً";share.onclick=async()=>{try{const blob=await (await fetch(img.src,{credentials:"same-origin",cache:"no-store"})).blob();const file=new File([blob],"cam-pro.jpg",{type:"image/jpeg"});if(navigator.canShare&&navigator.canShare({files:[file]}))await navigator.share({files:[file],title:"CAM PRO"});else{const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="cam-pro.jpg";a.click();URL.revokeObjectURL(a.href);}}catch{alert("تعذرت مشاركة الصورة.");}};
    const del=document.createElement("button");del.textContent="حذف الصورة";del.style.marginTop="8px";del.onclick=async()=>{if(confirm("هل تريد حذف هذه الصورة نهائياً؟")){await fetch("/api/admin/photos/"+encodeURIComponent(p.id),{method:"DELETE",credentials:"same-origin"});await load();}};
    box.append(img,date,share,del);$("photos").append(box);
  }
}
$("logout").onclick=async()=>{await fetch("/api/admin/logout",{method:"POST",credentials:"same-origin"});location.reload();};
