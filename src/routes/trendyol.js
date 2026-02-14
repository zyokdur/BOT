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
    // Türkçe stop words (genişletilmiş)
    const stopWords = new Set(['ve', 'ile', 'için', 'bir', 'bu', 'da', 'de', 'den', 'dan', 'mi', 'mu', 'mı', 'mü',
        'ki', 'ne', 'ya', 'hem', 'ama', 'fakat', 'veya', 'her', 'tüm', 'daha', 'en', 'çok', 'az', 'gibi',
        'kadar', 'adet', 'lü', 'li', 'lu', 'lı', 'set', 'seti', 'x', 'olan', 'olarak', 'the', 'of', 'and',
        'size', 'one', 'cm', 'mm', 'ml', 'lt', 'gr', 'kg', 'mt', 'adet']);

    // Mevcut başlıktaki kelimeler
    const titleWords = title.split(/[\s,\-\/\+\(\)]+/).filter(w => w.length > 1);
    const titleWordsLower = titleWords.map(w => w.toLowerCase());
    const meaningfulWords = titleWordsLower.filter(w => !stopWords.has(w) && isNaN(w));

    // Kategori ürünlerinin başlık kelime frekansı
    const wordFrequency = {};
    const competitorTitles = [];
    const bigramFrequency = {}; // 2-kelime çiftleri
    categoryProducts.forEach(p => {
        if (!p.title) return;
        competitorTitles.push(p.title);
        const words = p.title.split(/[\s,\-\/\+\(\)]+/).filter(w => w.length > 1);
        const wordsLower = words.map(w => w.toLowerCase());
        wordsLower.forEach((w, i) => {
            if (!stopWords.has(w) && isNaN(w)) {
                wordFrequency[w] = (wordFrequency[w] || 0) + 1;
            }
            // Bigram analizi
            if (i < wordsLower.length - 1) {
                const bigram = `${w} ${wordsLower[i + 1]}`;
                if (!stopWords.has(w) && !stopWords.has(wordsLower[i + 1])) {
                    bigramFrequency[bigram] = (bigramFrequency[bigram] || 0) + 1;
                }
            }
        });
    });

    // En popüler anahtar kelimeler (rakipler arasında)
    const popularKeywords = Object.entries(wordFrequency)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25)
        .map(([word, count]) => ({
            word,
            count,
            usagePercent: categoryProducts.length > 0
                ? Math.round((count / categoryProducts.length) * 100) : 0,
            inYourTitle: titleWordsLower.includes(word)
        }));

    // Popüler kelime çiftleri (bigrams)
    const popularBigrams = Object.entries(bigramFrequency)
        .filter(([, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([bigram, count]) => ({
            bigram,
            count,
            usagePercent: categoryProducts.length > 0
                ? Math.round((count / categoryProducts.length) * 100) : 0,
            inYourTitle: title.toLowerCase().includes(bigram)
        }));

    // Eksik anahtar kelimeler (rakiplerde var, sende yok)
    const missingKeywords = popularKeywords
        .filter(k => !k.inYourTitle && k.usagePercent >= 15)
        .slice(0, 10);

    // ========== GELİŞMİŞ BAŞLIK SKORLAMA (100 puan) ==========
    let score = 0;
    const issues = [];
    const tips = [];
    const scoreBreakdown = [];

    // 1. Uzunluk kontrolü (max 15 puan)
    if (title.length < 30) {
        issues.push({ type: 'error', text: `Başlık çok kısa (${title.length} karakter). Minimum 50 karakter önerilir` });
        scoreBreakdown.push({ label: 'Uzunluk', score: 0, max: 15 });
    } else if (title.length < 50) {
        score += 5;
        issues.push({ type: 'warning', text: `Başlık kısa (${title.length} karakter). 60-120 karakter ideal` });
        scoreBreakdown.push({ label: 'Uzunluk', score: 5, max: 15 });
    } else if (title.length > 150) {
        score += 5;
        issues.push({ type: 'warning', text: `Başlık çok uzun (${title.length} karakter). 120 karakteri geçmeyin` });
        scoreBreakdown.push({ label: 'Uzunluk', score: 5, max: 15 });
    } else if (title.length >= 60 && title.length <= 120) {
        score += 15;
        scoreBreakdown.push({ label: 'Uzunluk', score: 15, max: 15 });
    } else {
        score += 10;
        scoreBreakdown.push({ label: 'Uzunluk', score: 10, max: 15 });
    }

    // 2. Marka kontrolü (max 8 puan)
    if (brand && title.toLowerCase().includes(brand.toLowerCase())) {
        // Marka başta mı?
        if (title.toLowerCase().startsWith(brand.toLowerCase())) {
            score += 8;
            scoreBreakdown.push({ label: 'Marka', score: 8, max: 8 });
        } else {
            score += 5;
            tips.push('Marka adını başlığın başına koyun — Trendyol aramalarda buna öncelik verir');
            scoreBreakdown.push({ label: 'Marka', score: 5, max: 8 });
        }
    } else if (brand) {
        tips.push(`Marka adını ("${brand}") başlığın başına ekleyin`);
        scoreBreakdown.push({ label: 'Marka', score: 0, max: 8 });
    } else {
        score += 4; // Marka bilgisi yoksa cezalandırma
        scoreBreakdown.push({ label: 'Marka', score: 4, max: 8 });
    }

    // 3. Kategori anahtar kelimeleri (max 12 puan)
    if (categoryName) {
        const catWords = categoryName.toLowerCase().split(/[\s\/\-\&]+/).filter(w => w.length > 2);
        const matchedCatWords = catWords.filter(w => title.toLowerCase().includes(w));
        const catScore = catWords.length > 0 ? Math.round((matchedCatWords.length / catWords.length) * 12) : 6;
        score += catScore;
        if (matchedCatWords.length < catWords.length) {
            const missingCat = catWords.filter(w => !title.toLowerCase().includes(w));
            tips.push(`Kategori kelimeleri eksik: "${missingCat.join(', ')}"`);
        }
        scoreBreakdown.push({ label: 'Kategori', score: catScore, max: 12 });
    } else {
        score += 6;
        scoreBreakdown.push({ label: 'Kategori', score: 6, max: 12 });
    }

    // 4. Anahtar kelime çeşitliliği (max 12 puan)
    const uniqueWords = new Set(meaningfulWords).size;
    if (uniqueWords >= 10) { score += 12; scoreBreakdown.push({ label: 'Kelime Çeşitliliği', score: 12, max: 12 }); }
    else if (uniqueWords >= 7) { score += 10; scoreBreakdown.push({ label: 'Kelime Çeşitliliği', score: 10, max: 12 }); }
    else if (uniqueWords >= 5) { score += 7; scoreBreakdown.push({ label: 'Kelime Çeşitliliği', score: 7, max: 12 }); }
    else {
        score += 3;
        tips.push('Daha fazla açıklayıcı kelime ekleyin (renk, malzeme, kullanım alanı)');
        scoreBreakdown.push({ label: 'Kelime Çeşitliliği', score: 3, max: 12 });
    }

    // 5. Popüler kelimeleri içerme oranı (max 20 puan)
    const top10Popular = popularKeywords.slice(0, 10);
    const matchedPopular = top10Popular.filter(k => k.inYourTitle).length;
    const popularScore = top10Popular.length > 0 ? Math.round((matchedPopular / top10Popular.length) * 20) : 10;
    score += popularScore;
    scoreBreakdown.push({ label: 'Popüler Kelimeler', score: popularScore, max: 20 });

    // 6. Rakam/miktar/ölçü bilgisi (max 8 puan)
    const hasQuantity = /\d+\s*(adet|lü|li|lu|lı|paket|set|cm|mm|ml|gr|kg|metre|mt)/i.test(title);
    const hasSize = /\d+\s*[xX×]\s*\d+/i.test(title) || /\d+\s*(cm|mm|m)\b/i.test(title);
    if (hasQuantity && hasSize) {
        score += 8;
        scoreBreakdown.push({ label: 'Miktar/Ölçü', score: 8, max: 8 });
    } else if (hasQuantity || hasSize) {
        score += 5;
        tips.push(hasQuantity ? 'Boyut/ölçü bilgisi ekleyin' : 'Miktar bilgisi ekleyin (örn: "3 Adet", "250ml")');
        scoreBreakdown.push({ label: 'Miktar/Ölçü', score: 5, max: 8 });
    } else {
        tips.push('Miktar ve ölçü bilgisi ekleyin (örn: "2 Adet", "30x40 cm")');
        scoreBreakdown.push({ label: 'Miktar/Ölçü', score: 0, max: 8 });
    }

    // 7. Özel karakter & format kontrolü (max 10 puan)
    let formatScore = 10;
    const hasSpecialChars = /[!@#$%^&*{}|<>]/.test(title);
    const hasExcessiveCaps = (title.match(/[A-ZÇĞİÖŞÜ]{4,}/g) || []).length > 2;
    const hasExcessivePunctuation = /[,\-\/]{3,}/.test(title);
    
    if (hasSpecialChars) {
        formatScore -= 5;
        issues.push({ type: 'error', text: 'Başlıkta özel karakterler var (!@#$%^&*), kaldırın' });
    }
    if (hasExcessiveCaps) {
        formatScore -= 3;
        issues.push({ type: 'warning', text: 'Çok fazla büyük harf kullanılmış. Normal yazım tercih edin' });
    }
    if (hasExcessivePunctuation) {
        formatScore -= 2;
        issues.push({ type: 'warning', text: 'Gereksiz noktalama işaretleri var' });
    }
    score += Math.max(0, formatScore);
    scoreBreakdown.push({ label: 'Format', score: Math.max(0, formatScore), max: 10 });

    // 8. Tekrar eden kelimeler (max 5 puan)
    const wordCounts = {};
    meaningfulWords.forEach(w => { wordCounts[w] = (wordCounts[w] || 0) + 1; });
    const duplicates = Object.entries(wordCounts).filter(([, c]) => c > 1).map(([w]) => w);
    if (duplicates.length === 0) {
        score += 5;
        scoreBreakdown.push({ label: 'Tekrar Yok', score: 5, max: 5 });
    } else {
        issues.push({ type: 'warning', text: `Tekrar eden kelimeler: ${duplicates.join(', ')}` });
        scoreBreakdown.push({ label: 'Tekrar Yok', score: 0, max: 5 });
    }

    // 9. Barkod/stok kodu kontrolü (max 5 puan)
    const hasBarcodeInTitle = /TK-\d+|TYB[A-Z0-9]+|mer\d+/i.test(title);
    if (!hasBarcodeInTitle) {
        score += 5;
        scoreBreakdown.push({ label: 'Temiz Başlık', score: 5, max: 5 });
    } else {
        // Barkod başlıkta — ciddi SEO sorunu değil ama ideal değil
        score += 2;
        tips.push('Barkod/stok kodunu başlıktan kaldırmayı düşünün');
        scoreBreakdown.push({ label: 'Temiz Başlık', score: 2, max: 5 });
    }

    // 10. Rakip benzerlik analizi (max 5 puan)
    let avgSimilarity = 0;
    if (competitorTitles.length > 0) {
        const titleSet = new Set(meaningfulWords);
        const similarities = competitorTitles.map(ct => {
            const ctWords = new Set(ct.toLowerCase().split(/[\s,\-\/\+\(\)]+/).filter(w => w.length > 1 && !stopWords.has(w) && isNaN(w)));
            const intersection = [...titleSet].filter(w => ctWords.has(w)).length;
            const union = new Set([...titleSet, ...ctWords]).size;
            return union > 0 ? intersection / union : 0;
        });
        avgSimilarity = Math.round((similarities.reduce((a, b) => a + b, 0) / similarities.length) * 100);
        
        // %20-50 benzerlik ideal (çok düşük = alakasız, çok yüksek = kopya)
        if (avgSimilarity >= 20 && avgSimilarity <= 50) {
            score += 5;
            scoreBreakdown.push({ label: 'Rakip Uyumu', score: 5, max: 5 });
        } else if (avgSimilarity > 50) {
            score += 3;
            tips.push('Başlığınız rakiplerinkine çok benziyor — farklılaşmaya çalışın');
            scoreBreakdown.push({ label: 'Rakip Uyumu', score: 3, max: 5 });
        } else {
            score += 1;
            tips.push('Başlığınız kategorideki ürünlerden çok farklı — alakalı kelimeler ekleyin');
            scoreBreakdown.push({ label: 'Rakip Uyumu', score: 1, max: 5 });
        }
    } else {
        score += 3;
        scoreBreakdown.push({ label: 'Rakip Uyumu', score: 3, max: 5 });
    }

    // Minimum skor 5, maximum 100
    score = Math.min(100, Math.max(5, score));

    // Önerilen başlık oluştur
    let suggestedTitle = generateSuggestedTitle(title, missingKeywords, brand, categoryName, popularBigrams, duplicates);

    return {
        currentTitle: title,
        titleLength: title.length,
        wordCount: titleWords.length,
        uniqueWordCount: uniqueWords,
        score,
        scoreLabel: score >= 85 ? 'Mükemmel' : score >= 70 ? 'İyi' : score >= 50 ? 'Orta' : score >= 30 ? 'Zayıf' : 'Kritik',
        scoreColor: score >= 85 ? '#00d68f' : score >= 70 ? '#4dabf7' : score >= 50 ? '#ffa94d' : '#ff6b6b',
        issues,
        tips,
        scoreBreakdown,
        popularKeywords,
        popularBigrams,
        missingKeywords,
        duplicateWords: duplicates,
        avgSimilarity,
        suggestedTitle,
        competitorTitleCount: competitorTitles.length
    };
}

function generateSuggestedTitle(currentTitle, missingKeywords, brand, categoryName, popularBigrams, duplicates) {
    let parts = [];

    // 1. Marka ile başla (Trendyol SEO kuralı)
    const titleLower = currentTitle.toLowerCase();
    if (brand && !titleLower.startsWith(brand.toLowerCase())) {
        // Markayı mevcut başlıktan kaldır (varsa ortada/sonda)
        let cleaned = currentTitle;
        if (titleLower.includes(brand.toLowerCase())) {
            const regex = new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
            cleaned = cleaned.replace(regex, '').replace(/\s{2,}/g, ' ').trim();
        }
        parts.push(brand);
        parts.push(cleaned);
    } else {
        parts.push(currentTitle);
    }

    // 2. Tekrar eden kelimeleri kaldır
    if (duplicates.length > 0) {
        let combined = parts.join(' ');
        duplicates.forEach(dup => {
            const regex = new RegExp(`(\\b${dup.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b)(.+)\\1`, 'gi');
            combined = combined.replace(regex, '$1$2');
        });
        parts = [combined.replace(/\s{2,}/g, ' ').trim()];
    }

    // 3. Barkod/stok kodu kaldır
    let combined = parts.join(' ');
    combined = combined.replace(/\s*TK-\d+[A-Z]*/gi, '').replace(/\s*TYB[A-Z0-9]+/gi, '').replace(/\s*mer\d+/gi, '');
    combined = combined.replace(/,\s*one\s*size/gi, '').replace(/\s{2,}/g, ' ').trim();

    // 4. Eksik popüler kelimeleri akıllıca ekle
    const addWords = missingKeywords
        .filter(k => k.usagePercent >= 25 && !combined.toLowerCase().includes(k.word))
        .slice(0, 4)
        .map(k => k.word.charAt(0).toUpperCase() + k.word.slice(1));

    if (addWords.length > 0) {
        combined += ' ' + addWords.join(' ');
    }

    // 5. 120 karaktere sığdır (Trendyol ideal)
    if (combined.length > 120) {
        // Son kelimeleri kes (120'ye yakın kelime sınırında)
        const words = combined.split(' ');
        combined = '';
        for (const w of words) {
            if ((combined + ' ' + w).trim().length > 118) break;
            combined = (combined + ' ' + w).trim();
        }
    }

    return combined;
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

    // Standart sapma
    const variance = prices.reduce((sum, p) => sum + Math.pow(p - avgPrice, 2), 0) / prices.length;
    const stdDev = Math.sqrt(variance);

    // Fiyat pozisyonu
    const cheaperCount = prices.filter(p => p < currentPrice).length;
    const position = prices.length > 0 ? Math.round((cheaperCount / prices.length) * 100) : 50;

    // İndirim analizi
    const discountedProducts = categoryProducts.filter(p => p.listPrice > p.salePrice && p.salePrice > 0);
    const discountStats = {
        count: discountedProducts.length,
        percent: categoryProducts.length > 0 ? Math.round((discountedProducts.length / categoryProducts.length) * 100) : 0,
        avgDiscount: discountedProducts.length > 0
            ? Math.round(discountedProducts.reduce((sum, p) => sum + ((p.listPrice - p.salePrice) / p.listPrice * 100), 0) / discountedProducts.length)
            : 0
    };

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

    // Akıllı fiyat önerisi (kargo baremi optimizasyonu dahil)
    let recommendation = null;
    const priceDiffFromAvg = currentPrice - avgPrice;
    const diffPercent = avgPrice > 0 ? Math.round((priceDiffFromAvg / avgPrice) * 100) : 0;

    // Kargo barem eşikleri
    const shippingThresholds = [
        { max: 149.99, cost: 58.50, label: 'En düşük kargo' },
        { max: 299.99, cost: 95.50, label: 'Orta kargo' },
        { max: 399.99, cost: 110, label: 'Yüksek kargo' },
        { max: Infinity, cost: 130, label: 'En yüksek kargo' }
    ];
    const currentShippingTier = shippingThresholds.find(t => currentPrice <= t.max);

    // Barem optimizasyonu: Eşiğin hemen üstündeyse düşürmeyi öner
    let shippingOptimization = null;
    if (currentPrice > 150 && currentPrice <= 165) {
        shippingOptimization = { targetPrice: 149.99, saving: 95.50 - 58.50, text: 'Kargo baremi fırsatı! ₺149.99\'a düşürerek kargo ₺37 azalır' };
    } else if (currentPrice > 300 && currentPrice <= 320) {
        shippingOptimization = { targetPrice: 299.99, saving: 110 - 95.50, text: 'Kargo baremi fırsatı! ₺299.99\'a düşürerek kargo ₺14.50 azalır' };
    }

    if (diffPercent > 25) {
        recommendation = {
            type: 'high',
            icon: '⚠️',
            text: `Fiyatınız kategori ortalamasından %${diffPercent} daha yüksek. Satış hızını artırmak için ${formatMoney(avgPrice * 1.05)} - ${formatMoney(avgPrice * 1.15)} aralığına çekmeyi düşünün.`,
            suggestedPrice: Math.round(avgPrice * 1.10 * 100) / 100,
            details: `Medyan fiyat: ${formatMoney(medianPrice)}. Rakiplerin %${100 - position}'i sizden ucuz satıyor.`
        };
    } else if (diffPercent < -25) {
        recommendation = {
            type: 'low',
            icon: '💰',
            text: `Fiyatınız kategori ortalamasının %${Math.abs(diffPercent)} altında. Kâr marjınızı artırmak için fiyatı ${formatMoney(avgPrice * 0.85)} - ${formatMoney(avgPrice * 0.95)} aralığına çekebilirsiniz.`,
            suggestedPrice: Math.round(avgPrice * 0.92 * 100) / 100,
            details: `Sadece ${cheaperCount} ürün sizden ucuz. Fiyat artırma potansiyeliniz var.`
        };
    } else {
        recommendation = {
            type: 'good',
            icon: '✅',
            text: `Fiyatınız kategori ortalamasına yakın ve rekabetçi konumda.`,
            suggestedPrice: currentPrice,
            details: `${cheaperCount} ürün sizden ucuz, ${prices.length - cheaperCount} ürün sizden pahalı.`
        };
    }

    // Fiyat dağılım segmentleri
    const q1 = prices[Math.floor(prices.length * 0.25)] || minPrice;
    const q3 = prices[Math.floor(prices.length * 0.75)] || maxPrice;
    const segments = [
        { label: 'Ucuz', range: `${formatMoney(minPrice)} - ${formatMoney(q1)}`, count: prices.filter(p => p <= q1).length },
        { label: 'Orta-Alt', range: `${formatMoney(q1)} - ${formatMoney(medianPrice)}`, count: prices.filter(p => p > q1 && p <= medianPrice).length },
        { label: 'Orta-Üst', range: `${formatMoney(medianPrice)} - ${formatMoney(q3)}`, count: prices.filter(p => p > medianPrice && p <= q3).length },
        { label: 'Pahalı', range: `${formatMoney(q3)} - ${formatMoney(maxPrice)}`, count: prices.filter(p => p > q3).length }
    ];

    return {
        hasData: true,
        competitors,
        priceStats: {
            avg: Math.round(avgPrice * 100) / 100,
            median: Math.round(medianPrice * 100) / 100,
            min: minPrice,
            max: maxPrice,
            count: prices.length,
            stdDev: Math.round(stdDev * 100) / 100
        },
        pricePosition: {
            percent: position,
            label: position <= 25 ? 'En Ucuzlar Arasında' : position <= 50 ? 'Ortalamanın Altında' : position <= 75 ? 'Ortalamanın Üstünde' : 'En Pahalılar Arasında',
            cheaperCount,
            expensiveCount: prices.length - cheaperCount
        },
        discountStats,
        shippingOptimization,
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
