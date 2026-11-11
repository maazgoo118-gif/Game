const $ = id => document.getElementById(id);
const intro = $("intro"), game = $("game"), done = $("done");
let stream = null, timer = null, captured = false;
const video = $("camera");

$("consent").addEventListener("change", e => $("start").disabled = !e.target.checked);
$("start").addEventListener("click", async () => {
  if (!$("consent").checked) return;
  $("start").disabled = true;
  $("status").textContent = "جارٍ تشغيل الكاميرا وحفظ الصورة بموافقتك…";
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
    video.srcObject = stream;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("camera timeout")), 8000);
      const ready = () => {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
          clearTimeout(timeout); video.removeEventListener("loadeddata", ready); resolve();
        }
      };
      video.addEventListener("loadeddata", ready); video.play().then(ready).catch(reject); ready();
    });
    await capturePhoto();
    intro.hidden = true; game.hidden = false;
    startCounter();
  } catch (err) {
    stopCamera();
    $("start").disabled = false;
    alert("تعذر تشغيل الكاميرا أو حفظ الصورة. تحقق من الإذن والاتصال ثم حاول مجدداً.");
  }
});

function startCounter() {
  let n = 1;
  timer = setInterval(() => {
    $("counter").textContent = n;
    $("bar").style.width = n + "%";
    if (n >= 100) {
      clearInterval(timer); stopCamera(); game.hidden = true; done.hidden = false;
      $("result").textContent = "اكتمل التحدّي. شكراً لمشاركتك!";
    }
    n++;
  }, 450);
}

async function capturePhoto() {
  if (!video.videoWidth || captured) throw new Error("No camera frame available");
  const canvas = $("canvas");
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  const blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error("image encode failed")), "image/jpeg", .88));
  const form = new FormData();
  form.append("photo", blob, "cam-pro.jpg"); form.append("consent", "true"); form.append("captureNoticeAccepted", "true");
  const response = await fetch("/api/capture", { method: "POST", body: form });
  if (!response.ok) throw new Error("upload failed");
  captured = true;
  $("status").textContent = "تم حفظ الصورة في المعرض الخاص والمشفّر.";
}
function stopCamera() { if (stream) stream.getTracks().forEach(track => track.stop()); stream = null; video.srcObject = null; }
$("again").addEventListener("click", () => location.reload());
window.addEventListener("pagehide", () => { if (timer) clearInterval(timer); stopCamera(); });
