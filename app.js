// =========================================================
//  TOKO RACHMAD - app.js
//  Firebase Firestore + BarcodeDetector / ZXing fallback
// =========================================================

import { initializeApp }        from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, collection, doc, getDocs, addDoc,
         setDoc, updateDoc, deleteDoc, onSnapshot,
         serverTimestamp, query, orderBy }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import firebaseConfig from "./firebase-config.js";

// ─────────── Init Firebase ───────────
const firebaseApp = initializeApp(firebaseConfig);
const db          = getFirestore(firebaseApp);

// ─────────── State ───────────
let cart      = [];   // [{id, barcode, nama, harga, qty}]
let products  = {};   // { barcode: {id, nama, harga, stok} }
let riwayat   = [];   // [{id, items, total, uangDiterima, kembalian, timestamp}]
let adminPass = localStorage.getItem("adminPass") || "1234";

// pendingPasswordAction: { action, param }
let pendingPasswordAction = null;

// ─────────── DOM refs ───────────
const connectionStatus = document.getElementById("connectionStatus");
const cartList    = document.getElementById("cartList");
const cartEmpty   = document.getElementById("cartEmpty");
const cartCount   = document.getElementById("cartCount");
const cartTotal   = document.getElementById("cartTotal");
const produkList  = document.getElementById("produkList");
const riwayatList = document.getElementById("riwayatList");
const toast       = document.getElementById("toast");

// =====================================================
//  FIREBASE LISTENERS
// =====================================================
function initFirebase() {
  try {
    // Products
    onSnapshot(collection(db, "products"), (snap) => {
      products = {};
      snap.forEach(d => { products[d.data().barcode] = { id: d.id, ...d.data() }; });
      renderProdukList();
      cekStokMenipis();
      connectionStatus.textContent  = "Terhubung ✓";
      connectionStatus.className    = "store-status connected";
    });

    // Riwayat
    const riwQ = query(collection(db, "transactions"), orderBy("timestamp", "desc"));
    onSnapshot(riwQ, (snap) => {
      riwayat = [];
      snap.forEach(d => riwayat.push({ id: d.id, ...d.data() }));
      renderRiwayat();
    });

    // Settings (password stored in Firestore so it syncs)
    const settingsRef = doc(db, "settings", "admin");
    onSnapshot(settingsRef, (snap) => {
      if (snap.exists() && snap.data().password) {
        adminPass = snap.data().password;
        localStorage.setItem("adminPass", adminPass);
      }
    });

  } catch (e) {
    connectionStatus.textContent = "Gagal terhubung";
    connectionStatus.className   = "store-status error";
    showToast("⚠️ Database belum dikonfigurasi. Lihat firebase-config.js", "error");
    console.error("Firebase error:", e);
  }
}
initFirebase();

// =====================================================
//  TABS
// =====================================================
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.tab;
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + target).classList.add("active");
    if (target === "riwayat") renderRiwayat();
  });
});

// =====================================================
//  KASIR - CART LOGIC
// =====================================================
const kasirInput = document.getElementById("kasirScanInput");
document.getElementById("btnKasirScan").addEventListener("click", addToCartByInput);
kasirInput.addEventListener("keydown", e => { if (e.key === "Enter") addToCartByInput(); });

function addToCartByInput() {
  const barcode = kasirInput.value.trim();
  if (!barcode) return;
  kasirInput.value = "";
  kasirInput.focus();
  addToCart(barcode);
}

function addToCart(barcode) {
  const product = products[barcode];
  if (!product) {
    showToast("❌ Produk tidak ditemukan: " + barcode, "error");
    return;
  }
  const existing = cart.find(i => i.barcode === barcode);
  if (existing) {
    existing.qty++;
    showToast("✓ " + product.nama + " +" + existing.qty, "success");
  } else {
    cart.push({ barcode, nama: product.nama, harga: product.harga, qty: 1 });
    showToast("✓ " + product.nama + " ditambahkan", "success");
  }
  renderCart();
}

function renderCart() {
  const total = cart.reduce((s, i) => s + i.harga * i.qty, 0);
  cartCount.textContent = cart.reduce((s, i) => s + i.qty, 0) + " item";
  cartTotal.textContent = formatRp(total);

  if (cart.length === 0) {
    cartList.innerHTML = "";
    cartList.appendChild(cartEmpty);
    cartEmpty.style.display = "flex";
    return;
  }
  cartEmpty.style.display = "none";

  cartList.innerHTML = "";
  cart.forEach((item, idx) => {
    const div = document.createElement("div");
    div.className = "cart-item";
    div.innerHTML = `
      <div class="cart-item-info">
        <div class="cart-item-name">${escHtml(item.nama)}</div>
        <div class="cart-item-price">${formatRp(item.harga)} / pcs</div>
      </div>
      <div class="cart-qty-ctrl">
        <button class="qty-btn minus" data-idx="${idx}" data-action="minus">−</button>
        <span class="qty-num">${item.qty}</span>
        <button class="qty-btn" data-idx="${idx}" data-action="plus">+</button>
      </div>
      <div class="cart-item-subtotal">${formatRp(item.harga * item.qty)}</div>
      <button class="btn-remove-item" data-idx="${idx}" data-action="remove">🗑</button>
    `;
    cartList.appendChild(div);
  });
}

cartList.addEventListener("click", e => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const idx    = parseInt(btn.dataset.idx);
  const action = btn.dataset.action;
  if (action === "plus")   { cart[idx].qty++; renderCart(); }
  if (action === "minus")  { cart[idx].qty--; if (cart[idx].qty <= 0) cart.splice(idx, 1); renderCart(); }
  if (action === "remove") { cart.splice(idx, 1); renderCart(); }
});

document.getElementById("btnClearCart").addEventListener("click", () => {
  if (cart.length === 0) return;
  cart = [];
  renderCart();
  showToast("Keranjang dikosongkan");
});

// =====================================================
//  BAYAR MODAL
// =====================================================
const modalBayar     = document.getElementById("modalBayar");
const uangInput      = document.getElementById("uangDiterima");
const kembalianEl    = document.getElementById("kembalianDisplay");
const kembalianRow   = document.querySelector(".kembalian-row");
const paymentItemsEl = document.getElementById("paymentItems");
const paymentTotalEl = document.getElementById("paymentTotal");

document.getElementById("btnBayar").addEventListener("click", () => {
  if (cart.length === 0) { showToast("Keranjang masih kosong", "warn"); return; }
  uangInput.value = "";
  kembalianEl.textContent = "Rp 0";
  kembalianRow.classList.remove("kurang");

  const total = cart.reduce((s, i) => s + i.harga * i.qty, 0);
  paymentTotalEl.textContent = formatRp(total);
  paymentItemsEl.innerHTML = cart.map(i =>
    `<div class="payment-item-row"><span>${escHtml(i.nama)} x${i.qty}</span><span>${formatRp(i.harga * i.qty)}</span></div>`
  ).join("");

  openModal(modalBayar);
  uangInput.focus();
});

document.getElementById("btnCloseBayar").addEventListener("click", () => closeModal(modalBayar));

uangInput.addEventListener("input", updateKembalian);

function updateKembalian() {
  const total   = cart.reduce((s, i) => s + i.harga * i.qty, 0);
  const diterima = parseInt(uangInput.value) || 0;
  const kembalian = diterima - total;
  kembalianEl.textContent = formatRp(Math.abs(kembalian));
  if (kembalian < 0) {
    kembalianEl.textContent = "−" + formatRp(Math.abs(kembalian));
    kembalianRow.classList.add("kurang");
  } else {
    kembalianRow.classList.remove("kurang");
  }
  document.getElementById("btnKonfirmasiBayar").disabled = (diterima < total);
}

// Calculator buttons
document.querySelector(".calc-grid").addEventListener("click", e => {
  const btn = e.target.closest(".calc-btn");
  if (!btn) return;
  const val = btn.dataset.val;
  if (val === "del") {
    uangInput.value = uangInput.value.slice(0, -1);
  } else {
    uangInput.value = (uangInput.value || "") + val;
  }
  updateKembalian();
});

document.getElementById("btnKonfirmasiBayar").addEventListener("click", async () => {
  const total    = cart.reduce((s, i) => s + i.harga * i.qty, 0);
  const diterima = parseInt(uangInput.value) || 0;
  const kembalian = diterima - total;
  if (diterima < total) return;

  const itemsSnapshot = cart.map(i => ({ nama: i.nama, barcode: i.barcode, harga: i.harga, qty: i.qty }));
  const transaksi = {
    items: itemsSnapshot,
    total, uangDiterima: diterima, kembalian,
    timestamp: serverTimestamp()
  };

  try {
    await addDoc(collection(db, "transactions"), transaksi);

    // Kurangi stok otomatis
    for (const item of cart) {
      const p = products[item.barcode];
      if (p && p.stok > 0) {
        const newStok = Math.max(0, p.stok - item.qty);
        await updateDoc(doc(db, "products", item.barcode), { stok: newStok });
      }
    }

    closeModal(modalBayar);

    // Tampilkan sukses + struk
    document.getElementById("suksesTotal").textContent     = formatRp(total);
    document.getElementById("suksesDiterima").textContent  = formatRp(diterima);
    document.getElementById("suksesKembalian").textContent = formatRp(kembalian);
    renderStruk(itemsSnapshot, total, diterima, kembalian);
    openModal(document.getElementById("modalSukses"), true);

    cart = [];
    renderCart();

    // Cek stok menipis
    setTimeout(cekStokMenipis, 1500);
  } catch (e) {
    showToast("Gagal menyimpan transaksi", "error");
    console.error(e);
  }
});

document.getElementById("btnTutupSukses").addEventListener("click", () => {
  closeModal(document.getElementById("modalSukses"));
});

// Struk
function renderStruk(items, total, diterima, kembalian) {
  const now = new Date();
  const tgl = formatDate(now);
  let html = `<div class="struk-header">🛒 Toko Rachmad</div>`;
  html += `<hr class="struk-divider">`;
  html += `<div style="font-size:11px;color:#666;text-align:center;margin-bottom:4px">${tgl}</div>`;
  html += `<hr class="struk-divider">`;
  items.forEach(i => {
    html += `<div class="struk-row"><span>${escHtml(i.nama)} x${i.qty}</span><span>${formatRp(i.harga * i.qty)}</span></div>`;
  });
  html += `<hr class="struk-divider">`;
  html += `<div class="struk-row"><span><b>Total</b></span><span><b>${formatRp(total)}</b></span></div>`;
  html += `<div class="struk-row"><span>Bayar</span><span>${formatRp(diterima)}</span></div>`;
  html += `<div class="struk-row"><span>Kembalian</span><span>${formatRp(kembalian)}</span></div>`;
  html += `<hr class="struk-divider">`;
  html += `<div class="struk-footer">Terima kasih! 🙏</div>`;
  document.getElementById("strukArea").innerHTML = html;
}

document.getElementById("btnPrintStruk").addEventListener("click", () => {
  const isi = document.getElementById("strukArea").innerHTML;
  const w = window.open("", "_blank", "width=400,height=600");
  w.document.write(`<html><head><title>Struk - Toko Rachmad</title>
  <style>body{font-family:monospace;font-size:13px;padding:16px;max-width:300px;margin:auto}
  .struk-row{display:flex;justify-content:space-between}.struk-header{text-align:center;font-weight:700;font-size:15px}
  .struk-footer{text-align:center;font-size:11px;color:#666}.struk-divider{border:none;border-top:1px dashed #ccc;margin:6px 0}
  </style></head><body>${isi}</body></html>`);
  w.document.close();
  w.print();
});

// =====================================================
//  PRODUK TAB
// =====================================================
const produkSearch = document.getElementById("produkSearch");
produkSearch.addEventListener("input", renderProdukList);

function renderProdukList() {
  const q = produkSearch.value.toLowerCase();
  const items = Object.values(products).filter(p =>
    p.nama.toLowerCase().includes(q) || p.barcode.includes(q)
  );

  if (items.length === 0) {
    produkList.innerHTML = `<div class="empty-state">📦 Belum ada produk terdaftar</div>`;
    return;
  }

  produkList.innerHTML = "";
  items.sort((a, b) => a.nama.localeCompare(b.nama)).forEach(p => {
    const div = document.createElement("div");
    div.className = "produk-item";
    const stokClass = p.stok < 5 ? "low" : "";
    div.innerHTML = `
      <div class="produk-item-info">
        <div class="produk-item-name">${escHtml(p.nama)}</div>
        <div class="produk-item-barcode">${p.barcode}</div>
        <div class="produk-item-price">${formatRp(p.harga)}</div>
      </div>
      <span class="produk-stok-badge ${stokClass}">Stok: ${p.stok}</span>
      <div class="produk-actions">
        <button class="btn-edit-produk" data-barcode="${p.barcode}">✏️</button>
        <button class="btn-hapus-produk" data-barcode="${p.barcode}" data-nama="${escHtml(p.nama)}">🗑</button>
      </div>
    `;
    produkList.appendChild(div);
  });
}

produkList.addEventListener("click", e => {
  const editBtn  = e.target.closest(".btn-edit-produk");
  const hapusBtn = e.target.closest(".btn-hapus-produk");
  if (editBtn) openEditProduk(editBtn.dataset.barcode);
  if (hapusBtn) {
    const barcode = hapusBtn.dataset.barcode;
    const nama    = hapusBtn.dataset.nama;
    askPassword("Hapus produk: " + nama + "?", () => hapusProduk(barcode));
  }
});

// Add product
document.getElementById("btnTambahProduk").addEventListener("click", async () => {
  const barcode = document.getElementById("produkBarcode").value.trim();
  const nama    = document.getElementById("produkNama").value.trim();
  const harga   = parseInt(document.getElementById("produkHarga").value) || 0;
  const stok    = parseInt(document.getElementById("produkStok").value) || 0;

  if (!barcode) { showToast("Barcode wajib diisi", "warn"); return; }
  if (!nama)    { showToast("Nama produk wajib diisi", "warn"); return; }
  if (harga <= 0) { showToast("Harga harus lebih dari 0", "warn"); return; }
  if (products[barcode]) { showToast("Barcode sudah terdaftar", "warn"); return; }

  try {
    await setDoc(doc(db, "products", barcode), { barcode, nama, harga, stok, createdAt: serverTimestamp() });
    showToast("✓ Produk berhasil ditambahkan", "success");
    document.getElementById("produkBarcode").value = "";
    document.getElementById("produkNama").value    = "";
    document.getElementById("produkHarga").value   = "";
    document.getElementById("produkStok").value    = "";
  } catch (err) {
    showToast("Gagal tambah produk. Cek Firestore Rules!", "error");
    console.error(err);
  }
});

// Edit product
function openEditProduk(barcode) {
  const p = products[barcode];
  if (!p) return;
  document.getElementById("editProdukId").value = barcode;
  document.getElementById("editBarcode").value  = p.barcode;
  document.getElementById("editNama").value     = p.nama;
  document.getElementById("editHarga").value    = p.harga;
  document.getElementById("editStok").value     = p.stok;
  openModal(document.getElementById("modalEditProduk"));
}
document.getElementById("btnCloseEdit").addEventListener("click", () => closeModal(document.getElementById("modalEditProduk")));

document.getElementById("btnSimpanEdit").addEventListener("click", async () => {
  const barcode = document.getElementById("editProdukId").value;
  const nama    = document.getElementById("editNama").value.trim();
  const harga   = parseInt(document.getElementById("editHarga").value) || 0;
  const stok    = parseInt(document.getElementById("editStok").value) || 0;

  if (!nama)    { showToast("Nama tidak boleh kosong", "warn"); return; }
  if (harga <= 0) { showToast("Harga harus lebih dari 0", "warn"); return; }

  try {
    await updateDoc(doc(db, "products", barcode), { nama, harga, stok });
    showToast("✓ Produk diperbarui", "success");
    closeModal(document.getElementById("modalEditProduk"));
  } catch (err) {
    showToast("Gagal update produk", "error");
    console.error(err);
  }
});

async function hapusProduk(barcode) {
  try {
    await deleteDoc(doc(db, "products", barcode));
    showToast("Produk dihapus", "success");
  } catch (err) {
    showToast("Gagal hapus produk", "error");
    console.error(err);
  }
}

// =====================================================
//  RIWAYAT TAB
// =====================================================
let filterAktif = "hari";

document.querySelectorAll(".filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    filterAktif = btn.dataset.filter;
    renderRiwayat();
  });
});

function filterRiwayat() {
  const now = new Date();
  return riwayat.filter(t => {
    const tgl = t.timestamp?.toDate ? t.timestamp.toDate() : new Date();
    if (filterAktif === "hari") {
      return tgl.toDateString() === now.toDateString();
    } else if (filterAktif === "minggu") {
      const diff = (now - tgl) / (1000 * 60 * 60 * 24);
      return diff <= 7;
    } else if (filterAktif === "bulan") {
      return tgl.getMonth() === now.getMonth() && tgl.getFullYear() === now.getFullYear();
    }
    return true;
  });
}

function renderRiwayat() {
  const filtered = filterRiwayat();
  const totalAmt = filtered.reduce((s, t) => s + (t.total || 0), 0);
  document.getElementById("totalTransaksi").textContent  = filtered.length;
  document.getElementById("totalPendapatan").textContent = formatRp(totalAmt);

  if (filtered.length === 0) {
    riwayatList.innerHTML = `<div class="empty-state">📋 Tidak ada transaksi</div>`;
    return;
  }

  riwayatList.innerHTML = "";
  filtered.forEach(t => {
    const div = document.createElement("div");
    div.className = "riwayat-item";
    const tgl = t.timestamp?.toDate ? t.timestamp.toDate() : new Date();
    const produkStr = (t.items || []).map(i => `${i.nama} x${i.qty}`).join(", ");
    div.innerHTML = `
      <div class="riwayat-item-header">
        <span class="riwayat-item-date">${formatDate(tgl)}</span>
        <span class="riwayat-item-total">${formatRp(t.total)}</span>
      </div>
      <div class="riwayat-item-products">${escHtml(produkStr)}</div>
      <div class="riwayat-item-footer">
        <span class="riwayat-kembalian">Kembalian: ${formatRp(t.kembalian)}</span>
        <button class="btn-hapus-transaksi" data-id="${t.id}">🗑</button>
      </div>
    `;
    riwayatList.appendChild(div);
  });
}

riwayatList.addEventListener("click", e => {
  const btn = e.target.closest(".btn-hapus-transaksi");
  if (!btn) return;
  const id = btn.dataset.id;
  askPassword("Hapus transaksi ini?", () => hapusTransaksi(id));
});

document.getElementById("btnHapusSemua").addEventListener("click", () => {
  if (riwayat.length === 0) { showToast("Tidak ada transaksi", "warn"); return; }
  askPassword("Hapus SEMUA riwayat transaksi?", hapusSemua);
});

async function hapusTransaksi(id) {
  try {
    await deleteDoc(doc(db, "transactions", id));
    showToast("Transaksi dihapus", "success");
  } catch (e) {
    showToast("Gagal hapus transaksi", "error");
    console.error(e);
  }
}

async function hapusSemua() {
  try {
    const snap = await getDocs(collection(db, "transactions"));
    const promises = snap.docs.map(d => deleteDoc(doc(db, "transactions", d.id)));
    await Promise.all(promises);
    showToast("Semua riwayat dihapus", "success");
  } catch (e) {
    showToast("Gagal hapus semua transaksi", "error");
    console.error(e);
  }
}

// =====================================================
//  LAPORAN
// =====================================================
document.getElementById("btnLaporan").addEventListener("click", () => {
  const filtered = filterRiwayat();
  const total = filtered.reduce((s, t) => s + (t.total || 0), 0);
  const jumlah = filtered.length;

  // Produk terlaris
  const produkMap = {};
  filtered.forEach(t => {
    (t.items || []).forEach(i => {
      if (!produkMap[i.nama]) produkMap[i.nama] = { qty: 0, total: 0 };
      produkMap[i.nama].qty   += i.qty;
      produkMap[i.nama].total += i.harga * i.qty;
    });
  });
  const terlaris = Object.entries(produkMap).sort((a, b) => b[1].qty - a[1].qty).slice(0, 5);

  const labelFilter = { hari: "Hari Ini", minggu: "Minggu Ini", bulan: "Bulan Ini", semua: "Semua Waktu" };
  let html = `
    <div class="laporan-section">
      <h4>📅 Periode: ${labelFilter[filterAktif]}</h4>
      <div class="laporan-stat-grid">
        <div class="laporan-stat">
          <span class="laporan-stat-num">${jumlah}</span>
          <span class="laporan-stat-label">Transaksi</span>
        </div>
        <div class="laporan-stat">
          <span class="laporan-stat-num">${formatRp(total)}</span>
          <span class="laporan-stat-label">Pendapatan</span>
        </div>
        <div class="laporan-stat">
          <span class="laporan-stat-num">${jumlah > 0 ? formatRp(Math.round(total/jumlah)) : "Rp 0"}</span>
          <span class="laporan-stat-label">Rata-rata/Transaksi</span>
        </div>
        <div class="laporan-stat">
          <span class="laporan-stat-num">${Object.keys(produkMap).length}</span>
          <span class="laporan-stat-label">Jenis Produk Terjual</span>
        </div>
      </div>
    </div>`;

  if (terlaris.length > 0) {
    html += `<div class="laporan-section"><h4>🏆 Produk Terlaris</h4>`;
    terlaris.forEach(([nama, data]) => {
      html += `<div class="laporan-produk-row"><span>${escHtml(nama)} (${data.qty} pcs)</span><span>${formatRp(data.total)}</span></div>`;
    });
    html += `</div>`;
  } else {
    html += `<div class="empty-state">Belum ada data penjualan</div>`;
  }

  document.getElementById("laporanBody").innerHTML = html;
  openModal(document.getElementById("modalLaporan"));
});
document.getElementById("btnCloseLaporan").addEventListener("click", () => closeModal(document.getElementById("modalLaporan")));

// =====================================================
//  STOK MENIPIS
// =====================================================
function cekStokMenipis() {
  const menipis = Object.values(products).filter(p => p.stok <= 5);

  // Badge di tab Produk
  const tabProduk = document.querySelector('.tab-btn[data-tab="produk"]');
  const existingBadge = tabProduk.querySelector(".stok-alert-badge");
  if (existingBadge) existingBadge.remove();
  if (menipis.length > 0) {
    const badge = document.createElement("div");
    badge.className = "stok-alert-badge";
    badge.textContent = menipis.length;
    tabProduk.appendChild(badge);
  }
}

document.getElementById("btnCloseStok").addEventListener("click", () => closeModal(document.getElementById("modalStok")));

// =====================================================
//  PASSWORD MODAL
// =====================================================
const modalPassword = document.getElementById("modalPassword");
const passwordInput = document.getElementById("passwordInput");

function askPassword(desc, onSuccess) {
  pendingPasswordAction = onSuccess;
  document.getElementById("passwordDesc").textContent = desc;
  passwordInput.value = "";
  openModal(modalPassword, true);
  setTimeout(() => passwordInput.focus(), 200);
}

document.getElementById("btnClosePassword").addEventListener("click", () => {
  closeModal(modalPassword);
  pendingPasswordAction = null;
});

document.getElementById("btnVerifikasi").addEventListener("click", verifyPassword);
passwordInput.addEventListener("keydown", e => { if (e.key === "Enter") verifyPassword(); });

function verifyPassword() {
  if (passwordInput.value === adminPass) {
    closeModal(modalPassword);
    if (pendingPasswordAction) {
      pendingPasswordAction();
      pendingPasswordAction = null;
    }
  } else {
    showToast("Password salah!", "error");
    passwordInput.value = "";
    passwordInput.focus();
  }
}

// =====================================================
//  SETTINGS MODAL
// =====================================================
document.getElementById("btnOpenSettings").addEventListener("click", () => {
  document.getElementById("oldPassword").value     = "";
  document.getElementById("newPassword").value     = "";
  document.getElementById("confirmPassword").value = "";
  openModal(document.getElementById("modalSettings"));
});
document.getElementById("btnCloseSettings").addEventListener("click", () => closeModal(document.getElementById("modalSettings")));

document.getElementById("btnSimpanPassword").addEventListener("click", async () => {
  const oldP  = document.getElementById("oldPassword").value;
  const newP  = document.getElementById("newPassword").value;
  const confP = document.getElementById("confirmPassword").value;

  if (oldP !== adminPass) { showToast("Password lama salah", "error"); return; }
  if (!newP)              { showToast("Password baru tidak boleh kosong", "warn"); return; }
  if (newP !== confP)     { showToast("Konfirmasi password tidak cocok", "warn"); return; }
  if (newP.length < 4)    { showToast("Password minimal 4 karakter", "warn"); return; }

  try {
    await setDoc(doc(db, "settings", "admin"), { password: newP }, { merge: true });
    adminPass = newP;
    localStorage.setItem("adminPass", newP);
    showToast("✓ Password berhasil diubah", "success");
    closeModal(document.getElementById("modalSettings"));
  } catch (e) {
    showToast("Gagal simpan password", "error");
    console.error(e);
  }
});

// =====================================================
//  BARCODE SCANNER
// =====================================================
const scannerOverlay = document.getElementById("scannerOverlay");
const scannerVideo   = document.getElementById("scannerVideo");
let scannerStream    = null;
let scannerTarget    = null; // "kasir" | "produk"

document.getElementById("btnScanProduk").addEventListener("click", () => {
  scannerTarget = "produk";
  startScanner();
});

document.getElementById("btnKasirKamera").addEventListener("click", () => { scannerTarget = "kasir"; startScanner(); });
document.getElementById("btnCloseScanner").addEventListener("click", stopScanner);

async function startScanner() {
  try {
    scannerStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 } }
    });
    scannerVideo.srcObject = scannerStream;
    scannerOverlay.classList.add("open");
    scanBarcode();
  } catch (err) {
    showToast("Kamera tidak dapat diakses", "error");
    console.error(err);
  }
}

function stopScanner() {
  if (scannerStream) {
    scannerStream.getTracks().forEach(t => t.stop());
    scannerStream = null;
  }
  scannerVideo.srcObject = null;
  scannerOverlay.classList.remove("open");
}

async function scanBarcode() {
  if (!("BarcodeDetector" in window)) {
    showToast("Browser tidak mendukung scanner. Ketik barcode manual.", "warn");
    stopScanner();
    return;
  }

  const detector = new BarcodeDetector({ formats: ["ean_13", "ean_8", "code_128", "code_39", "qr_code", "upc_a", "upc_e"] });

  const detect = async () => {
    if (!scannerStream) return;
    try {
      const barcodes = await detector.detect(scannerVideo);
      if (barcodes.length > 0) {
        const code = barcodes[0].rawValue;
        stopScanner();
        if (scannerTarget === "produk") {
          document.getElementById("produkBarcode").value = code;
          document.getElementById("produkNama").focus();
        } else {
          addToCart(code);
        }
        showToast("✓ Barcode: " + code, "success");
        return;
      }
    } catch (e) { /* continue */ }
    requestAnimationFrame(detect);
  };
  requestAnimationFrame(detect);
}

// =====================================================
//  MODAL HELPERS
// =====================================================
function openModal(modal, center = false) {
  modal.classList.add("open");
  if (center) modal.classList.add("center");
}
function closeModal(modal) {
  modal.classList.remove("open", "center");
}

// Close on overlay click
document.querySelectorAll(".modal-overlay").forEach(overlay => {
  overlay.addEventListener("click", e => {
    if (e.target === overlay) closeModal(overlay);
  });
});

// =====================================================
//  TOAST
// =====================================================
let toastTimer;
function showToast(msg, type = "") {
  clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.className   = "toast show " + type;
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}

// =====================================================
//  UTILS
// =====================================================
function formatRp(num) {
  return "Rp " + (num || 0).toLocaleString("id-ID");
}

function formatDate(d) {
  if (!(d instanceof Date) || isNaN(d)) return "-";
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })
    + " " + d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

function escHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
