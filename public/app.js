// API Base URL
const API_BASE = '/api';

// Ürün verileri
let productsData = [];
let costsData = {};

// Sayfa yüklendiğinde
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    testConnection();
    loadShippingRates();
});

// Navigation
function initNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = item.dataset.page;
            
            // Active class güncelle
            document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            
            // Sayfa göster
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            document.getElementById(`${page}-page`).classList.add('active');
        });
    });
}

// Toast Notification
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icon = type === 'success' ? 'check-circle' : 
                 type === 'error' ? 'times-circle' : 
                 type === 'warning' ? 'exclamation-circle' : 'info-circle';
    
    toast.innerHTML = `<i class="fas fa-${icon}"></i> ${message}`;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// API Bağlantı Testi
async function testConnection() {
    const statusEl = document.getElementById('apiStatus');
    
    try {
        const response = await fetch(`${API_BASE}/trendyol/test`);
        const data = await response.json();
        
        if (data.success) {
            statusEl.className = 'api-status connected';
            statusEl.innerHTML = `<i class="fas fa-circle"></i> <span>Bağlı - ${data.totalProducts} ürün</span>`;
            
            document.getElementById('connectionResult').innerHTML = `
                <div class="status-box profit">
                    <h3><i class="fas fa-check-circle"></i> Bağlantı Başarılı</h3>
                    <p>Satıcı ID: ${data.sellerId}</p>
                    <p>Toplam Ürün: ${data.totalProducts}</p>
                </div>
            `;
        } else {
            throw new Error(data.error);
        }
    } catch (error) {
        statusEl.className = 'api-status disconnected';
        statusEl.innerHTML = `<i class="fas fa-circle"></i> <span>Bağlantı hatası</span>`;
        
        document.getElementById('connectionResult').innerHTML = `
            <div class="status-box loss">
                <h3><i class="fas fa-times-circle"></i> Bağlantı Hatası</h3>
                <p>${error.message}</p>
            </div>
        `;
    }
}

// Kargo ücretlerini yükle
async function loadShippingRates() {
    try {
        const response = await fetch(`${API_BASE}/calculator/shipping-rates`);
        const data = await response.json();
        
        if (data.success) {
            const rates = data.data;
            document.getElementById('shippingRates').innerHTML = `
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Fiyat Aralığı</th>
                            <th>Kargo Ücreti</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rates.shippingRanges.map(r => `
                            <tr>
                                <td>${r.min} - ${r.max === Infinity ? '∞' : r.max} TL</td>
                                <td><span class="badge badge-blue">${r.cost.toFixed(2)} TL</span></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                <p class="info-text">
                    <i class="fas fa-info-circle"></i> 
                    Platform ücreti: <strong>${rates.platformFee.toFixed(2)} TL</strong> (her satışta sabit)
                </p>
            `;
        }
    } catch (error) {
        console.error('Kargo ücretleri yüklenemedi:', error);
    }
}

// Ürünleri çek
async function loadProducts() {
    const tbody = document.getElementById('productsBody');
    tbody.innerHTML = `
        <tr>
            <td colspan="10" class="empty-state">
                <div class="loading"></div>
                <p style="margin-top: 16px;">Ürünler yükleniyor...</p>
            </td>
        </tr>
    `;
    
    try {
        const response = await fetch(`${API_BASE}/trendyol/products`);
        const data = await response.json();
        
        if (data.success) {
            productsData = data.data.products;
            const summary = data.data.summary;
            
            // Dashboard güncelle
            document.getElementById('profitableCount').textContent = summary.profitable;
            document.getElementById('unprofitableCount').textContent = summary.unprofitable;
            document.getElementById('breakEvenCount').textContent = summary.breakEven;
            document.getElementById('totalProducts').textContent = summary.totalProducts;
            
            // Tabloyu doldur
            renderProductsTable(productsData);
            
            showToast(`${productsData.length} ürün başarıyla yüklendi`, 'success');
        } else {
            throw new Error(data.error);
        }
    } catch (error) {
        tbody.innerHTML = `
            <tr>
                <td colspan="10" class="empty-state">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>Hata: ${error.message}</p>
                </td>
            </tr>
        `;
        showToast('Ürünler yüklenirken hata oluştu', 'error');
    }
}

// Ürün tablosunu render et
function renderProductsTable(products) {
    const tbody = document.getElementById('productsBody');
    
    if (products.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="10" class="empty-state">
                    <i class="fas fa-box-open"></i>
                    <p>Ürün bulunamadı</p>
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = products.map(p => `
        <tr>
            <td title="${p.productName || '-'}">${(p.productName || '-').substring(0, 40)}${(p.productName || '').length > 40 ? '...' : ''}</td>
            <td>${p.barcode || '-'}</td>
            <td><strong>${formatMoney(p.salePrice)}</strong></td>
            <td>${formatMoney(p.costPrice)}</td>
            <td>${p.deductions.commissionRate}% (${formatMoney(p.deductions.commission)})</td>
            <td>${formatMoney(p.deductions.shipping)}</td>
            <td>${formatMoney(p.netRevenue)}</td>
            <td class="${p.profit >= 0 ? 'green' : 'red'}">
                <strong>${formatMoney(p.profit)}</strong>
            </td>
            <td>
                <span class="badge badge-${p.statusColor}">${p.statusMessage}</span>
            </td>
            <td>
                ${p.status === 'zarar' ? 
                    `<span class="badge badge-blue">${formatMoney(p.recommendations.minPriceForProfit)}</span>` : 
                    '-'}
            </td>
        </tr>
    `).join('');
}

// Ürün filtrele
function filterProducts() {
    const searchTerm = document.getElementById('productSearch').value.toLowerCase();
    const filtered = productsData.filter(p => 
        (p.productName || '').toLowerCase().includes(searchTerm) ||
        (p.barcode || '').toLowerCase().includes(searchTerm)
    );
    renderProductsTable(filtered);
}

// Fiyat hesapla
async function calculatePrice() {
    const salePrice = document.getElementById('calcSalePrice').value;
    const costPrice = document.getElementById('calcCostPrice').value;
    const commission = document.getElementById('calcCommission').value;
    
    if (!salePrice) {
        showToast('Satış fiyatı giriniz', 'warning');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/calculator/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                salePrice: parseFloat(salePrice),
                costPrice: parseFloat(costPrice) || 0,
                commissionRate: parseFloat(commission) || 0
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            const result = data.data;
            
            document.getElementById('calculatorResult').innerHTML = `
                <div class="result-grid">
                    <div class="result-item">
                        <div class="result-label">Kargo Ücreti</div>
                        <div class="result-value">${formatMoney(result.deductions.shipping)}</div>
                    </div>
                    <div class="result-item">
                        <div class="result-label">Komisyon (${result.deductions.commissionRate}%)</div>
                        <div class="result-value">${formatMoney(result.deductions.commission)}</div>
                    </div>
                    <div class="result-item">
                        <div class="result-label">Platform Ücreti</div>
                        <div class="result-value">${formatMoney(result.deductions.platformFee)}</div>
                    </div>
                    <div class="result-item">
                        <div class="result-label">Toplam Kesinti</div>
                        <div class="result-value">${formatMoney(result.deductions.total)}</div>
                    </div>
                    <div class="result-item">
                        <div class="result-label">Net Gelir</div>
                        <div class="result-value">${formatMoney(result.netRevenue)}</div>
                    </div>
                    <div class="result-item">
                        <div class="result-label">Kâr Marjı</div>
                        <div class="result-value">${result.profitMargin}%</div>
                    </div>
                </div>
                <div class="status-box ${result.status === 'kar' ? 'profit' : 'loss'}">
                    <h3 class="${result.status === 'kar' ? 'green' : 'red'}">
                        ${result.status === 'kar' ? '✓' : '✗'} ${formatMoney(result.profit)}
                    </h3>
                    <p>${result.statusMessage}</p>
                    ${result.status === 'zarar' ? `
                        <p style="margin-top: 10px;">
                            <strong>Önerilen minimum fiyat:</strong> ${formatMoney(result.recommendations.minPriceForProfit)}<br>
                            <small>(%20 kâr marjı için: ${formatMoney(result.recommendations.recommendedPrice)})</small>
                        </p>
                    ` : ''}
                </div>
            `;
        }
    } catch (error) {
        showToast('Hesaplama hatası: ' + error.message, 'error');
    }
}

// Minimum fiyat hesapla
async function calculateMinPrice() {
    const costPrice = document.getElementById('minCostPrice').value;
    const commission = document.getElementById('minCommission').value;
    
    if (!costPrice) {
        showToast('Maliyet fiyatı giriniz', 'warning');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/calculator/min-price`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                costPrice: parseFloat(costPrice),
                commissionRate: parseFloat(commission) || 0
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            const result = data.data;
            
            document.getElementById('minPriceResult').innerHTML = `
                <div class="status-box profit" style="text-align: left;">
                    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px;">
                        <div>
                            <strong>Başabaş Fiyatı:</strong><br>
                            <span style="font-size: 24px; color: var(--warning);">${formatMoney(result.minPriceForBreakEven)}</span>
                        </div>
                        <div>
                            <strong>Önerilen Fiyat (%20 kâr):</strong><br>
                            <span style="font-size: 24px; color: var(--success);">${formatMoney(result.recommendedPrice)}</span>
                        </div>
                    </div>
                    <hr style="margin: 16px 0; border-color: var(--gray-200);">
                    <small>
                        Platform ücreti: ${formatMoney(result.platformFee)} | 
                        Tahmini kargo: ${formatMoney(result.shippingEstimate)}
                    </small>
                </div>
            `;
        }
    } catch (error) {
        showToast('Hesaplama hatası: ' + error.message, 'error');
    }
}

// Maliyet kaydet
async function saveCost() {
    const barcode = document.getElementById('costBarcode').value;
    const costPrice = document.getElementById('costPrice').value;
    
    if (!barcode || !costPrice) {
        showToast('Barkod ve maliyet giriniz', 'warning');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/calculator/cost`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ barcode, costPrice: parseFloat(costPrice) })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast('Maliyet kaydedildi', 'success');
            document.getElementById('costBarcode').value = '';
            document.getElementById('costPrice').value = '';
            loadCosts();
        }
    } catch (error) {
        showToast('Kayıt hatası: ' + error.message, 'error');
    }
}

// Maliyetleri yükle
async function loadCosts() {
    try {
        const response = await fetch(`${API_BASE}/calculator/costs`);
        const data = await response.json();
        
        if (data.success) {
            costsData = data.data;
            renderCostsTable();
        }
    } catch (error) {
        console.error('Maliyetler yüklenemedi:', error);
    }
}

// Maliyet tablosunu render et
function renderCostsTable() {
    const tbody = document.getElementById('costsBody');
    const entries = Object.entries(costsData);
    
    if (entries.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="3" class="empty-state">
                    <i class="fas fa-database"></i>
                    <p>Henüz maliyet kaydı yok</p>
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = entries.map(([barcode, cost]) => `
        <tr>
            <td>${barcode}</td>
            <td>${formatMoney(cost)}</td>
            <td>
                <button class="btn btn-secondary btn-sm" onclick="deleteCost('${barcode}')">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

// Maliyet sil
async function deleteCost(barcode) {
    try {
        await fetch(`${API_BASE}/calculator/cost`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ barcode, costPrice: 0 })
        });
        showToast('Maliyet silindi', 'success');
        loadCosts();
    } catch (error) {
        showToast('Silme hatası', 'error');
    }
}

// Verileri yenile
function refreshData() {
    loadProducts();
}

// Para formatı
function formatMoney(value) {
    return new Intl.NumberFormat('tr-TR', {
        style: 'currency',
        currency: 'TRY',
        minimumFractionDigits: 2
    }).format(value || 0);
}
