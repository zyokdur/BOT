const express = require('express');
const router = express.Router();
const trendyolAPI = require('../services/trendyolAPI');
const priceCalculator = require('../services/priceCalculator');

// Bellek içi maliyet deposu
let productCosts = {};

// ========== ÜRÜNLER ==========

router.get('/products', async (req, res) => {
    try {
        const [products, commissionMap] = await Promise.all([
            trendyolAPI.getActiveProducts(),
            trendyolAPI.getCommissionRatesFromOrders().catch(err => {
                console.error('Komisyon verileri alinamadi:', err.message);
                return {};
            })
        ]);

        // Kategori bazlı fallback
        const categoryRates = {};
        products.forEach(p => {
            if (commissionMap[p.barcode] && p.categoryName) {
                if (!categoryRates[p.categoryName]) categoryRates[p.categoryName] = [];
                categoryRates[p.categoryName].push(commissionMap[p.barcode]);
            }
        });

        const categoryAvg = {};
        for (const [cat, rates] of Object.entries(categoryRates)) {
            categoryAvg[cat] = Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 10) / 10;
        }

        const productsWithData = products.map(p => {
            let commissionRate = 0;
            let commissionSource = 'varsayilan';

            if (commissionMap[p.barcode]) {
                commissionRate = commissionMap[p.barcode];
                commissionSource = 'siparis';
            } else if (commissionMap[p.stockCode]) {
                commissionRate = commissionMap[p.stockCode];
                commissionSource = 'siparis';
            } else if (categoryAvg[p.categoryName]) {
                commissionRate = categoryAvg[p.categoryName];
                commissionSource = 'kategori';
            } else {
                commissionRate = 20;
            }

            return {
                ...p,
                costPrice: productCosts[p.barcode] || 0,
                commissionRate,
                commissionSource
            };
        });

        const analysis = priceCalculator.analyzeMultipleProducts(productsWithData);
        res.json({ success: true, data: analysis });
    } catch (error) {
        console.error('Urun yukleme hatasi:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== ÜRÜN STRATEJİSİ ==========

router.post('/strategy', async (req, res) => {
    try {
        const { salePrice, costPrice, commissionRate, barcode } = req.body;

        const strategy = priceCalculator.generateStrategy({
            salePrice: parseFloat(salePrice) || 0,
            costPrice: parseFloat(costPrice) || 0,
            commissionRate: parseFloat(commissionRate) || 0,
            barcode: barcode || ''
        });

        if (!strategy) {
            return res.json({ success: false, error: 'Maliyet bilgisi gerekli' });
        }

        res.json({ success: true, data: strategy });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== ÜRÜN ARAŞTIRMA & ANALİZ ==========

router.post('/research', async (req, res) => {
    try {
        const { barcode, title, salePrice, categoryName, brand } = req.body;
        if (!title) return res.status(400).json({ success: false, error: 'Ürün başlığı gerekli' });

        // 1. Mağazadaki tüm ürünleri çek
        const allProducts = await trendyolAPI.getActiveProducts();

        // 2. Aynı kategorideki rakip ürünleri bul
        const categoryProducts = allProducts.filter(p =>
            p.categoryName === categoryName && p.barcode !== barcode
        );

        // 3. Tüm ürünleri fiyat karşılaştırması için kullan
        const competitorAnalysis = analyzeCompetitors(categoryProducts, salePrice, categoryName);

        // 4. Başlık analizi yap
        const titleAnalysis = analyzeTitleSEO(title, categoryProducts, categoryName, brand);

        res.json({
            success: true,
            data: {
                titleAnalysis,
                competitorAnalysis,
                productTitle: title,
                productPrice: salePrice,
                categoryName,
                totalCategoryProducts: categoryProducts.length
            }
        });
    } catch (error) {
        console.error('Arastirma hatasi:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== BAŞLIK ANALİZİ ==========
function analyzeTitleSEO(title, categoryProducts, categoryName, brand) {
    // Türkçe stop words
    const stopWords = new Set(['ve', 'ile', 'için', 'bir', 'bu', 'da', 'de', 'den', 'dan', 'mi', 'mu', 'mı', 'mü',
        'ki', 'ne', 'ya', 'hem', 'ama', 'fakat', 'veya', 'her', 'tüm', 'daha', 'en', 'çok', 'az', 'gibi',
        'kadar', 'adet', 'lü', 'li', 'lu', 'lı', 'set', 'seti', 'x']);

    // Mevcut başlıktaki kelimeler
    const titleWords = title.split(/[\s,\-\/\+\(\)]+/).filter(w => w.length > 1);
    const titleWordsLower = titleWords.map(w => w.toLowerCase());
    const meaningfulWords = titleWordsLower.filter(w => !stopWords.has(w) && isNaN(w));

    // Kategori ürünlerinin başlık kelime frekansı
    const wordFrequency = {};
    const competitorTitles = [];
    categoryProducts.forEach(p => {
        if (!p.title) return;
        competitorTitles.push(p.title);
        const words = p.title.split(/[\s,\-\/\+\(\)]+/).filter(w => w.length > 1);
        words.forEach(w => {
            const wl = w.toLowerCase();
            if (!stopWords.has(wl) && isNaN(wl)) {
                wordFrequency[wl] = (wordFrequency[wl] || 0) + 1;
            }
        });
    });

    // En popüler anahtar kelimeler (rakipler arasında)
    const popularKeywords = Object.entries(wordFrequency)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([word, count]) => ({
            word,
            count,
            usagePercent: categoryProducts.length > 0
                ? Math.round((count / categoryProducts.length) * 100) : 0,
            inYourTitle: titleWordsLower.includes(word)
        }));

    // Eksik anahtar kelimeler (rakiplerde var, sende yok)
    const missingKeywords = popularKeywords
        .filter(k => !k.inYourTitle && k.usagePercent >= 20)
        .slice(0, 8);

    // Başlık skorlama
    let score = 0;
    const issues = [];
    const tips = [];

    // 1. Uzunluk kontrolü
    if (title.length < 40) {
        issues.push({ type: 'warning', text: 'Başlık çok kısa (min 40 karakter önerilir)' });
    } else if (title.length > 150) {
        issues.push({ type: 'warning', text: 'Başlık çok uzun (max 150 karakter önerilir)' });
    } else {
        score += 15;
    }

    // 2. Marka kontrolü
    if (brand && title.toLowerCase().includes(brand.toLowerCase())) {
        score += 10;
    } else if (brand) {
        tips.push(`Marka adını ("${brand}") başlığa ekleyin`);
    }

    // 3. Kategori adı kontrolü
    if (categoryName && title.toLowerCase().includes(categoryName.toLowerCase())) {
        score += 15;
    } else if (categoryName) {
        tips.push(`Kategori adını ("${categoryName}") başlığa ekleyin`);
    }

    // 4. Anahtar kelime çeşitliliği
    const uniqueWords = new Set(meaningfulWords).size;
    if (uniqueWords >= 8) score += 15;
    else if (uniqueWords >= 5) score += 10;
    else {
        tips.push('Daha fazla açıklayıcı kelime ekleyin');
    }

    // 5. Popüler kelimeleri içerme oranı
    const matchedPopular = popularKeywords.filter(k => k.inYourTitle).length;
    const popularRatio = popularKeywords.length > 0 ? matchedPopular / Math.min(popularKeywords.length, 10) : 0;
    score += Math.round(popularRatio * 20);

    // 6. Rakam/miktar bilgisi
    const hasQuantity = /\d+\s*(adet|lü|li|lu|lı|paket|set|cm|mm|ml|gr|kg)/i.test(title);
    if (hasQuantity) {
        score += 10;
    } else {
        tips.push('Miktar/ölçü bilgisi ekleyin (örn: "3 Adet", "250ml")');
    }

    // 7. Özel karakter kontrolü
    const hasSpecialChars = /[!@#$%^&*{}|<>]/.test(title);
    if (hasSpecialChars) {
        issues.push({ type: 'error', text: 'Başlıkta özel karakterler var, kaldırın' });
    } else {
        score += 5;
    }

    // 8. Tekrar eden kelimeler
    const wordCounts = {};
    meaningfulWords.forEach(w => { wordCounts[w] = (wordCounts[w] || 0) + 1; });
    const duplicates = Object.entries(wordCounts).filter(([, c]) => c > 1).map(([w]) => w);
    if (duplicates.length > 0) {
        issues.push({ type: 'warning', text: `Tekrar eden kelimeler: ${duplicates.join(', ')}` });
    } else {
        score += 10;
    }

    // Minimum skor 5, maximum 100
    score = Math.min(100, Math.max(5, score));

    // Önerilen başlık oluştur
    let suggestedTitle = generateSuggestedTitle(title, missingKeywords, brand, categoryName, tips);

    return {
        currentTitle: title,
        titleLength: title.length,
        wordCount: titleWords.length,
        uniqueWordCount: uniqueWords,
        score,
        scoreLabel: score >= 80 ? 'Mükemmel' : score >= 60 ? 'İyi' : score >= 40 ? 'Orta' : 'Zayıf',
        scoreColor: score >= 80 ? '#00d68f' : score >= 60 ? '#4dabf7' : score >= 40 ? '#ffa94d' : '#ff6b6b',
        issues,
        tips,
        popularKeywords,
        missingKeywords,
        duplicateWords: duplicates,
        suggestedTitle,
        competitorTitleCount: competitorTitles.length
    };
}

function generateSuggestedTitle(currentTitle, missingKeywords, brand, categoryName, tips) {
    let parts = [];

    // Marka ile başla
    if (brand && !currentTitle.toLowerCase().startsWith(brand.toLowerCase())) {
        parts.push(brand);
    }

    // Mevcut başlığı ekle
    parts.push(currentTitle);

    // Eksik önemli kelimeleri ekle
    const addWords = missingKeywords
        .filter(k => k.usagePercent >= 30)
        .slice(0, 3)
        .map(k => k.word.charAt(0).toUpperCase() + k.word.slice(1));

    if (addWords.length > 0) {
        parts.push(addWords.join(' '));
    }

    let suggested = parts.join(' ');

    // 150 karaktere sığdır
    if (suggested.length > 150) {
        suggested = suggested.substring(0, 147) + '...';
    }

    return suggested;
}

// ========== REKABET ANALİZİ ==========
function analyzeCompetitors(categoryProducts, currentPrice, categoryName) {
    if (categoryProducts.length === 0) {
        return {
            hasData: false,
            message: `"${categoryName}" kategorisinde karşılaştırma yapılacak başka ürün bulunamadı.`,
            competitors: [],
            priceStats: null,
            pricePosition: null,
            recommendation: null
        };
    }

    // Fiyat istatistikleri
    const prices = categoryProducts.map(p => p.salePrice).filter(p => p > 0).sort((a, b) => a - b);
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    const medianPrice = prices[Math.floor(prices.length / 2)];
    const minPrice = prices[0];
    const maxPrice = prices[prices.length - 1];

    // Fiyat pozisyonu
    const cheaperCount = prices.filter(p => p < currentPrice).length;
    const position = prices.length > 0 ? Math.round((cheaperCount / prices.length) * 100) : 50;

    // En yakın 10 rakip (fiyata göre)
    const competitors = categoryProducts
        .filter(p => p.salePrice > 0)
        .map(p => ({
            title: p.title || '-',
            brand: p.brand || '-',
            salePrice: p.salePrice,
            listPrice: p.listPrice || p.salePrice,
            priceDiff: p.salePrice - currentPrice,
            priceDiffPercent: currentPrice > 0 ? Math.round(((p.salePrice - currentPrice) / currentPrice) * 100) : 0,
            hasDiscount: p.listPrice > p.salePrice,
            discountPercent: p.listPrice > p.salePrice
                ? Math.round(((p.listPrice - p.salePrice) / p.listPrice) * 100) : 0,
            imageUrl: p.images?.[0]?.url || ''
        }))
        .sort((a, b) => Math.abs(a.priceDiff) - Math.abs(b.priceDiff))
        .slice(0, 10);

    // Fiyat önerisi
    let recommendation = null;
    const priceDiffFromAvg = currentPrice - avgPrice;
    const diffPercent = avgPrice > 0 ? Math.round((priceDiffFromAvg / avgPrice) * 100) : 0;

    if (diffPercent > 20) {
        recommendation = {
            type: 'high',
            icon: '⚠️',
            text: `Fiyatınız kategori ortalamasından %${diffPercent} daha yüksek. Rekabet gücünü artırmak için ${formatMoney(avgPrice * 1.05)} - ${formatMoney(avgPrice * 1.15)} aralığına çekmeyi düşünün.`,
            suggestedPrice: Math.round(avgPrice * 1.10 * 100) / 100
        };
    } else if (diffPercent < -20) {
        recommendation = {
            type: 'low',
            icon: '💰',
            text: `Fiyatınız kategori ortalamasının %${Math.abs(diffPercent)} altında. Kâr marjınızı artırmak için fiyatı ${formatMoney(avgPrice * 0.90)} - ${formatMoney(avgPrice)} aralığına çekebilirsiniz.`,
            suggestedPrice: Math.round(avgPrice * 0.95 * 100) / 100
        };
    } else {
        recommendation = {
            type: 'good',
            icon: '✅',
            text: `Fiyatınız kategori ortalamasına yakın ve rekabetçi konumda. Mevcut fiyatınız makul görünüyor.`,
            suggestedPrice: currentPrice
        };
    }

    // Fiyat dağılım segmentleri
    const segments = [
        { label: 'Ucuz', range: `${formatMoney(minPrice)} - ${formatMoney(avgPrice * 0.7)}`, count: prices.filter(p => p < avgPrice * 0.7).length },
        { label: 'Orta-Alt', range: `${formatMoney(avgPrice * 0.7)} - ${formatMoney(avgPrice)}`, count: prices.filter(p => p >= avgPrice * 0.7 && p < avgPrice).length },
        { label: 'Orta-Üst', range: `${formatMoney(avgPrice)} - ${formatMoney(avgPrice * 1.3)}`, count: prices.filter(p => p >= avgPrice && p < avgPrice * 1.3).length },
        { label: 'Pahalı', range: `${formatMoney(avgPrice * 1.3)} - ${formatMoney(maxPrice)}`, count: prices.filter(p => p >= avgPrice * 1.3).length }
    ];

    return {
        hasData: true,
        competitors,
        priceStats: {
            avg: Math.round(avgPrice * 100) / 100,
            median: Math.round(medianPrice * 100) / 100,
            min: minPrice,
            max: maxPrice,
            count: prices.length
        },
        pricePosition: {
            percent: position,
            label: position <= 25 ? 'En Ucuzlar Arasında' : position <= 50 ? 'Ortalamanın Altında' : position <= 75 ? 'Ortalamanın Üstünde' : 'En Pahalılar Arasında',
            cheaperCount,
            expensiveCount: prices.length - cheaperCount
        },
        recommendation,
        segments
    };
}

function formatMoney(val) {
    return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 2 }).format(val || 0);
}

// ========== SATIŞLAR ==========

router.get('/sales', async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        // Türkiye saat dilimi: UTC+3
        const TZ_OFFSET = 3 * 60 * 60 * 1000; // 3 saat ms

        let start, end;
        if (startDate && endDate) {
            // "2026-02-14" → Türkiye'de o günün başlangıcı (UTC+3 00:00 = UTC 21:00 önceki gün)
            start = new Date(startDate).getTime() - TZ_OFFSET;
            end = new Date(endDate).getTime() - TZ_OFFSET + (24 * 60 * 60 * 1000 - 1);
        } else {
            // Varsayılan: bugün (Türkiye saati)
            const now = new Date(Date.now() + TZ_OFFSET);
            const todayStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}-${String(now.getUTCDate()).padStart(2,'0')}`;
            start = new Date(todayStr).getTime() - TZ_OFFSET;
            end = start + (24 * 60 * 60 * 1000 - 1);
        }

        // Trendyol API'ye daha geniş aralık gönder (çünkü API "son güncelleme" tarihine göre çalışır)
        // Sonra biz gerçek sipariş tarihine göre filtreleyeceğiz
        const apiStart = start - (7 * 24 * 60 * 60 * 1000); // 7 gün geriye git
        const orders = await trendyolAPI.getOrdersByDateRange(apiStart, end);

        const salesLines = [];
        let totalRevenue = 0;
        let totalShipping = 0;
        let totalCommission = 0;
        let totalCost = 0;
        let totalProfit = 0;
        let totalPlatformFee = 0;

        const filteredOrderNums = new Set();

        orders.forEach(order => {
            if (!order.lines) return;
            const orderTimestamp = typeof order.orderDate === 'number' ? order.orderDate : new Date(order.orderDate).getTime();

            // Gerçek sipariş oluşturma tarihine göre filtrele
            if (orderTimestamp < start || orderTimestamp > end) return;

            filteredOrderNums.add(order.orderNumber);
            const orderDate = new Date(orderTimestamp);
            // Türkiye saatine göre formatla (UTC+3)
            const trDate = new Date(orderTimestamp + TZ_OFFSET);
            const dateFormatted = `${String(trDate.getUTCDate()).padStart(2,'0')}.${String(trDate.getUTCMonth()+1).padStart(2,'0')}.${trDate.getUTCFullYear()} ${String(trDate.getUTCHours()).padStart(2,'0')}:${String(trDate.getUTCMinutes()).padStart(2,'0')}`;

            order.lines.forEach(line => {
                const costPrice = productCosts[line.barcode] || 0;
                const analysis = priceCalculator.analyzeOrderLine(line, costPrice);

                salesLines.push({
                    orderNumber: order.orderNumber,
                    orderDate: orderDate.toISOString(),
                    orderDateFormatted: dateFormatted,
                    status: line.orderLineItemStatusName,
                    barcode: line.barcode,
                    productName: line.productName,
                    quantity: line.quantity || 1,
                    salePrice: analysis.salePrice,
                    listPrice: analysis.listPrice,
                    costPrice,
                    commissionRate: analysis.commissionRate,
                    commissionAmount: analysis.commissionAmount,
                    shippingCost: analysis.shippingCost,
                    platformFee: analysis.platformFee,
                    totalDeductions: analysis.totalDeductions,
                    netProfit: analysis.netProfit
                });

                totalRevenue += analysis.salePrice * (line.quantity || 1);
                totalShipping += analysis.shippingCost;
                totalCommission += analysis.commissionAmount;
                totalCost += costPrice * (line.quantity || 1);
                totalProfit += analysis.netProfit;
                totalPlatformFee += analysis.platformFee;
            });
        });

        salesLines.sort((a, b) => new Date(b.orderDate) - new Date(a.orderDate));

        const summary = {
            totalOrders: filteredOrderNums.size,
            totalItems: salesLines.length,
            totalRevenue,
            totalShipping,
            totalCommission,
            totalPlatformFee,
            totalCost,
            totalProfit,
            totalDeductions: totalShipping + totalCommission + totalPlatformFee
        };

        res.json({ success: true, data: { sales: salesLines, summary } });
    } catch (error) {
        console.error('Satis yukleme hatasi:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== MALİYET ==========

router.post('/cost', (req, res) => {
    const { barcode, costPrice } = req.body;
    if (!barcode) return res.status(400).json({ success: false, error: 'Barkod gerekli' });

    if (costPrice > 0) {
        productCosts[barcode] = parseFloat(costPrice);
    } else {
        delete productCosts[barcode];
    }
    res.json({ success: true, costs: productCosts });
});

router.post('/costs/bulk', (req, res) => {
    const { costs } = req.body;
    if (!costs || typeof costs !== 'object') {
        return res.status(400).json({ success: false, error: 'Maliyetler objesi gerekli' });
    }
    for (const [barcode, price] of Object.entries(costs)) {
        if (price > 0) productCosts[barcode] = parseFloat(price);
        else delete productCosts[barcode];
    }
    res.json({ success: true, costs: productCosts });
});

router.get('/costs', (req, res) => {
    res.json({ success: true, costs: productCosts });
});

// ========== TEST ==========

router.get('/test', async (req, res) => {
    try {
        const products = await trendyolAPI.getProducts(0, 1);
        res.json({
            success: true,
            message: 'Trendyol API baglantisi basarili',
            sellerId: process.env.TRENDYOL_SELLER_ID,
            totalProducts: products.totalElements || 0
        });
    } catch (error) {
        res.json({
            success: false,
            message: 'API baglanti hatasi',
            error: error.message,
            statusCode: error.statusCode || 0,
            sellerId: process.env.TRENDYOL_SELLER_ID
        });
    }
});

module.exports = router;
