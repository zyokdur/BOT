const API_BASE = '/api';
let productsData = [];
let salesData = [];
let costsData = {};

// ========== INIT ==========
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    testConnection();
    loadSavedCosts();
    initSalesDatePicker();
    checkGeminiStatus();
    // Otomatik ürün yükleme
    loadProducts();
});

// ========== NAVIGATION ==========
function initNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = item.dataset.page;
            document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            document.getElementById(`${page}-page`).classList.add('active');

            // Satışlar açılınca bugünü otomatik yükle
            if (page === 'sales') {
                loadSales();
            }
        });
    });
}

// ========== TOAST ==========
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icons = { success: 'check-circle', error: 'times-circle', warning: 'exclamation-triangle', info: 'info-circle' };
    toast.innerHTML = `<i class="fas fa-${icons[type] || 'info-circle'}"></i> ${message}`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
}

// ========== API TEST ==========
async function testConnection() {
    const statusEl = document.getElementById('apiStatus');
    try {
        const res = await fetch(`${API_BASE}/trendyol/test`);
        const data = await res.json();
        if (data.success) {
            statusEl.className = 'api-status connected';
            statusEl.innerHTML = `<i class="fas fa-circle"></i> <span>Bağlı (${data.totalProducts} ürün)</span>`;
        } else throw new Error(data.error);
    } catch (err) {
        statusEl.className = 'api-status disconnected';
        statusEl.innerHTML = `<i class="fas fa-circle"></i> <span>Bağlantı hatası</span>`;
    }
}

async function loadSavedCosts() {
    try {
        const res = await fetch(`${API_BASE}/trendyol/costs`);
        const data = await res.json();
        if (data.success) costsData = data.costs || {};
    } catch (e) { /* ignore */ }
}

// ========== SALES DATE PICKER ==========
function initSalesDatePicker() {
    const today = new Date();
    const todayStr = formatDateInput(today);
    document.getElementById('salesStartDate').value = todayStr;
    document.getElementById('salesEndDate').value = todayStr;
}

function formatDateInput(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// ========== ÜRÜNLER ==========
async function loadProducts() {
    const tbody = document.getElementById('productsBody');
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state"><div class="loading"></div><p style="margin-top:16px">Aktif ürünler ve komisyonlar yükleniyor...</p></td></tr>`;

    try {
        const res = await fetch(`${API_BASE}/trendyol/products`);
        const data = await res.json();

        if (data.success) {
            productsData = data.data.products;
            const s = data.data.summary;
            document.getElementById('totalProducts').textContent = s.totalProducts;
            document.getElementById('withCostCount').textContent = s.withCostCount;
            document.getElementById('profitableCount').textContent = s.profitable;
            document.getElementById('unprofitableCount').textContent = s.unprofitable;
            document.getElementById('noCostCount').textContent = s.noCost;
            document.getElementById('totalProfit').textContent = fmtMoney(s.totalProfit);
            renderProductsTable(productsData);
            showToast(`${productsData.length} aktif ürün yüklendi`, 'success');
        } else throw new Error(data.error);
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-state"><i class="fas fa-exclamation-triangle red"></i><p>Hata: ${err.message}</p></td></tr>`;
        showToast('Ürünler yüklenirken hata', 'error');
    }
}

function renderProductsTable(products) {
    const tbody = document.getElementById('productsBody');
    if (!products.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-state"><i class="fas fa-box-open"></i><p>Ürün bulunamadı</p></td></tr>`;
        return;
    }

    tbody.innerHTML = products.map((p, idx) => {
        const hasCost = p.costPrice > 0;
        const profitClass = !hasCost ? '' : p.netProfit > 0 ? 'green' : 'red';

        // Komisyon badge
        const commBadge = p.commissionSource === 'siparis'
            ? `<span class="badge badge-green">%${p.commissionRate}</span>`
            : p.commissionSource === 'kategori'
            ? `<span class="badge badge-blue">~%${p.commissionRate}</span>`
            : `<span class="badge badge-orange">%${p.commissionRate}</span>`;

        // Net kâr
        let netKarDisplay;
        if (!hasCost) {
            netKarDisplay = `<span class="badge badge-orange">Maliyet girin</span>`;
        } else {
            const icon = p.netProfit >= 0 ? '▲' : '▼';
            netKarDisplay = `<strong class="${profitClass}">${icon} Net ${fmtMoney(p.netProfit)}</strong>`;
        }

        // Önerilen fiyat
        let recommendedDisplay = '<span class="text-muted">-</span>';
        if (hasCost && p.recommendedPrice > 0) {
            const isHigher = p.recommendedPrice > p.salePrice;
            recommendedDisplay = `<span class="badge ${isHigher ? 'badge-red' : 'badge-green'}">${fmtMoney(p.recommendedPrice)}</span>
                <br><small class="green" style="font-size:11px;">(${fmtMoney(p.recommendedProfit)} kâr)</small>`;
        }

        const name = p.productName || '-';
        const shortName = name.length > 45 ? name.substring(0, 45) + '...' : name;
        const safeBarcode = (p.barcode || '').replace(/'/g, "\\'");

        return `<tr class="clickable" ondblclick="openStrategyByBarcode('${safeBarcode}')" title="Çift tıkla → Strateji Paneli">
            <td title="${name}"><span style="font-weight:500;">${shortName}</span></td>
            <td><input type="number" class="cost-input" value="${p.costPrice || ''}" placeholder="₺" data-barcode="${p.barcode}" onchange="updateCost(this)"></td>
            <td><strong>${fmtMoney(p.salePrice)}</strong></td>
            <td>${commBadge}</td>
            <td>${fmtMoney(p.deductions.shipping)}</td>
            <td>${netKarDisplay}</td>
            <td>${recommendedDisplay}</td>
        </tr>`;
    }).join('');
}

// ========== ÜRÜN STRATEJİ PANELİ (2 Sekmeli) ==========
// Barkod ile ürün açma (filtreleme/sıralama sonrası doğru ürünü bulur)
function openStrategyByBarcode(barcode) {
    const p = productsData.find(prod => prod.barcode === barcode);
    if (!p) return;
    openStrategyProduct(p);
}

async function openStrategy(idx) {
    const p = productsData[idx];
    if (!p) return;
    openStrategyProduct(p);
}

async function openStrategyProduct(p) {
    const modal = document.getElementById('strategyModal');
    modal.innerHTML = `<div class="modal-overlay" onclick="closeStrategy(event)">
        <div class="modal modal-wide" onclick="event.stopPropagation()">
            <div class="modal-header">
                <div>
                    <h2>🔍 Ürün Araştırma & Analiz</h2>
                    <p style="font-size:13px;color:var(--text-dim);margin-top:4px;">${p.productName || 'Ürün'}</p>
                </div>
                <button class="close-btn" onclick="closeStrategy()"><i class="fas fa-times"></i></button>
            </div>
            <div class="modal-tabs">
                <button class="tab-btn active" onclick="switchTab(this, 'tab-title')"><i class="fas fa-heading"></i> Başlık Analizi</button>
                <button class="tab-btn" onclick="switchTab(this, 'tab-price')"><i class="fas fa-chart-line"></i> Fiyat & Rekabet</button>
            </div>
            <div class="modal-body">
                <div class="empty-state"><div class="loading"></div><p style="margin-top:12px;">Trendyol araştırması yapılıyor...</p></div>
            </div>
        </div>
    </div>`;

    try {
        // Araştırma API'sini çağır
        const res = await fetch(`${API_BASE}/trendyol/research`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                barcode: p.barcode,
                title: p.productName,
                salePrice: p.salePrice,
                costPrice: p.costPrice || 0,
                categoryName: p.categoryName || '',
                brand: p.brand || '',
                commissionRate: p.commissionRate || 20
            })
        });
        const data = await res.json();

        if (data.success) {
            renderResearchTabs(data.data, p);
        } else {
            throw new Error(data.error);
        }
    } catch (err) {
        modal.querySelector('.modal-body').innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle red"></i><p>Hata: ${err.message}</p></div>`;
    }
}

function switchTab(btn, tabId) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    const tab = document.getElementById(tabId);
    if (tab) tab.classList.add('active');
}

function renderResearchTabs(research, product) {
    const body = document.querySelector('#strategyModal .modal-body');
    const ta = research.titleAnalysis;
    const ca = research.competitorAnalysis;

    let html = '';

    // ========== TAB 1: BAŞLIK ANALİZİ ==========
    html += `<div class="tab-content active" id="tab-title">`;

    // Başlık Skoru
    html += `<div class="strategy-section">
        <h3><i class="fas fa-star"></i> Başlık SEO Skoru</h3>
        <div class="score-display">
            <div class="score-circle" style="background: conic-gradient(${ta.scoreColor} ${ta.score * 3.6}deg, var(--border) 0);">
                <span class="score-number">${ta.score}</span>
                <span class="score-label">${ta.scoreLabel}</span>
            </div>
            <div class="score-details">
                <div class="score-meta">
                    <span><i class="fas fa-font"></i> ${ta.titleLength} karakter</span>
                    <span><i class="fas fa-text-width"></i> ${ta.wordCount} kelime</span>
                    <span><i class="fas fa-fingerprint"></i> ${ta.uniqueWordCount} benzersiz</span>
                    <span><i class="fas fa-store"></i> ${ta.competitorTitleCount} rakip başlık</span>
                </div>
                ${ta.scoreBreakdown ? `<div class="score-breakdown">
                    ${ta.scoreBreakdown.map(b => `<div class="breakdown-row">
                        <span class="breakdown-label">${b.label}</span>
                        <div class="breakdown-bar-container">
                            <div class="breakdown-bar" style="width:${b.max > 0 ? (b.score / b.max * 100) : 0}%;background:${b.score >= b.max * 0.7 ? 'var(--green)' : b.score >= b.max * 0.4 ? 'var(--orange)' : 'var(--red)'}"></div>
                        </div>
                        <span class="breakdown-score">${b.score}/${b.max}</span>
                    </div>`).join('')}
                </div>` : ''}
            </div>
        </div>
    </div>`;

    // Mevcut Başlık
    html += `<div class="strategy-section">
        <h3><i class="fas fa-heading"></i> Mevcut Başlık</h3>
        <div class="title-box current">${ta.currentTitle}</div>
    </div>`;

    // Önerilen Başlık
    if (ta.suggestedTitle && ta.suggestedTitle !== ta.currentTitle) {
        html += `<div class="strategy-section">
            <h3><i class="fas fa-magic"></i> Önerilen Başlık (Algoritma)</h3>
            <div class="title-box suggested" id="suggestedTitleText">${ta.suggestedTitle}</div>
            <button class="btn btn-sm" style="margin-top:8px;background:var(--primary-bg);color:var(--primary-light);border:1px solid var(--primary-border);" onclick="copySuggestedTitle()">
                <i class="fas fa-copy"></i> Kopyala
            </button>
        </div>`;
    }

    // AI Önerilen Başlık (Gemini)
    if (research.aiSuggestedTitle) {
        html += `<div class="strategy-section">
            <h3><i class="fas fa-robot"></i> AI Başlık Önerisi <span class="badge badge-blue" style="font-size:10px;">Gemini AI</span></h3>
            <div class="title-box suggested" id="aiSuggestedTitleText" style="border-color:rgba(77,171,247,0.4);background:rgba(77,171,247,0.06);">${research.aiSuggestedTitle}</div>
            <button class="btn btn-sm" style="margin-top:8px;background:rgba(77,171,247,0.1);color:#4dabf7;border:1px solid rgba(77,171,247,0.3);" onclick="copyAiTitle()">
                <i class="fas fa-copy"></i> AI Başlığı Kopyala
            </button>
        </div>`;
    } else if (research.aiEnabled === false) {
        html += `<div class="strategy-section">
            <div style="padding:14px 18px;background:rgba(255,169,77,0.08);border:1px solid rgba(255,169,77,0.2);border-radius:10px;font-size:13px;color:var(--text-dim);">
                <i class="fas fa-robot" style="color:var(--orange);"></i> AI başlık önerisi için <strong>Ayarlar</strong> sayfasından Gemini API key girin.
                <a href="https://aistudio.google.com/app/apikey" target="_blank" style="color:var(--primary-light);margin-left:4px;">Ücretsiz key al →</a>
            </div>
        </div>`;
    }

    // AI Analiz Sonuçları
    if (research.aiAnalysis) {
        html += `<div class="strategy-section">
            <h3><i class="fas fa-brain"></i> AI Ürün Analizi <span class="badge badge-blue" style="font-size:10px;">Gemini AI</span></h3>
            <div class="ai-insights">`;
        if (research.aiAnalysis.positioning) {
            html += `<div class="ai-insight-card">
                <div class="ai-insight-icon">📦</div>
                <div class="ai-insight-content">
                    <div class="ai-insight-title">Ürün Konumlandırma</div>
                    <div class="ai-insight-text">${research.aiAnalysis.positioning}</div>
                </div>
            </div>`;
        }
        if (research.aiAnalysis.pricing) {
            html += `<div class="ai-insight-card">
                <div class="ai-insight-icon">💰</div>
                <div class="ai-insight-content">
                    <div class="ai-insight-title">Fiyatlandırma</div>
                    <div class="ai-insight-text">${research.aiAnalysis.pricing}</div>
                </div>
            </div>`;
        }
        if (research.aiAnalysis.visibility) {
            html += `<div class="ai-insight-card">
                <div class="ai-insight-icon">🔍</div>
                <div class="ai-insight-content">
                    <div class="ai-insight-title">Görünürlük</div>
                    <div class="ai-insight-text">${research.aiAnalysis.visibility}</div>
                </div>
            </div>`;
        }
        html += `</div></div>`;
    }

    // Sorunlar & İpuçları
    if (ta.issues.length > 0 || ta.tips.length > 0) {
        html += `<div class="strategy-section">
            <h3><i class="fas fa-clipboard-check"></i> Sorunlar & İpuçları</h3>
            <div class="issues-list">`;

        ta.issues.forEach(issue => {
            const icon = issue.type === 'error' ? 'times-circle' : 'exclamation-triangle';
            const color = issue.type === 'error' ? 'red' : 'orange';
            html += `<div class="issue-item ${issue.type}"><i class="fas fa-${icon} ${color}"></i> ${issue.text}</div>`;
        });

        ta.tips.forEach(tip => {
            html += `<div class="issue-item tip"><i class="fas fa-lightbulb" style="color:var(--yellow);"></i> ${tip}</div>`;
        });

        html += `</div></div>`;
    }

    // Popüler Anahtar Kelimeler
    if (ta.popularKeywords.length > 0) {
        html += `<div class="strategy-section">
            <h3><i class="fas fa-key"></i> Kategorideki Popüler Anahtar Kelimeler</h3>
            <p style="font-size:12px;color:var(--text-dim);margin-bottom:10px;">"${research.categoryName}" kategorisindeki ${ta.competitorTitleCount} ürünün başlık analizi</p>
            <div class="keyword-grid">`;

        ta.popularKeywords.forEach(kw => {
            const cls = kw.inYourTitle ? 'keyword-tag used' : 'keyword-tag missing';
            const icon = kw.inYourTitle ? 'check' : 'plus';
            html += `<span class="${cls}" title="%${kw.usagePercent} kullanım oranı">
                <i class="fas fa-${icon}"></i> ${kw.word} <small>(%${kw.usagePercent})</small>
            </span>`;
        });

        html += `</div>
            <div style="margin-top:8px;display:flex;gap:12px;font-size:11px;color:var(--text-dim);">
                <span><span class="keyword-tag used" style="font-size:10px;padding:2px 6px;"><i class="fas fa-check"></i> Mevcut</span> Başlığınızda var</span>
                <span><span class="keyword-tag missing" style="font-size:10px;padding:2px 6px;"><i class="fas fa-plus"></i> Eksik</span> Eklemeyi düşünün</span>
            </div>
        </div>`;
    }

    // Eksik Anahtar Kelimeler
    if (ta.missingKeywords.length > 0) {
        html += `<div class="strategy-section">
            <h3><i class="fas fa-puzzle-piece"></i> Eksik Önemli Kelimeler</h3>
            <p style="font-size:12px;color:var(--text-dim);margin-bottom:10px;">Bu kelimeler rakiplerin %20'sinden fazlasında kullanılıyor ama sizin başlığınızda yok:</p>
            <div class="missing-keywords">`;

        ta.missingKeywords.forEach(kw => {
            html += `<div class="missing-kw-item">
                <span class="kw-word">${kw.word}</span>
                <span class="badge badge-orange">%${kw.usagePercent} kullanım</span>
                <span class="badge badge-blue">${kw.count} üründe</span>
            </div>`;
        });

        html += `</div></div>`;
    }

    // Trendyol Arama Sonuçları — Organik Rakip Analizi
    const ts = research.trendyolSearch;
    if (ts && ts.competitors && ts.competitors.length > 0) {
        html += `<div class="strategy-section">
            <h3><i class="fas fa-search"></i> Trendyol'daki İlk ${ts.competitors.length} Rakip <span class="badge badge-green" style="font-size:10px;">Organik Arama</span> ${ts.ratedCount ? `<span class="badge badge-orange" style="font-size:10px;">⭐ ${ts.ratedCount} puanlı</span>` : ''}</h3>
            <p style="font-size:12px;color:var(--text-dim);margin-bottom:10px;">"${ts.searchQuery}" aramasında ${ts.totalResults > 0 ? ts.totalResults.toLocaleString('tr-TR') + ' sonuç' : 'sonuçlar'} — puanlı/yorumlu rakipler öncelikli:</p>
            <div class="trendyol-competitors">`;
        
        ts.competitors.forEach((c, i) => {
            html += `<div class="ai-insight-card" style="margin-bottom:8px;">
                <div class="ai-insight-icon" style="font-size:18px;font-weight:700;color:var(--primary-light);">#${i + 1}</div>
                <div class="ai-insight-content" style="flex:1;">
                    <div class="ai-insight-title" style="font-size:13px;">${c.name}</div>
                    <div style="display:flex;gap:8px;margin-top:4px;flex-wrap:wrap;">
                        <span class="badge badge-blue">${c.brand}</span>
                        <span class="badge badge-green">${fmtMoney(c.price)}</span>
                        ${c.ratingScore > 0 ? `<span class="badge badge-orange">⭐ ${c.ratingScore.toFixed(1)} (${c.ratingCount})</span>` : ''}
                        ${c.favoriteCount > 0 ? `<span class="badge" style="background:rgba(255,107,107,0.1);color:var(--red);border:1px solid rgba(255,107,107,0.3);">❤️ ${c.favoriteCount}</span>` : ''}
                    </div>
                </div>
            </div>`;
        });
        
        html += `</div></div>`;
    }

    // Trendyol Arama Önerileri (organik kelimeler)
    if (ts && ts.keywords && ts.keywords.length > 0) {
        html += `<div class="strategy-section">
            <h3><i class="fas fa-fire"></i> Trendyol Arama Önerileri <span class="badge badge-orange" style="font-size:10px;">Organik</span></h3>
            <p style="font-size:12px;color:var(--text-dim);margin-bottom:10px;">Trendyol kullanıcıları bu kelimeleri arıyor:</p>
            <div class="keyword-grid">`;
        
        ts.keywords.forEach(kw => {
            const inTitle = research.productTitle.toLowerCase().includes(kw.toLowerCase());
            html += `<span class="${inTitle ? 'keyword-tag used' : 'keyword-tag missing'}" title="Trendyol arama önerisi">
                <i class="fas fa-${inTitle ? 'check' : 'fire'}"></i> ${kw}
            </span>`;
        });
        
        html += `</div></div>`;
    }

    html += `</div>`; // tab-title kapanış

    // ========== TAB 2: FİYAT & REKABET ==========
    html += `<div class="tab-content" id="tab-price">`;

    if (!ca.hasData) {
        html += `<div class="empty-state"><i class="fas fa-store-slash"></i><p>${ca.message}</p></div>`;
    }

    // Maliyet Detayları (varsa)
    if (ca.costBreakdown) {
        const cb = ca.costBreakdown;
        html += `<div class="strategy-section">
            <h3><i class="fas fa-receipt"></i> Maliyet Detayları</h3>
            <div class="strategy-grid">
                <div class="strategy-card">
                    <div class="s-title">📦 Ürün Maliyeti</div>
                    <div class="s-value" style="color:var(--primary-light);">${fmtMoney(cb.productCost)}</div>
                    <div class="s-desc">Alış/tedarik fiyatı</div>
                </div>
                <div class="strategy-card">
                    <div class="s-title">🚚 Kargo</div>
                    <div class="s-value orange">${fmtMoney(cb.shipping)}</div>
                    <div class="s-desc">Trendyol kargo ücreti</div>
                </div>
                <div class="strategy-card">
                    <div class="s-title">💳 Komisyon (%${cb.commissionRate})</div>
                    <div class="s-value red">${fmtMoney(cb.commission)}</div>
                    <div class="s-desc">Trendyol komisyonu</div>
                </div>
                <div class="strategy-card">
                    <div class="s-title">🏢 Platform Ücreti</div>
                    <div class="s-value" style="color:var(--text-dim);">${fmtMoney(cb.platformFee)}</div>
                    <div class="s-desc">Sabit platform ücreti</div>
                </div>
                <div class="strategy-card" style="border:1px solid var(--orange);">
                    <div class="s-title">⚖️ Başa Baş Fiyat</div>
                    <div class="s-value" style="color:var(--orange);font-size:20px;">${fmtMoney(ca.breakEvenPrice)}</div>
                    <div class="s-desc">Bu fiyatın altında zarar edersiniz</div>
                </div>
                ${ca.pricingStrategy && ca.pricingStrategy.profitAtCurrent !== null ? `<div class="strategy-card" style="border:1px solid ${ca.pricingStrategy.profitAtCurrent >= 0 ? 'var(--green)' : 'var(--red)'};">
                    <div class="s-title">${ca.pricingStrategy.profitAtCurrent >= 0 ? '💰' : '🔴'} Mevcut Kâr/Zarar</div>
                    <div class="s-value" style="color:${ca.pricingStrategy.profitAtCurrent >= 0 ? 'var(--green)' : 'var(--red)'};">${fmtMoney(ca.pricingStrategy.profitAtCurrent)}</div>
                    <div class="s-desc">Satış başına (${fmtMoney(research.productPrice)} fiyatından)</div>
                </div>` : ''}
            </div>
        </div>`;
    } else if (ca.breakEvenPrice) {
        html += `<div class="strategy-section">
            <div class="strategy-grid">
                <div class="strategy-card" style="border:1px solid var(--orange);">
                    <div class="s-title">⚖️ Başa Baş Fiyat</div>
                    <div class="s-value" style="color:var(--orange);">${fmtMoney(ca.breakEvenPrice)}</div>
                    <div class="s-desc">Bu fiyatın altında zarar edersiniz</div>
                </div>
            </div>
        </div>`;
    }

    // Fiyat Stratejisi (kupon stratejisi dahil)
    if (ca.pricingStrategy && ca.pricingStrategy.type !== 'normal') {
        const ps = ca.pricingStrategy;
        const borderColor = ps.canCompete ? 'var(--orange)' : 'var(--red)';
        const bgColor = ps.canCompete ? 'rgba(255,169,77,0.06)' : 'rgba(255,107,107,0.06)';

        html += `<div class="strategy-section">
            <h3><i class="fas fa-chess"></i> Fiyat Stratejisi</h3>
            <div style="padding:16px 20px;background:${bgColor};border:1px solid ${borderColor};border-radius:12px;">
                <div style="font-size:16px;font-weight:700;margin-bottom:8px;color:${ps.canCompete ? 'var(--orange)' : 'var(--red)'};">${ps.title}</div>
                <div style="font-size:13px;color:var(--text);margin-bottom:16px;line-height:1.5;">${ps.description}</div>
                ${ps.actions.length > 0 ? `<div style="display:grid;gap:10px;">
                    ${ps.actions.map(a => `<div style="display:flex;gap:12px;align-items:flex-start;padding:12px 14px;background:var(--bg);border:1px solid var(--border);border-radius:10px;">
                        <span style="font-size:22px;flex-shrink:0;">${a.icon}</span>
                        <div>
                            <div style="font-size:13px;font-weight:600;color:var(--text);">${a.title}</div>
                            <div style="font-size:12px;color:var(--text);margin-top:2px;">${a.text}</div>
                            <div style="font-size:11px;color:var(--text-dim);margin-top:4px;">${a.detail}</div>
                        </div>
                    </div>`).join('')}
                </div>` : ''}
                ${ps.suggestedListPrice ? `<div style="margin-top:14px;padding:12px 16px;background:rgba(77,171,247,0.08);border:1px solid rgba(77,171,247,0.25);border-radius:10px;">
                    <div style="font-size:12px;color:var(--text-dim);margin-bottom:6px;">📌 Önerilen Strateji Özeti:</div>
                    <div style="font-size:14px;font-weight:600;color:var(--primary-light);">
                        Liste Fiyatı: ${fmtMoney(ps.suggestedListPrice)} → Kupon: ${fmtMoney(ps.suggestedCoupon)} → Müşteri Fiyatı: ${fmtMoney(ps.suggestedListPrice - ps.suggestedCoupon)}
                    </div>
                </div>` : ''}
            </div>
        </div>`;
    }

    if (ca.hasData) {
        // Fiyat Özeti
        html += `<div class="strategy-section">
            <h3><i class="fas fa-chart-pie"></i> Fiyat Genel Bakış</h3>
            <div class="strategy-grid">
                <div class="strategy-card">
                    <div class="s-title">Senin Fiyatın</div>
                    <div class="s-value blue">${fmtMoney(research.productPrice)}</div>
                    <div class="s-desc">Mevcut satış fiyatı</div>
                </div>
                <div class="strategy-card">
                    <div class="s-title">Kategori Ortalaması</div>
                    <div class="s-value" style="color:var(--primary-light);">${fmtMoney(ca.priceStats.avg)}</div>
                    <div class="s-desc">Medyan: ${fmtMoney(ca.priceStats.median)}</div>
                </div>
                <div class="strategy-card">
                    <div class="s-title">Fiyat Aralığı</div>
                    <div class="s-value orange">${fmtMoney(ca.priceStats.min)} - ${fmtMoney(ca.priceStats.max)}</div>
                    <div class="s-desc">${ca.priceStats.count} ürün arasında</div>
                </div>
                ${ca.discountStats ? `<div class="strategy-card">
                    <div class="s-title">İndirimli Ürünler</div>
                    <div class="s-value green">%${ca.discountStats.percent}</div>
                    <div class="s-desc">${ca.discountStats.count} ürün, ort. %${ca.discountStats.avgDiscount} indirim</div>
                </div>` : ''}
            </div>
        </div>`;

        // Fiyat Pozisyonu
        html += `<div class="strategy-section">
            <h3><i class="fas fa-map-marker-alt"></i> Fiyat Pozisyonu</h3>
            <div class="price-position-bar">
                <div class="position-track">
                    <div class="position-fill" style="width:${ca.pricePosition.percent}%;"></div>
                    <div class="position-marker" style="left:${ca.pricePosition.percent}%;"></div>
                </div>
                <div class="position-labels">
                    <span>En Ucuz</span>
                    <span class="position-current">${ca.pricePosition.label}</span>
                    <span>En Pahalı</span>
                </div>
                <div style="margin-top:8px;font-size:12px;color:var(--text-dim);text-align:center;">
                    <span class="green">${ca.pricePosition.cheaperCount} ürün sizden ucuz</span> · 
                    <span class="red">${ca.pricePosition.expensiveCount} ürün sizden pahalı</span>
                </div>
            </div>
        </div>`;

        // Öneri
        if (ca.recommendation) {
            const recType = ca.recommendation.type;
            const recBorder = recType === 'high' ? 'var(--red-border)' : recType === 'low' ? 'var(--green-border)' : 'var(--primary-border)';
            const recBg = recType === 'high' ? 'var(--red-bg)' : recType === 'low' ? 'var(--green-bg)' : 'var(--primary-bg)';

            html += `<div class="strategy-section">
                <div class="coupon-box" style="border-color:${recBorder};background:${recBg};">
                    <div class="c-title" style="color:${recType === 'high' ? 'var(--red)' : recType === 'low' ? 'var(--green)' : 'var(--primary-light)'};">
                        ${ca.recommendation.icon} Fiyat Önerisi
                    </div>
                    <div class="c-detail">${ca.recommendation.text}</div>
                    ${ca.recommendation.details ? `<div class="c-detail" style="margin-top:6px;font-size:12px;opacity:0.8;">${ca.recommendation.details}</div>` : ''}
                    ${ca.recommendation.suggestedPrice !== research.productPrice ?
                        `<div style="margin-top:10px;"><span class="badge badge-blue">Önerilen: ${fmtMoney(ca.recommendation.suggestedPrice)}</span></div>` : ''}
                </div>
            </div>`;
        }

        // Kargo Baremi Optimizasyonu
        if (ca.shippingOptimization) {
            html += `<div class="strategy-section">
                <div class="coupon-box" style="border-color:var(--orange);border-color:rgba(255,169,77,0.4);background:var(--orange-bg);">
                    <div class="c-title" style="color:var(--orange);"><i class="fas fa-truck"></i> ${ca.shippingOptimization.text}</div>
                    <div class="c-detail">Hedef fiyat: <strong>${fmtMoney(ca.shippingOptimization.targetPrice)}</strong> → Kargo tasarrufu: <strong>${fmtMoney(ca.shippingOptimization.saving)}</strong></div>
                </div>
            </div>`;
        }

        // Fiyat Dağılımı
        if (ca.segments) {
            html += `<div class="strategy-section">
                <h3><i class="fas fa-layer-group"></i> Fiyat Segmentleri</h3>
                <div class="segment-grid">`;

            const segColors = ['#00d68f', '#4dabf7', '#ffa94d', '#ff6b6b'];
            ca.segments.forEach((seg, i) => {
                const isYours = (i === 0 && ca.pricePosition.percent <= 25) ||
                    (i === 1 && ca.pricePosition.percent > 25 && ca.pricePosition.percent <= 50) ||
                    (i === 2 && ca.pricePosition.percent > 50 && ca.pricePosition.percent <= 75) ||
                    (i === 3 && ca.pricePosition.percent > 75);

                html += `<div class="segment-card ${isYours ? 'segment-active' : ''}">
                    <div class="seg-label">${seg.label}</div>
                    <div class="seg-count" style="color:${segColors[i]};">${seg.count} ürün</div>
                    <div class="seg-range">${seg.range}</div>
                    ${isYours ? '<div class="seg-you"><i class="fas fa-map-pin"></i> Siz buradasınız</div>' : ''}
                </div>`;
            });

            html += `</div></div>`;
        }

        // Rakip Tablosu
        if (ca.competitors.length > 0) {
            html += `<div class="strategy-section">
                <h3><i class="fas fa-users"></i> En Yakın Rakipler (Fiyata Göre)</h3>
                <table class="sweet-spot-table">
                    <thead>
                        <tr>
                            <th>Ürün</th>
                            <th>Marka</th>
                            <th>Fiyat</th>
                            <th>İndirim</th>
                            <th>Fark</th>
                        </tr>
                    </thead>
                    <tbody>`;

            ca.competitors.forEach(c => {
                const diffClass = c.priceDiff > 0 ? 'green' : c.priceDiff < 0 ? 'red' : '';
                const diffIcon = c.priceDiff > 0 ? '▲' : c.priceDiff < 0 ? '▼' : '=';
                const shortTitle = c.title.length > 40 ? c.title.substring(0, 40) + '...' : c.title;

                html += `<tr>
                    <td title="${c.title}" style="max-width:250px;"><span style="font-weight:500;">${shortTitle}</span></td>
                    <td><span class="badge badge-blue">${c.brand}</span></td>
                    <td><strong>${fmtMoney(c.salePrice)}</strong></td>
                    <td>${c.hasDiscount ? `<span class="badge badge-green">%${c.discountPercent}</span>` : '<span class="text-muted">-</span>'}</td>
                    <td class="${diffClass}">${diffIcon} ${fmtMoney(Math.abs(c.priceDiff))} <small>(%${Math.abs(c.priceDiffPercent)})</small></td>
                </tr>`;
            });

            html += `</tbody></table></div>`;
        }
    }

    html += `</div>`; // tab-price kapanış

    body.innerHTML = html;
}

function closeStrategy(event) {
    if (event && event.target !== event.currentTarget) return;
    document.getElementById('strategyModal').innerHTML = '';
}

function copySuggestedTitle() {
    const el = document.getElementById('suggestedTitleText');
    if (el) {
        navigator.clipboard.writeText(el.textContent).then(() => {
            showToast('Başlık kopyalandı!', 'success');
        }).catch(() => {
            // Fallback
            const range = document.createRange();
            range.selectNode(el);
            window.getSelection().removeAllRanges();
            window.getSelection().addRange(range);
            document.execCommand('copy');
            window.getSelection().removeAllRanges();
            showToast('Başlık kopyalandı!', 'success');
        });
    }
}

// ========== MALİYET GÜNCELLEME ==========
async function updateCost(input) {
    const barcode = input.dataset.barcode;
    const costPrice = parseFloat(input.value) || 0;

    try {
        await fetch(`${API_BASE}/trendyol/cost`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ barcode, costPrice })
        });
        costsData[barcode] = costPrice;

        const product = productsData.find(p => p.barcode === barcode);
        if (product) {
            product.costPrice = costPrice;
            recalcProduct(product);
            renderProductsTable(productsData);
            updateDashboard();
        }
        showToast('Maliyet güncellendi', 'success');
    } catch (err) {
        showToast('Maliyet güncellenemedi', 'error');
    }
}

function recalcProduct(p) {
    const ranges = [
        { min: 0, max: 149.99, cost: 58.50 },
        { min: 150, max: 299.99, cost: 95.50 },
        { min: 300, max: 399.99, cost: 110 },
        { min: 400, max: Infinity, cost: 130 }
    ];
    const platformFee = 13.80;
    const salePrice = p.salePrice || 0;
    const costPrice = p.costPrice || 0;
    const commRate = p.commissionRate || 0;

    const shipping = (ranges.find(r => salePrice >= r.min && salePrice <= r.max) || { cost: 130 }).cost;
    const commission = (salePrice * commRate) / 100;
    const totalDeductions = shipping + commission + platformFee;
    p.netRevenue = salePrice - totalDeductions;
    p.netProfit = p.netRevenue - costPrice;
    p.deductions = { shipping, commission, commissionRate: commRate, platformFee, total: totalDeductions };
    p.profitMargin = salePrice > 0 ? ((p.netProfit / salePrice) * 100).toFixed(1) : 0;

    if (costPrice > 0) {
        let margin;
        if (costPrice <= 25) margin = 0.50;
        else if (costPrice <= 50) margin = 0.38;
        else if (costPrice <= 100) margin = 0.30;
        else if (costPrice <= 200) margin = 0.25;
        else if (costPrice <= 400) margin = 0.22;
        else margin = 0.18;

        const targetProfit = costPrice * margin;
        let price = costPrice + platformFee + targetProfit;
        for (let i = 0; i < 15; i++) {
            const sh = (ranges.find(r => price >= r.min && price <= r.max) || { cost: 130 }).cost;
            const newPrice = (costPrice + platformFee + sh + targetProfit) / (1 - commRate / 100);
            if (Math.abs(newPrice - price) < 0.01) break;
            price = newPrice;
        }
        p.recommendedPrice = Math.ceil(price * 100) / 100;
        const recShipping = (ranges.find(r => p.recommendedPrice >= r.min && p.recommendedPrice <= r.max) || { cost: 130 }).cost;
        const recCommission = (p.recommendedPrice * commRate) / 100;
        p.recommendedProfit = p.recommendedPrice - recShipping - recCommission - platformFee - costPrice;
    } else {
        p.recommendedPrice = 0;
        p.recommendedProfit = 0;
    }
}

function updateDashboard() {
    const withCost = productsData.filter(p => p.costPrice > 0);
    document.getElementById('totalProducts').textContent = productsData.length;
    document.getElementById('withCostCount').textContent = withCost.length;
    document.getElementById('profitableCount').textContent = withCost.filter(p => p.netProfit > 0).length;
    document.getElementById('unprofitableCount').textContent = withCost.filter(p => p.netProfit < 0).length;
    document.getElementById('noCostCount').textContent = productsData.filter(p => p.costPrice <= 0).length;
    document.getElementById('totalProfit').textContent = fmtMoney(withCost.reduce((s, p) => s + p.netProfit, 0));
}

function filterProducts() {
    const term = document.getElementById('productSearch').value.toLowerCase();
    renderProductsTable(productsData.filter(p =>
        (p.productName || '').toLowerCase().includes(term) ||
        (p.barcode || '').toLowerCase().includes(term)
    ));
}

function sortProducts(field) {
    if (!field) return;
    const sorted = [...productsData].sort((a, b) => {
        if (field === 'profit-desc') return (b.netProfit || 0) - (a.netProfit || 0);
        if (field === 'profit-asc') return (a.netProfit || 0) - (b.netProfit || 0);
        if (field === 'commission') return (b.commissionRate || 0) - (a.commissionRate || 0);
        if (field === 'price') return (b.salePrice || 0) - (a.salePrice || 0);
        return 0;
    });
    renderProductsTable(sorted);
}

function filterByCost(mode) {
    if (mode === 'with') renderProductsTable(productsData.filter(p => p.costPrice > 0));
    else if (mode === 'without') renderProductsTable(productsData.filter(p => !p.costPrice || p.costPrice <= 0));
    else if (mode === 'profitable') renderProductsTable(productsData.filter(p => p.costPrice > 0 && p.netProfit > 0));
    else if (mode === 'unprofitable') renderProductsTable(productsData.filter(p => p.costPrice > 0 && p.netProfit < 0));
    else renderProductsTable(productsData);
}

// ========== SATIŞLAR ==========
async function loadSales() {
    const startDate = document.getElementById('salesStartDate').value;
    const endDate = document.getElementById('salesEndDate').value;

    if (!startDate || !endDate) {
        showToast('Lütfen tarih aralığı seçin', 'warning');
        return;
    }

    const tbody = document.getElementById('salesBody');
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state"><div class="loading"></div><p style="margin-top:16px">Siparişler yükleniyor...</p></td></tr>`;

    try {
        const res = await fetch(`${API_BASE}/trendyol/sales?startDate=${startDate}&endDate=${endDate}`);
        const data = await res.json();

        if (data.success) {
            salesData = data.data.sales;
            const s = data.data.summary;

            document.getElementById('salesTotalRevenue').textContent = fmtMoney(s.totalRevenue);
            document.getElementById('salesTotalShipping').textContent = fmtMoney(s.totalShipping);
            document.getElementById('salesTotalCommission').textContent = fmtMoney(s.totalCommission);
            document.getElementById('salesTotalCost').textContent = fmtMoney(s.totalCost);
            document.getElementById('salesTotalProfit').textContent = fmtMoney(s.totalProfit);
            document.getElementById('salesOrderCount').textContent = s.totalOrders;
            document.getElementById('salesItemCount').textContent = s.totalItems;

            const profitCard = document.getElementById('salesProfitCard');
            if (profitCard) {
                profitCard.classList.remove('profit-card', 'loss-card');
                profitCard.classList.add(s.totalProfit >= 0 ? 'profit-card' : 'loss-card');
            }

            renderSalesTable(salesData);
            showToast(`${s.totalItems} satış yüklendi (${s.totalOrders} sipariş)`, 'success');
        } else throw new Error(data.error);
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="8" class="empty-state"><i class="fas fa-exclamation-triangle red"></i><p>Hata: ${err.message}</p></td></tr>`;
        showToast('Satışlar yüklenirken hata', 'error');
    }
}

function renderSalesTable(sales) {
    const tbody = document.getElementById('salesBody');
    if (!sales.length) {
        tbody.innerHTML = `<tr><td colspan="8" class="empty-state"><i class="fas fa-receipt"></i><p>Bu dönemde sipariş bulunamadı</p></td></tr>`;
        return;
    }

    tbody.innerHTML = sales.map(s => {
        const hasCost = s.costPrice > 0;
        const profitClass = !hasCost ? '' : s.netProfit > 0 ? 'green' : 'red';

        let profitDisplay;
        if (!hasCost) {
            profitDisplay = '<span class="badge badge-orange">Maliyet yok</span>';
        } else {
            const icon = s.netProfit > 0 ? '▲' : '▼';
            profitDisplay = `<strong class="${profitClass}">${icon} Net ${fmtMoney(s.netProfit)}</strong>`;
        }

        const name = s.productName || '-';
        const shortName = name.length > 30 ? name.substring(0, 30) + '...' : name;
        const statusBadge = getStatusBadge(s.status);

        return `<tr>
            <td style="white-space:nowrap;font-size:12px;">${s.orderDateFormatted}</td>
            <td title="${name}"><span style="font-weight:500;">${shortName}</span></td>
            <td style="text-align:center;">${s.quantity}</td>
            <td><strong>${fmtMoney(s.salePrice)}</strong></td>
            <td>%${s.commissionRate} <small class="text-dim">(${fmtMoney(s.commissionAmount)})</small></td>
            <td>${fmtMoney(s.shippingCost)}</td>
            <td>${profitDisplay}</td>
            <td>${statusBadge}</td>
        </tr>`;
    }).join('');
}

function getStatusBadge(status) {
    const map = {
        'Created': ['badge-blue', 'Oluşturuldu', 'clock'],
        'Picking': ['badge-blue', 'Hazırlanıyor', 'box'],
        'ReadyToShip': ['badge-orange', 'Kargoya Hazır', 'box-open'],
        'Shipped': ['badge-blue', 'Kargoda', 'truck'],
        'Delivered': ['badge-green', 'Teslim Edildi', 'check-circle'],
        'UnDelivered': ['badge-red', 'Teslim Edilemedi', 'times-circle'],
        'UnDeliveredAndReturned': ['badge-red', 'İade', 'undo'],
        'Cancelled': ['badge-red', 'İptal', 'ban'],
        'Returned': ['badge-red', 'İade', 'undo']
    };
    const [cls, text, icon] = map[status] || ['badge-blue', status, 'info-circle'];
    return `<span class="badge ${cls}"><i class="fas fa-${icon}" style="font-size:10px;"></i> ${text}</span>`;
}

// ========== HESAPLAYICI ==========
async function calculatePrice() {
    const salePrice = document.getElementById('calcSalePrice').value;
    const costPrice = document.getElementById('calcCostPrice').value;
    const commission = document.getElementById('calcCommission').value;

    if (!salePrice) { showToast('Satış fiyatı giriniz', 'warning'); return; }

    try {
        const res = await fetch(`${API_BASE}/calculator/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                salePrice: parseFloat(salePrice),
                costPrice: parseFloat(costPrice) || 0,
                commissionRate: parseFloat(commission) || 0
            })
        });
        const data = await res.json();
        if (data.success) {
            const r = data.data;
            const profitClass = r.netProfit >= 0 ? 'green' : 'red';
            document.getElementById('calculatorResult').innerHTML = `
                <div class="result-grid">
                    <div class="result-item">
                        <div class="result-label">Kargo</div>
                        <div class="result-value orange">${fmtMoney(r.deductions.shipping)}</div>
                    </div>
                    <div class="result-item">
                        <div class="result-label">Komisyon (%${r.deductions.commissionRate})</div>
                        <div class="result-value red">${fmtMoney(r.deductions.commission)}</div>
                    </div>
                    <div class="result-item">
                        <div class="result-label">Platform Ücreti</div>
                        <div class="result-value">${fmtMoney(r.deductions.platformFee)}</div>
                    </div>
                    <div class="result-item">
                        <div class="result-label">Toplam Kesinti</div>
                        <div class="result-value red">${fmtMoney(r.deductions.total)}</div>
                    </div>
                    <div class="result-item">
                        <div class="result-label">Net Gelir</div>
                        <div class="result-value blue">${fmtMoney(r.netRevenue)}</div>
                    </div>
                    <div class="result-item" style="border:1px solid ${r.netProfit >= 0 ? 'var(--green-border)' : 'var(--red-border)'};">
                        <div class="result-label">Net Kâr</div>
                        <div class="result-value ${profitClass}"><strong>Net ${fmtMoney(r.netProfit)}</strong></div>
                    </div>
                </div>`;
        }
    } catch (err) {
        showToast('Hesaplama hatası: ' + err.message, 'error');
    }
}

// ========== UTILS ==========
function fmtMoney(value) {
    return new Intl.NumberFormat('tr-TR', {
        style: 'currency', currency: 'TRY', minimumFractionDigits: 2
    }).format(value || 0);
}

// ========== AI BAŞLIK KOPYALA ==========
function copyAiTitle() {
    const el = document.getElementById('aiSuggestedTitleText');
    if (el) {
        navigator.clipboard.writeText(el.textContent).then(() => {
            showToast('AI başlık kopyalandı!', 'success');
        }).catch(() => {
            const range = document.createRange();
            range.selectNode(el);
            window.getSelection().removeAllRanges();
            window.getSelection().addRange(range);
            document.execCommand('copy');
            window.getSelection().removeAllRanges();
            showToast('AI başlık kopyalandı!', 'success');
        });
    }
}

// ========== GEMINI AI AYARLARI ==========
async function checkGeminiStatus() {
    try {
        const res = await fetch(`${API_BASE}/trendyol/settings/gemini`);
        const data = await res.json();
        const el = document.getElementById('geminiStatus');
        if (el) {
            if (data.configured) {
                el.innerHTML = `<span class="green"><i class="fas fa-check-circle"></i> Gemini AI aktif (${data.maskedKey})</span>`;
            } else {
                el.innerHTML = `<span class="text-dim"><i class="fas fa-info-circle"></i> API key girilmemiş</span>`;
            }
        }
    } catch (e) { /* ignore */ }
}

async function saveGeminiKey() {
    const apiKey = document.getElementById('geminiApiKey').value.trim();
    try {
        const res = await fetch(`${API_BASE}/trendyol/settings/gemini`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey })
        });
        const data = await res.json();
        if (data.success) {
            showToast(apiKey ? 'Gemini API key kaydedildi!' : 'Gemini API key silindi', 'success');
            document.getElementById('geminiApiKey').value = '';
            checkGeminiStatus();
        }
    } catch (err) {
        showToast('API key kaydedilemedi', 'error');
    }
}
