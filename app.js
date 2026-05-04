// ============================================================
//  TOKO RACHMAD — app.js
// ============================================================

// ── DATABASE ─────────────────────────────────────────────────
const DB = {
  // Products
  getProducts()          { return JSON.parse(localStorage.getItem('tr_products')     || '[]'); },
  saveProducts(data)     { localStorage.setItem('tr_products',     JSON.stringify(data)); },

  // Transactions
  getTransactions()      { return JSON.parse(localStorage.getItem('tr_transactions') || '[]'); },
  saveTransactions(data) { localStorage.setItem('tr_transactions', JSON.stringify(data)); },

  // Delete password (default: rachmad123)
  getPassword()          { return localStorage.getItem('tr_password') || 'rachmad123'; },
  savePassword(pw)       { localStorage.setItem('tr_password', pw); },
};

// ── STATE ─────────────────────────────────────────────────────
let cart           = [];
let currentProduct = null;
let currentQty     = 1;
let scannerRunning = false;
let html5QrCode    = null;

// ── UTILS ─────────────────────────────────────────────────────
function formatRp(n) {
  return 'Rp ' + Number(n).toLocaleString('id-ID');
}

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className   = 'toast show ' + type;
  setTimeout(() => { t.className = 'toast'; }, 2200);
}

function openModal(id)  { document.getElementById(id).classList.add('show');    }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }

// ── TABS ──────────────────────────────────────────────────────
function switchTab(tab, btn) {
  document.querySelectorAll('.page').forEach(p  => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + tab).classList.add('active');
  btn.classList.add('active');

  if (tab === 'produk')  renderProductList();
  if (tab === 'riwayat') renderRiwayat();
  if (tab !== 'kasir' && scannerRunning) stopScanner();
}

// ── SCANNER ───────────────────────────────────────────────────
function toggleScanner() {
  scannerRunning ? stopScanner() : startScanner();
}

function startScanner() {
  const btn    = document.getElementById('scan-toggle-btn');
  const status = document.getElementById('scan-status');
  btn.textContent = '⏹️ Stop Scanner';
  btn.className   = 'scan-toggle-btn stop';
  status.style.display = 'flex';

  html5QrCode = new Html5Qrcode('reader');
  html5QrCode.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: { width: 200, height: 200 }, aspectRatio: 1 },
    (decoded) => {
      document.getElementById('manual-barcode').value = decoded;
      lookupBarcode(decoded);
      stopScanner();
    },
    () => {} // frame error — silently ignore
  ).catch(() => {
    showToast('❌ Kamera tidak bisa dibuka', 'error');
    resetScannerBtn();
  });

  scannerRunning = true;
}

function stopScanner() {
  if (html5QrCode && scannerRunning) {
    html5QrCode.stop().catch(() => {});
    html5QrCode = null;
  }
  scannerRunning = false;
  resetScannerBtn();
}

function resetScannerBtn() {
  const btn    = document.getElementById('scan-toggle-btn');
  const status = document.getElementById('scan-status');
  btn.textContent  = '📷 Mulai Scan';
  btn.className    = 'scan-toggle-btn start';
  status.style.display = 'none';
}

// ── LOOKUP ────────────────────────────────────────────────────
function lookupBarcode(code) {
  if (!code || !code.trim()) return;
  code = code.trim();

  const found    = DB.getProducts().find(p => p.barcode === code);
  const resultEl = document.getElementById('product-result');
  const notFound = document.getElementById('not-found');

  if (found) {
    currentProduct = found;
    currentQty     = 1;
    document.getElementById('res-name').textContent    = found.name;
    document.getElementById('res-barcode').textContent = '# ' + found.barcode;
    document.getElementById('res-price').textContent   = formatRp(found.price);
    document.getElementById('qty-display').textContent = '1';
    resultEl.classList.add('visible');
    notFound.classList.remove('visible');
    showToast('✅ Produk ditemukan!', 'success');
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } else {
    resultEl.classList.remove('visible');
    notFound.classList.add('visible');
    currentProduct = null;
    showToast('❌ Produk tidak ditemukan', 'error');
  }
}

// Enter key on manual barcode field
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('manual-barcode')
    .addEventListener('keydown', e => {
      if (e.key === 'Enter') lookupBarcode(e.target.value);
    });
});

// ── CART ──────────────────────────────────────────────────────
function changeQty(delta) {
  currentQty = Math.max(1, currentQty + delta);
  document.getElementById('qty-display').textContent = currentQty;
}

function addToCart() {
  if (!currentProduct) return;
  const existing = cart.find(i => i.barcode === currentProduct.barcode);
  if (existing) {
    existing.qty += currentQty;
  } else {
    cart.push({ ...currentProduct, qty: currentQty });
  }
  renderCart();
  document.getElementById('product-result').classList.remove('visible');
  document.getElementById('manual-barcode').value = '';
  currentProduct = null;
  showToast('🛒 Ditambahkan ke keranjang!', 'success');
}

function removeCartItem(barcode) {
  cart = cart.filter(i => i.barcode !== barcode);
  renderCart();
}

function renderCart() {
  const listEl      = document.getElementById('cart-list');
  const emptyEl     = document.getElementById('cart-empty');
  const totalBar    = document.getElementById('total-bar');
  const checkoutBtn = document.getElementById('checkout-btn');
  const totalEl     = document.getElementById('total-amount');

  if (cart.length === 0) {
    listEl.innerHTML          = '';
    emptyEl.style.display     = 'block';
    totalBar.style.display    = 'none';
    checkoutBtn.style.display = 'none';
    return;
  }

  emptyEl.style.display     = 'none';
  totalBar.style.display    = 'flex';
  checkoutBtn.style.display = 'flex';

  let total = 0;
  listEl.innerHTML = cart.map(item => {
    const sub = item.price * item.qty;
    total += sub;
    return `
      <div class="cart-item">
        <div style="flex:1;min-width:0">
          <div class="cart-item-name">${escHtml(item.name)}</div>
          <div class="cart-item-detail">${formatRp(item.price)} × ${item.qty}</div>
        </div>
        <div class="cart-item-total">${formatRp(sub)}</div>
        <button class="cart-item-del" onclick="removeCartItem('${escHtml(item.barcode)}')">🗑️</button>
      </div>`;
  }).join('');

  totalEl.textContent = formatRp(total);
}

function checkout() {
  if (cart.length === 0) return;
  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const trx   = {
    id:    'TRX' + Date.now(),
    date:  new Date().toLocaleString('id-ID'),
    items: cart.map(i => ({ name: i.name, barcode: i.barcode, price: i.price, qty: i.qty })),
    total,
  };

  const transactions = DB.getTransactions();
  transactions.unshift(trx);
  DB.saveTransactions(transactions);

  cart = [];
  renderCart();
  showToast('✅ Transaksi berhasil disimpan!', 'success');
}

// ── PRODUK ────────────────────────────────────────────────────
function renderProductList() {
  const products = DB.getProducts();
  const query    = (document.getElementById('product-search')?.value || '').toLowerCase();
  const listEl   = document.getElementById('product-list');

  const filtered = products.filter(p =>
    p.name.toLowerCase().includes(query) || p.barcode.includes(query)
  );

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="icon">📦</div>
        <p>${products.length === 0 ? 'Belum ada produk terdaftar' : 'Produk tidak ditemukan'}</p>
      </div>`;
    return;
  }

  listEl.innerHTML = filtered.map(p => {
    const realIdx = products.indexOf(p);
    return `
      <div class="product-list-item">
        <div class="pli-icon">🏷️</div>
        <div class="pli-info">
          <div class="pli-name">${escHtml(p.name)}</div>
          <div class="pli-barcode">${escHtml(p.barcode)}</div>
        </div>
        <div class="pli-price">${formatRp(p.price)}</div>
        <div class="pli-actions">
          <button class="icon-btn edit" onclick="openEditProduct(${realIdx})">✏️</button>
          <button class="icon-btn del"  onclick="deleteProduct(${realIdx})">🗑️</button>
        </div>
      </div>`;
  }).join('');
}

function openAddProduct() {
  document.getElementById('modal-produk-title').textContent = 'Tambah Produk';
  document.getElementById('edit-index').value  = '-1';
  document.getElementById('form-nama').value   = '';
  document.getElementById('form-barcode').value = '';
  document.getElementById('form-harga').value  = '';
  openModal('modal-produk');
}

function openEditProduct(idx) {
  const p = DB.getProducts()[idx];
  if (!p) return;
  document.getElementById('modal-produk-title').textContent = 'Edit Produk';
  document.getElementById('edit-index').value   = idx;
  document.getElementById('form-nama').value    = p.name;
  document.getElementById('form-barcode').value = p.barcode;
  document.getElementById('form-harga').value   = p.price;
  openModal('modal-produk');
}

function saveProduct() {
  const name    = document.getElementById('form-nama').value.trim();
  const barcode = document.getElementById('form-barcode').value.trim();
  const price   = parseInt(document.getElementById('form-harga').value, 10);
  const idx     = parseInt(document.getElementById('edit-index').value, 10);

  if (!name || !barcode || isNaN(price) || price < 0) {
    showToast('⚠️ Isi semua field dengan benar!', 'error');
    return;
  }

  const products = DB.getProducts();
  const dupIdx   = products.findIndex(p => p.barcode === barcode);

  if (dupIdx !== -1 && dupIdx !== idx) {
    showToast('⚠️ Barcode sudah dipakai produk lain!', 'error');
    return;
  }

  if (idx === -1) {
    products.push({ name, barcode, price });
    showToast('✅ Produk berhasil ditambahkan!', 'success');
  } else {
    products[idx] = { name, barcode, price };
    showToast('✅ Produk berhasil diperbarui!', 'success');
  }

  DB.saveProducts(products);
  closeModal('modal-produk');
  renderProductList();
}

function deleteProduct(idx) {
  if (!confirm('Hapus produk ini?')) return;
  const products = DB.getProducts();
  products.splice(idx, 1);
  DB.saveProducts(products);
  renderProductList();
  showToast('🗑️ Produk dihapus', '');
}

// ── RIWAYAT ───────────────────────────────────────────────────
function renderRiwayat() {
  const transactions = DB.getTransactions();
  const listEl       = document.getElementById('riwayat-list');
  const totalIncome  = transactions.reduce((s, t) => s + t.total, 0);

  document.getElementById('stat-total-trx').textContent    = transactions.length;
  document.getElementById('stat-total-income').textContent = formatRp(totalIncome);
  document.getElementById('stat-total-income').style.fontSize =
    totalIncome >= 1_000_000 ? '13px' : '15px';

  if (transactions.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="icon">📋</div>
        <p>Belum ada transaksi</p>
      </div>`;
    return;
  }

  listEl.innerHTML = transactions.map(t => `
    <div class="trx-card">
      <div class="trx-header">
        <div>
          <div class="trx-id">${t.id}</div>
          <div class="trx-date">🕐 ${t.date}</div>
        </div>
      </div>
      <div class="trx-items">${t.items.map(i => `${escHtml(i.name)} ×${i.qty}`).join(', ')}</div>
      <div class="trx-footer">
        <div class="trx-total">${formatRp(t.total)}</div>
        <button class="trx-del-btn" onclick="askDeleteTrx('${t.id}')">🔐 Hapus</button>
      </div>
    </div>`).join('');
}

function askDeleteTrx(id) {
  document.getElementById('del-trx-id').value = id;
  document.getElementById('del-password').value = '';
  openModal('modal-del-trx');
}

function confirmDeleteTrx() {
  const pw = document.getElementById('del-password').value;
  if (pw !== DB.getPassword()) {
    showToast('❌ Password salah!', 'error');
    document.getElementById('del-password').value = '';
    return;
  }
  const id = document.getElementById('del-trx-id').value;
  DB.saveTransactions(DB.getTransactions().filter(t => t.id !== id));
  closeModal('modal-del-trx');
  renderRiwayat();
  showToast('🗑️ Transaksi dihapus', '');
}

// ── PASSWORD ─────────────────────────────────────────────────
function openChangePw() {
  document.getElementById('old-pw').value     = '';
  document.getElementById('new-pw').value     = '';
  document.getElementById('confirm-pw').value = '';
  openModal('modal-change-pw');
}

function changePassword() {
  const oldPw     = document.getElementById('old-pw').value;
  const newPw     = document.getElementById('new-pw').value;
  const confirmPw = document.getElementById('confirm-pw').value;

  if (oldPw !== DB.getPassword()) { showToast('❌ Password lama salah!', 'error'); return; }
  if (!newPw || newPw.length < 4) { showToast('⚠️ Password baru minimal 4 karakter', 'error'); return; }
  if (newPw !== confirmPw)         { showToast('⚠️ Konfirmasi tidak cocok', 'error'); return; }

  DB.savePassword(newPw);
  closeModal('modal-change-pw');
  showToast('✅ Password berhasil diganti!', 'success');
}

// ── SECURITY HELPER ───────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── MODAL OVERLAY CLOSE ───────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.classList.remove('show');
    });
  });

  renderCart();
  renderProductList();
});
