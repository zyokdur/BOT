const axios = require('axios');

/**
 * Trendyol Public Search API
 * Çalışan endpoint: apigw.trendyol.com
 */

const SEARCH_URL = 'https://apigw.trendyol.com/discovery-web-searchgw-service/v2/api/infinite-scroll/sr';

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
    'Origin': 'https://www.trendyol.com',
    'Referer': 'https://www.trendyol.com/',
    'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site'
};

/**
 * Trendyol'da ürün ara ve ilk N sonucu döndür
 */
async function searchProducts(query, limit = 10) {
    if (!query || query.trim().length < 2) return { products: [], totalCount: 0, query: query || '' };

    try {
        const response = await axios.get(SEARCH_URL, {
            params: {
                q: query.trim(),
                pi: 1,
                culture: 'tr-TR',
                storefrontId: 1,
                pId: 0
            },
            headers: HEADERS,
            timeout: 15000
        });

        const data = response.data;
        const products = [];

        if (data?.result?.products) {
            data.result.products.slice(0, limit).forEach(p => {
                products.push({
                    id: p.id,
                    name: p.name || '',
                    brand: p.brand?.name || '',
                    price: p.price?.sellingPrice || p.price?.discountedPrice || 0,
                    originalPrice: p.price?.originalPrice || 0,
                    discountRatio: p.price?.discountRatio || 0,
                    categoryName: p.categoryName || '',
                    categoryHierarchy: p.categoryHierarchy || '',
                    ratingScore: p.ratingScore?.averageRating || 0,
                    ratingCount: p.ratingScore?.totalCount || 0,
                    favoriteCount: parseInt(p.socialProof?.favoriteCount?.count) || 0,
                    url: p.url ? `https://www.trendyol.com${p.url}` : '',
                    imageUrl: p.images?.[0] ? `https://cdn.dsmcdn.com${p.images[0]}` : '',
                    merchantName: p.merchantName || '',
                    freeCargo: p.freeCargo || false
                });
            });
        }

        const totalCount = data?.result?.totalCount || products.length;

        return { products, totalCount, query: query.trim() };
    } catch (error) {
        console.error('Trendyol search hatasi:', error.message);
        return { products: [], totalCount: 0, query: query.trim() };
    }
}

/**
 * Arama sonuçlarındaki ürün başlıklarından anahtar kelime önerileri çıkar
 * (suggestion API çalışmadığı için bu yöntem kullanılıyor)
 */
function extractKeywordsFromProducts(products, originalQuery) {
    const stopWords = new Set(['ve', 'ile', 'için', 'bir', 'bu', 'da', 'de', 'den', 'dan',
        'adet', 'set', 'seti', 'lü', 'li', 'lu', 'lı', 'x', 'cm', 'mm', 'ml', 'gr', 'kg',
        'mt', 'lt', 'the', 'of', 'and', 'size', 'one', 'olan', 'olarak', 'en', 'al',
        'çok', 'yeni', 'özel', 'model', 'kalite', 'kaliteli']);

    const wordFreq = {};
    const bigramFreq = {};

    products.forEach(p => {
        if (!p.name) return;
        const words = p.name.split(/[\s,\-\/\+\(\)]+/)
            .filter(w => w.length > 2 && !stopWords.has(w.toLowerCase()) && isNaN(w));

        const seen = new Set();
        words.forEach(w => {
            const wl = w.toLowerCase();
            if (!seen.has(wl)) {
                wordFreq[wl] = (wordFreq[wl] || 0) + 1;
                seen.add(wl);
            }
        });

        // Bigram'lar (2'li kelime grupları)
        for (let i = 0; i < words.length - 1; i++) {
            const bg = words[i].toLowerCase() + ' ' + words[i + 1].toLowerCase();
            if (!stopWords.has(words[i].toLowerCase()) && !stopWords.has(words[i + 1].toLowerCase())) {
                bigramFreq[bg] = (bigramFreq[bg] || 0) + 1;
            }
        }
    });

    // Tekil kelimeler (en az 2 üründe geçenler)
    const keywords = Object.entries(wordFreq)
        .filter(([, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25)
        .map(([word]) => word);

    // Bigram'lar (en az 2 üründe geçenler)
    const bigrams = Object.entries(bigramFreq)
        .filter(([, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([bg]) => bg);

    // Birleştir: önce bigram'lar sonra tekil kelimeler
    const suggestions = [...new Set([...bigrams, ...keywords])].slice(0, 20);

    return suggestions;
}

/**
 * Bir ürün başlığından arama yaparak Trendyol'daki rakipleri bul
 * En az 4, en fazla 10 rakip — tercihen yorum/puan sahibi olanlar öncelikli
 */
async function findCompetitorsFromSearch(productTitle, categoryName, limit = 10) {
    if (!productTitle) return { products: [], keywords: [], searchQuery: '' };

    // Başlıktan anlamlı arama terimi oluştur
    const stopWords = new Set(['ve', 'ile', 'için', 'bir', 'bu', 'da', 'de', 'den', 'dan',
        'adet', 'set', 'seti', 'lü', 'li', 'lu', 'lı', 'x', 'cm', 'mm', 'ml', 'gr', 'kg',
        'mt', 'lt', 'the', 'of', 'and', 'size', 'one', 'olan', 'olarak']);

    const titleWords = productTitle.split(/[\s,\-\/\+\(\)]+/)
        .filter(w => w.length > 2 && !stopWords.has(w.toLowerCase()) && isNaN(w));

    // En anlamlı 3-4 kelimeyi seç
    const searchTerms = titleWords.slice(0, 4).join(' ');

    // Arama yap — daha fazla sonuç al (20) böylece puanlı olanları filtreleyebiliriz
    const searchResult = await searchProducts(searchTerms, 20);

    // Puanlı/yorumlu rakipleri önceliklendir
    const allProducts = searchResult.products || [];
    const ratedProducts = allProducts.filter(p => p.ratingScore > 0 && p.ratingCount > 0);
    const unratedProducts = allProducts.filter(p => !p.ratingScore || !p.ratingCount);

    // Önce puanlı olanlar, sonra puansızlar — toplam 4-10 arası
    let selectedProducts = [];
    // Puanlı ürünleri puanına göre sırala (en yüksekten düşüğe)
    ratedProducts.sort((a, b) => (b.ratingScore * b.ratingCount) - (a.ratingScore * a.ratingCount));
    selectedProducts.push(...ratedProducts.slice(0, limit));
    
    // Eğer 4'ten az puanlı varsa, puansızlardan tamamla
    if (selectedProducts.length < 4) {
        const needed = Math.min(4 - selectedProducts.length, unratedProducts.length);
        selectedProducts.push(...unratedProducts.slice(0, needed));
    }

    // Maximum limit'e kırp
    selectedProducts = selectedProducts.slice(0, limit);

    // Arama sonuçlarından anahtar kelime önerileri çıkar
    const keywords = extractKeywordsFromProducts(allProducts, searchTerms);

    // Ek arama: Kategori adıyla da arama yap
    let categoryKeywords = [];
    if (categoryName) {
        const catWords = categoryName.split(/[\s\/\-\&>]+/).filter(w => w.length > 2);
        const catSearch = catWords.slice(-2).join(' ');
        if (catSearch && catSearch.toLowerCase() !== searchTerms.toLowerCase()) {
            try {
                const catResult = await searchProducts(catSearch, 10);
                categoryKeywords = extractKeywordsFromProducts(catResult.products, catSearch);
            } catch (err) {
                // Kategori araması opsiyonel
            }
        }
    }

    const allKeywords = [...new Set([...keywords, ...categoryKeywords])].slice(0, 20);

    return {
        products: selectedProducts,
        totalCount: searchResult.totalCount || 0,
        keywords: allKeywords,
        searchQuery: searchTerms,
        ratedCount: ratedProducts.length,
        totalSearched: allProducts.length
    };
}

/**
 * Arama sonuçlarından anahtar kelime analizi yap
 */
function analyzeSearchKeywords(searchProducts, suggestions) {
    const wordFreq = {};
    const stopWords = new Set(['ve', 'ile', 'için', 'bir', 'bu', 'da', 'de', 'den', 'dan',
        'adet', 'set', 'seti', 'lü', 'li', 'lu', 'lı', 'x', 'olan', 'olarak',
        'the', 'of', 'and', 'size', 'one', 'cm', 'mm', 'ml', 'gr', 'kg', 'mt', 'lt']);

    searchProducts.forEach(p => {
        if (!p.name) return;
        const words = p.name.split(/[\s,\-\/\+\(\)]+/)
            .filter(w => w.length > 2 && !stopWords.has(w.toLowerCase()) && isNaN(w));
        words.forEach(w => {
            const wl = w.toLowerCase();
            wordFreq[wl] = (wordFreq[wl] || 0) + 1;
        });
    });

    (suggestions || []).forEach(s => {
        const words = s.split(/[\s,\-\/\+\(\)]+/)
            .filter(w => w.length > 2 && !stopWords.has(w.toLowerCase()) && isNaN(w));
        words.forEach(w => {
            const wl = w.toLowerCase();
            wordFreq[wl] = (wordFreq[wl] || 0) + 2;
        });
    });

    return Object.entries(wordFreq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([word, count]) => ({ word, count, source: 'trendyol-search' }));
}

module.exports = {
    searchProducts,
    findCompetitorsFromSearch,
    analyzeSearchKeywords,
    extractKeywordsFromProducts
};
