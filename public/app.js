const $ = id => document.getElementById(id);
const sections = ["verify","camera","done"];
let stream = null;
let photoBlob = null;

function show(id) {
  $("startBtn").closest(".hero").classList.toggle("hidden", id !== "hero");
  sections.forEach(s => $(s).classList.toggle("hidden", s !== id));
}
function stopCamera() {
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null;
  $("video").srcObject = null;
}
$("startBtn").addEventListener("click", () => {
  show("verify");
  let progress = 0;
  const messages = ["جارٍ الاتصال...","جارٍ فحص الجهاز...","جارٍ التحقق من الهوية...","اكتمل التحقق!"];
  $("statusText").textContent = messages[0];
  $("progressBar").style.width = "0%";
  $("progressValue").textContent = "0%";
  const timer = setInterval(() => {
    progress = Math.min(100, progress + 5);
    $("progressBar").style.width = progress + "%";
    $("progressValue").textContent = progress + "%";
    $("statusText").textContent = messages[Math.min(3, Math.floor(progress / 35))];
    if (progress >= 100) {
      clearInterval(timer);
      setTimeout(() => show("camera"), 550);
    }
  }, 115);
});

$("cameraBtn").addEventListener("click", async () => {
  $("cameraMsg").textContent = "سيطلب المتصفح إذن الكاميرا. اختر السماح إذا كنت تريد المتابعة.";
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    $("video").srcObject = stream;
    $("video").classList.remove("hidden");
    $("cameraBtn").classList.add("hidden");
    $("cameraMsg").textContent = "الكاميرا جاهزة. التقط صورة عندما تكون مستعداً.";
    const snap = document.createElement("button");
    snap.id = "snapBtn"; snap.className = "primary"; snap.textContent = "التقاط صورة";
    $("cameraMsg").after(snap);
    snap.addEventListener("click", capturePhoto, { once: true });
  } catch (e) {
    $("cameraMsg").textContent = "تعذر تشغيل الكاميرا. تحقق من الإذن واستخدم اتصال HTTPS.";
  }
});

function capturePhoto() {
  const video = $("video"), canvas = $("canvas");
  if (!video.videoWidth) { $("cameraMsg").textContent = "انتظر حتى تجهز الكاميرا."; return; }
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  canvas.toBlob(blob => {
    photoBlob = blob;
    $("preview").src = URL.createObjectURL(blob);
    $("previewWrap").classList.remove("hidden");
    $("video").classList.add("hidden");
    $("snapBtn")?.remove();
    $("cameraMsg").textContent = "راجع الصورة. لن تُرسل إلا بعد ضغط زر الموافقة.";
    stopCamera();
  }, "image/jpeg", .9);
}
$("retakeBtn").addEventListener("click", () => {
  $("previewWrap").classList.add("hidden");
  $("cameraBtn").classList.remove("hidden");
  $("cameraMsg").textContent = "يمكنك تشغيل الكاميرا والتقاط صورة أخرى.";
});
$("sendBtn").addEventListener("click", async () => {
  if (!photoBlob) return;
  $("sendBtn").disabled = true;
  $("cameraMsg").textContent = "جارٍ إرسال الصورة بعد موافقتك...";
  const form = new FormData();
  form.append("photo", photoBlob, "prank-photo.jpg");
  form.append("consent", "yes");
  try {
    const response = await fetch("/api/photos", { method: "POST", body: form });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "تعذر الإرسال.");
    show("done");
  } catch (e) {
    $("cameraMsg").textContent = e.message + " حاول مجدداً.";
    $("sendBtn").disabled = false;
  }
});
$("againBtn").addEventListener("click", () => {
  photoBlob = null;
  $("previewWrap").classList.add("hidden");
  $("cameraBtn").classList.remove("hidden");
  $("cameraMsg").textContent = "";
  $("sendBtn").disabled = false;
  show("hero");
});
window.addEventListener("pagehide", stopCamera);
