const $ = id => document.getElementById(id);

let records = [];

async function api(url, options = {}) {
  const r = await fetch(url, {
    credentials: "same-origin",
    ...options
  });

  const data = r.headers.get("content-type")?.includes("application/json")
    ? await r.json()
    : null;

  if (!r.ok) throw new Error(data?.error || "حدث خطأ.");
  return data;
}

function showDashboard(on) {
  $("loginPanel").classList.toggle("hidden", on);
  $("dashboard").classList.toggle("hidden", !on);
}

async function loadPhotos() {
  records = await api("/api/admin/photos");

  $("count").textContent = `عدد الصور: ${records.length}`;
  $("empty").classList.toggle("hidden", records.length !== 0);
  $("photos").replaceChildren();

  for (const item of records) {
    const card = document.createElement("article");
    card.className = "photo-card";

    const img = document.createElement("img");
    img.alt = "صورة مشارك وافق على التقاطها";
    img.src = `/api/admin/photos/${item.id}`;

    const date = document.createElement("small");
    date.textContent = new Date(item.createdAt).toLocaleString("ar");

    const filter = document.createElement("select");

    [
      ["none", "بدون فلتر"],
      ["grayscale(1)", "أبيض وأسود"],
      ["sepia(1)", "قديم"],
      ["hue-rotate(110deg) saturate(1.5)", "ألوان مرحة"],
      ["contrast(1.5) saturate(1.8)", "ألوان قوية"]
    ].forEach(([v, t]) => {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = t;
      filter.append(o);
    });

    filter.addEventListener("change", () => {
      img.style.filter = filter.value;
    });

    const caption = document.createElement("input");
    caption.placeholder = "عبارة مضحكة (اختياري)";
    caption.maxLength = 60;

    const download = document.createElement("button");
    download.className = "secondary";
    download.textContent = "تنزيل الصورة المعدلة";

    download.addEventListener("click", async () => {
      try {
        await waitImage(img);
        const blob = await renderImage(img, filter.value, caption.value);
        downloadBlob(blob);
      } catch {
        alert("تعذر تجهيز الصورة.");
      }
    });

    const share = document.createElement("button");
    share.className = "primary";
    share.textContent = "مشاركة الصورة";

    share.addEventListener("click", async () => {
      try {
        await waitImage(img);
        const blob = await renderImage(img, filter.value, caption.value);
        const file = new File([blob], "cam-pro-funny.jpg", {
          type: "image/jpeg"
        });

        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: "صورة CAM PRO" });
        } else {
          downloadBlob(blob);
          alert("تم تنزيل الصورة. يمكنك إرسالها بنفسك.");
        }
      } catch {
        alert("تعذرت المشاركة أو تجهيز الصورة.");
      }
    });

    const del = document.createElement("button");
    del.className = "danger";
    del.textContent = "حذف نهائياً";

    del.addEventListener("click", async () => {
      if (!confirm("هل تريد حذف هذه الصورة نهائياً؟")) return;

      try {
        await api(`/api/admin/photos/${item.id}`, {
          method: "DELETE"
        });
        await loadPhotos();
      } catch (e) {
        alert(e.message);
      }
    });

    card.append(img, date, filter, caption, download, share, del);
    $("photos").append(card);
  }
}

function waitImage(img) {
  if (img.complete && img.naturalWidth > 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
  });
}

function renderImage(img, filter, caption) {
  return new Promise((resolve, reject) => {
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d");

    c.width = img.naturalWidth;
    c.height = img.naturalHeight;

    ctx.filter = filter || "none";
    ctx
