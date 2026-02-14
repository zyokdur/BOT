const express = require('express');
const router = express.Router();
const trendyolAPI = require('../services/trendyolAPI');
const priceCalculator = require('../services/priceCalculator');
const geminiAI = require('../services/geminiAI');
const trendyolSearch = require('../services/trendyolSearch');

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
        const { barcode, title, salePrice, categoryName, brand, costPrice } = req.body;
        if (!title) return res.status(400).json({ success: false, error: 'Ürün başlığı gerekli' });

        // 1. Paralel olarak: Mağaza ürünleri + Trendyol arama sonuçları
        const [allProducts, trendyolData] = await Promise.all([
            trendyolAPI.getActiveProducts(),
            trendyolSearch.findCompetitorsFromSearch(title, categoryName, 10).catch(err => {
                console.error('Trendyol arama hatasi:', err.message);
                return { products: [], keywords: [], searchQuery: '' };
            })
        ]);

        // 2. Aynı kategorideki mağaza ürünlerini bul
        const categoryProducts = [];
        const seenBarcodes = new Set([barcode]);

        allProducts.forEach(p => {
            if (!seenBarcodes.has(p.barcode) && p.categoryName === categoryName) {
                categoryProducts.push(p);
                seenBarcodes.add(p.barcode);
            }
        });

        if (categoryProducts.length < 5 && categoryName) {
            const catWords = categoryName.toLowerCase().split(/[\s\/\-\&]+/).filter(w => w.length > 2);
            allProducts.forEach(p => {
                if (seenBarcodes.has(p.barcode) || !p.categoryName) return;
                const pCatWords = p.categoryName.toLowerCase().split(/[\s\/\-\&]+/).filter(w => w.length > 2);
                if (catWords.filter(w => pCatWords.includes(w)).length >= 1) {
                    categoryProducts.push({ ...p, relatedCategory: true });
                    seenBarcodes.add(p.barcode);
                }
            });
        }

        // 3. Trendyol arama sonuçlarından ilk 5 rakip
        const trendyolCompetitors = (trendyolData.products || []).slice(0, 5);
        const trendyolKeywords = trendyolData.keywords || [];

        // 4. Fiyat karşılaştırması (mağaza ürünleri)
        const competitorAnalysis = analyzeCompetitors(categoryProducts, salePrice, categoryName, costPrice, barcode);

        // 5. Başlık analizi (Trendyol arama verileriyle zenginleştirilmiş)
        const titleAnalysis = analyzeTitleSEO(title, categoryProducts, categoryName, brand, trendyolCompetitors, trendyolKeywords);

        // 6. AI analizi (Gemini)
        let aiAnalysis = null;
        let aiSuggestedTitle = null;
        try {
            if (geminiAI.isConfigured()) {
                // Rakip başlıkları: Trendyol arama sonuçları öncelikli
                const competitorTitles = [
                    ...trendyolCompetitors.map(p => p.name),
                    ...categoryProducts.slice(0, 5).map(p => p.title)
                ].filter(Boolean).slice(0, 10);

                const [aiTitle, aiInsights] = await Promise.all([
                    geminiAI.generateTitleSuggestion(
                        title, categoryName, brand,
                        titleAnalysis.popularKeywords,
                        competitorTitles,
                        trendyolKeywords
                    ).catch(err => {
                        console.error('AI baslik hatasi:', err.message);
                        return null;
                    }),
                    geminiAI.analyzeProductWithAI(
                        title, categoryName, brand, salePrice,
                        competitorAnalysis.hasData ? {
                            avgPrice: competitorAnalysis.priceStats.avg,
                            count: competitorAnalysis.priceStats.count
                        } : null
                    ).catch(err => {
                        console.error('AI analiz hatasi:', err.message);
                        return null;
                    })
                ]);
                aiSuggestedTitle = aiTitle;
                aiAnalysis = aiInsights;
            }
        } catch (aiErr) {
            console.error('AI genel hata:', aiErr.message);
        }

        res.json({
            success: true,
            data: {
                titleAnalysis,
                competitorAnalysis,
                trendyolSearch: {
                    competitors: trendyolCompetitors,
                    keywords: trendyolKeywords,
                    searchQuery: trendyolData.searchQuery || '',
                    totalResults: trendyolData.totalCount || 0
                },
                aiSuggestedTitle,
                aiAnalysis,
                aiEnabled: geminiAI.isConfigured(),
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
function analyzeTitleSEO(title, categoryProducts, categoryName, brand, trendyolCompetitors, trendyolKeywords) {
    trendyolCompetitors = trendyolCompetitors || [];
    trendyolKeywords = trendyolKeywords || [];
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
    // NOT: Marka ve Kategori puanlaması kaldırıldı — Trendyol bunları ürün ekleme sırasında
    // otomatik olarak ekliyor, başlığa yazılması gerekmiyor.
    let score = 0;
    const issues = [];
    const tips = [];
    const scoreBreakdown = [];

    // 1. Uzunluk kontrolü (max 20 puan) — Trendyol ideal: 60-120 karakter
    if (title.length < 30) {
        issues.push({ type: 'error', text: `Başlık çok kısa (${title.length} karakter). Minimum 50 karakter önerilir` });
        scoreBreakdown.push({ label: 'Uzunluk', score: 0, max: 20 });
    } else if (title.length < 50) {
        score += 7;
        issues.push({ type: 'warning', text: `Başlık kısa (${title.length} karakter). 60-120 karakter ideal` });
        scoreBreakdown.push({ label: 'Uzunluk', score: 7, max: 20 });
    } else if (title.length > 150) {
        score += 7;
        issues.push({ type: 'warning', text: `Başlık çok uzun (${title.length} karakter). 120 karakteri geçmeyin` });
        scoreBreakdown.push({ label: 'Uzunluk', score: 7, max: 20 });
    } else if (title.length >= 60 && title.length <= 120) {
        score += 20;
        scoreBreakdown.push({ label: 'Uzunluk', score: 20, max: 20 });
    } else {
        score += 14;
        scoreBreakdown.push({ label: 'Uzunluk', score: 14, max: 20 });
    }

    // 2. Anahtar kelime çeşitliliği (max 15 puan)
    const uniqueWords = new Set(meaningfulWords).size;
    if (uniqueWords >= 10) { score += 15; scoreBreakdown.push({ label: 'Kelime Çeşitliliği', score: 15, max: 15 }); }
    else if (uniqueWords >= 7) { score += 12; scoreBreakdown.push({ label: 'Kelime Çeşitliliği', score: 12, max: 15 }); }
    else if (uniqueWords >= 5) { score += 8; scoreBreakdown.push({ label: 'Kelime Çeşitliliği', score: 8, max: 15 }); }
    else {
        score += 3;
        tips.push('Daha fazla açıklayıcı kelime ekleyin (renk, malzeme, kullanım alanı)');
        scoreBreakdown.push({ label: 'Kelime Çeşitliliği', score: 3, max: 15 });
    }

    // 3. Popüler kelimeleri içerme oranı (max 20 puan)
    const top10Popular = popularKeywords.slice(0, 10);
    const matchedPopular = top10Popular.filter(k => k.inYourTitle).length;
    const popularScore = top10Popular.length > 0 ? Math.round((matchedPopular / top10Popular.length) * 20) : 10;
    score += popularScore;
    scoreBreakdown.push({ label: 'Popüler Kelimeler', score: popularScore, max: 20 });

    // 4. Ürün tanımlayıcı bilgiler (max 15 puan) — renk, malzeme, kullanım alanı, özellik
    const hasColor = /\b(siyah|beyaz|kırmızı|mavi|yeşil|gri|kahve|bej|pembe|turuncu|sarı|mor|lacivert|krem|antrasit|gümüş|altın|gold|silver|black|white|red|blue)\b/i.test(title);
    const hasMaterial = /\b(ahşap|metal|plastik|cam|seramik|porselen|bambu|deri|kumaş|kadife|polyester|pamuk|paslanmaz|çelik|silikon|doğal|organik|mermer|granit)\b/i.test(title);
    const hasUsageArea = /\b(mutfak|banyo|salon|yatak|ofis|bahçe|outdoor|ev|masa|duvar|kapı|araba|bebek|çocuk|kadın|erkek|unisex|günlük|spor)\b/i.test(title);
    let descriptorScore = 0;
    if (hasColor) descriptorScore += 5;
    else tips.push('Renk bilgisi ekleyin (örn: Siyah, Beyaz, Doğal Ahşap)');
    if (hasMaterial) descriptorScore += 5;
    else tips.push('Malzeme/materyal bilgisi ekleyin (örn: Ahşap, Metal, Cam)');
    if (hasUsageArea) descriptorScore += 5;
    else tips.push('Kullanım alanı ekleyin (örn: Mutfak, Salon, Ofis)');
    score += descriptorScore;
    scoreBreakdown.push({ label: 'Ürün Tanımlama', score: descriptorScore, max: 15 });

    // 5. Rakam/miktar/ölçü bilgisi (max 10 puan)
    const hasQuantity = /\d+\s*(adet|lü|li|lu|lı|paket|set|cm|mm|ml|gr|kg|metre|mt)/i.test(title);
    const hasSize = /\d+\s*[xX×]\s*\d+/i.test(title) || /\d+\s*(cm|mm|m)\b/i.test(title);
    if (hasQuantity && hasSize) {
        score += 10;
        scoreBreakdown.push({ label: 'Miktar/Ölçü', score: 10, max: 10 });
    } else if (hasQuantity || hasSize) {
        score += 6;
        tips.push(hasQuantity ? 'Boyut/ölçü bilgisi ekleyin' : 'Miktar bilgisi ekleyin (örn: "3 Adet", "250ml")');
        scoreBreakdown.push({ label: 'Miktar/Ölçü', score: 6, max: 10 });
    } else {
        tips.push('Miktar ve ölçü bilgisi ekleyin (örn: "2 Adet", "30x40 cm")');
        scoreBreakdown.push({ label: 'Miktar/Ölçü', score: 0, max: 10 });
    }

    // 6. Özel karakter & format kontrolü (max 10 puan)
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

    // 7. Tekrar eden kelimeler (max 5 puan)
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

    // 8. Barkod/stok kodu kontrolü (max 5 puan)
    const hasBarcodeInTitle = /TK-\d+|TYB[A-Z0-9]+|mer\d+/i.test(title);
    if (!hasBarcodeInTitle) {
        score += 5;
        scoreBreakdown.push({ label: 'Temiz Başlık', score: 5, max: 5 });
    } else {
        score += 2;
        tips.push('Barkod/stok kodunu başlıktan kaldırmayı düşünün');
        scoreBreakdown.push({ label: 'Temiz Başlık', score: 2, max: 5 });
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
        suggestedTitle,
        competitorTitleCount: competitorTitles.length
    };
}

function generateSuggestedTitle(currentTitle, missingKeywords, brand, categoryName, popularBigrams, duplicates) {
    // NOT: Marka eklenmez — Trendyol ürün ekleme sırasında markayı otomatik ekler.
    // NOT: Kategori adı eklenmez — Trendyol bunu da otomatik ekler.

    let combined = currentTitle;

    // 1. Markayı başlıktan kaldır (zaten Trendyol ekliyor)
    if (brand) {
        const regex = new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
        combined = combined.replace(regex, '').replace(/\s{2,}/g, ' ').trim();
    }

    // 2. Tekrar eden kelimeleri kaldır
    if (duplicates.length > 0) {
        duplicates.forEach(dup => {
            const regex = new RegExp(`(\\b${dup.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b)(.+)\\1`, 'gi');
            combined = combined.replace(regex, '$1$2');
        });
        combined = combined.replace(/\s{2,}/g, ' ').trim();
    }

    // 3. Barkod/stok kodu kaldır
    combined = combined.replace(/\s*TK-\d+[A-Z]*/gi, '').replace(/\s*TYB[A-Z0-9]+/gi, '').replace(/\s*mer\d+/gi, '');
    combined = combined.replace(/,\s*one\s*size/gi, '').replace(/\s{2,}/g, ' ').trim();

    // 4. Akıllı kelime ekleme — sadece ürünle ALAKALI kelimeleri ekle
    // Mevcut başlıktaki anlamlı kelimeleri çıkar
    const stopWords = new Set(['ve', 'ile', 'için', 'bir', 'bu', 'da', 'de', 'den', 'dan', 'mi', 'mu', 'mı', 'mü',
        'ki', 'ne', 'ya', 'hem', 'ama', 'fakat', 'veya', 'her', 'tüm', 'daha', 'en', 'çok', 'az', 'gibi',
        'kadar', 'adet', 'lü', 'li', 'lu', 'lı', 'set', 'seti', 'x', 'olan', 'olarak', 'the', 'of', 'and',
        'size', 'one', 'cm', 'mm', 'ml', 'lt', 'gr', 'kg', 'mt', 'adet']);

    const currentWords = new Set(combined.toLowerCase().split(/[\s,\-\/\+\(\)]+/).filter(w => w.length > 1 && !stopWords.has(w)));

    // Alakalılık kontrolü: Sadece mevcut başlıkla semantik olarak ilişkili kelimeleri ekle
    // Kelime, başlıktaki EN AZ BİR kelimeyle aynı kategoride olmalı
    const descriptorPatterns = {
        renk: /^(siyah|beyaz|kırmızı|mavi|yeşil|gri|kahve|bej|pembe|turuncu|sarı|mor|lacivert|krem|antrasit|gümüş|altın|gold|silver|black|white|red|blue|natural|doğal)$/i,
        malzeme: /^(ahşap|metal|plastik|cam|seramik|porselen|bambu|deri|kumaş|kadife|polyester|pamuk|paslanmaz|çelik|silikon|mermer|granit|kristal|akrilik)$/i,
        boyut: /^(büyük|küçük|mini|jumbo|xl|xxl|boy|beden|numara|standart|geniş|dar|uzun|kısa|orta|ince|kalın)$/i,
        miktar: /^\d+(lu|li|lü|lı)$|^(tekli|ikili|üçlü|dörtlü|beşli|altılı|çoklu)$/i
    };

    // Sadece ürün tanımlayıcı (renk, malzeme, boyut, miktar) kelimeleri ekle
    // %50+ kullanım oranı olan çok popüler kelimeleri ekle — daha konservatif
    const safeKeywords = missingKeywords.filter(k => {
        const word = k.word.toLowerCase();
        // Marka ise ekleme
        if (brand && word === brand.toLowerCase()) return false;
        // Çok kısa kelimeler ekleme
        if (word.length < 3) return false;
        // Başlıktaki hiçbir kelimeyle alakası yoksa ekleme
        // Kelime, mevcut başlık kelimeleriyle en az bir harf çakışması olmalı (aynı kök)
        const hasRelation = [...currentWords].some(cw => {
            if (cw.length < 3 || word.length < 3) return false;
            return cw.includes(word.substring(0, 3)) || word.includes(cw.substring(0, 3));
        });
        // Ürün tanımlayıcı mı kontrol et
        const isDescriptor = Object.values(descriptorPatterns).some(p => p.test(word));
        if (isDescriptor) return true;
        // %50+ kullanım oranı VE kelime çok yaygınsa (güvenli) VE başlıkla ilişkili
        if (k.usagePercent >= 50 && hasRelation) return true;
        return false;
    });

    const addWords = safeKeywords
        .filter(k => !combined.toLowerCase().includes(k.word))
        .slice(0, 2)
        .map(k => k.word.charAt(0).toUpperCase() + k.word.slice(1));

    if (addWords.length > 0) {
        combined += ' ' + addWords.join(' ');
    }

    // 5. 120 karaktere sığdır (Trendyol ideal)
    if (combined.length > 120) {
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
function analyzeCompetitors(categoryProducts, currentPrice, categoryName, costPrice, barcode) {
    // Başa baş fiyat hesapla
    let breakEvenPrice = null;
    const productCost = costPrice || (barcode ? productCosts[barcode] : 0) || 0;
    if (productCost > 0) {
        // Başa baş = maliyet + kargo + komisyon + platform ücreti = satış fiyatı
        // Net kâr = 0 olacak fiyatı bul (iteratif)
        const platformFee = 13.80;
        const shippingRanges = [
            { min: 0, max: 149.99, cost: 58.50 },
            { min: 150, max: 299.99, cost: 95.50 },
            { min: 300, max: 399.99, cost: 110 },
            { min: 400, max: Infinity, cost: 130 }
        ];
        const commRate = 20; // varsayılan komisyon
        
        // İteratif hesaplama
        let bePrice = productCost + platformFee + 58.50; // başlangıç tahmini
        for (let i = 0; i < 20; i++) {
            const shipping = (shippingRanges.find(r => bePrice >= r.min && bePrice <= r.max) || { cost: 130 }).cost;
            const newPrice = (productCost + platformFee + shipping) / (1 - commRate / 100);
            if (Math.abs(newPrice - bePrice) < 0.01) break;
            bePrice = newPrice;
        }
        breakEvenPrice = Math.ceil(bePrice * 100) / 100;
    }

    if (categoryProducts.length === 0) {
        return {
            hasData: false,
            message: `"${categoryName}" kategorisinde karşılaştırma yapılacak başka ürün bulunamadı.`,
            competitors: [],
            priceStats: null,
            pricePosition: null,
            recommendation: null,
            breakEvenPrice
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
        .slice(0, 20);

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
        segments,
        breakEvenPrice
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

// ========== TREND KEŞİF ==========

router.get('/trend-discovery', async (req, res) => {
    try {
        const { query } = req.query;
        
        // Popüler/trend arama terimleri
        const trendQueries = query ? [query] : [
            'çok satan ürünler', 'trend ürünler', 'indirimli ürünler',
            'ev dekorasyon', 'mutfak gereçleri', 'organik ürünler',
            'hediye', 'aksesuar', 'teknoloji'
        ];
        
        // Her arama terimi için Trendyol'dan veri çek
        const results = [];
        
        if (query) {
            // Tek bir arama terimi ile arama yap
            const [searchResult, suggestions] = await Promise.all([
                trendyolSearch.searchProducts(query, 10),
                trendyolSearch.getSearchSuggestions(query)
            ]);
            
            results.push({
                query: query,
                products: searchResult.products || [],
                totalCount: searchResult.totalCount || 0,
                suggestions: suggestions || []
            });
        } else {
            // Birden fazla trend arama
            const searchPromises = trendQueries.slice(0, 5).map(async q => {
                try {
                    const [searchResult, suggestions] = await Promise.all([
                        trendyolSearch.searchProducts(q, 5),
                        trendyolSearch.getSearchSuggestions(q)
                    ]);
                    return {
                        query: q,
                        products: searchResult.products || [],
                        totalCount: searchResult.totalCount || 0,
                        suggestions: suggestions || []
                    };
                } catch (err) {
                    return { query: q, products: [], totalCount: 0, suggestions: [] };
                }
            });
            
            const searchResults = await Promise.all(searchPromises);
            results.push(...searchResults);
        }
        
        // AI trend analizi (opsiyonel)
        let aiTrendAnalysis = null;
        if (geminiAI.isConfigured() && query) {
            try {
                const topProducts = results[0]?.products?.slice(0, 5) || [];
                const productSummary = topProducts.map(p => 
                    `${p.name} - ${p.brand} - ₺${p.price} - ⭐${p.ratingScore}`
                ).join('\n');
                
                const prompt = `Trendyol'da "${query}" aramasının ilk 5 sonucu:
${productSummary}

Bu verilerden yola çıkarak kısaca analiz et (Türkçe, 3-4 cümle):
1. Bu kategoride hangi fiyat aralığı başarılı?
2. Bu ürünlere talep ne durumda?
3. Yeni satıcılar için fırsat var mı?`;
                
                const response = await require('axios').post(
                    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
                    { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.7, maxOutputTokens: 300 } },
                    { timeout: 15000, headers: { 'Content-Type': 'application/json' } }
                );
                aiTrendAnalysis = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
            } catch (err) {
                console.error('AI trend analiz hatasi:', err.message);
            }
        }
        
        res.json({
            success: true,
            data: {
                results,
                aiTrendAnalysis,
                aiEnabled: geminiAI.isConfigured(),
                searchedAt: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Trend kesif hatasi:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== TREND ARAMA ÖNERİLERİ ==========

router.get('/search-suggest', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.length < 2) return res.json({ success: true, data: [] });
        
        const suggestions = await trendyolSearch.getSearchSuggestions(q);
        res.json({ success: true, data: suggestions });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== AYARLAR ==========

router.post('/settings/gemini', (req, res) => {
    const { apiKey } = req.body;
    if (apiKey) {
        process.env.GEMINI_API_KEY = apiKey;
        res.json({ success: true, message: 'Gemini API key kaydedildi' });
    } else {
        delete process.env.GEMINI_API_KEY;
        res.json({ success: true, message: 'Gemini API key silindi' });
    }
});

router.get('/settings/gemini', (req, res) => {
    res.json({
        success: true,
        configured: geminiAI.isConfigured(),
        maskedKey: process.env.GEMINI_API_KEY
            ? '***' + process.env.GEMINI_API_KEY.slice(-6)
            : null
    });
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
