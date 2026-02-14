const axios = require('axios');

/**
 * Trendyol Public Search & Suggest API
 * Trendyol'un arama önerileri ve arama sonuçlarını çeker
 */

const SUGGEST_URL = 'https://public.trendyol.com/discovery-web-searchgw-service/v2/api/suggestion';
const SEARCH_URL = 'https://public.trendyol.com/discovery-web-searchgw-service/v2/api/infinite-scroll';

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
 * Trendyol arama önerilerini getir (autocomplete)
 * Kullanıcı "Askı Tutucu" yazdığında çıkan öneriler
 */
async function getSearchSuggestions(query) {
    if (!query || query.trim().length < 2) return [];
    
    try {
        const response = await axios.get(SUGGEST_URL, {
            params: { q: query.trim(), culture: 'tr-TR' },
            headers: HEADERS,
            timeout: 10000
        });
        
        const data = response.data;
        const suggestions = [];
        
        // Trendyol suggestion API farklı formatlar dönebilir
        if (data?.result?.suggestions) {
            data.result.suggestions.forEach(s => {
                if (s.text) suggestions.push(s.text);
            });
        }
        if (data?.result?.products) {
            // Önerilen ürünlerden anahtar kelimeleri çıkar
        }
        if (data?.suggestions) {
            data.suggestions.forEach(s => {
                if (typeof s === 'string') suggestions.push(s);
                else if (s.text) suggestions.push(s.text);
            });
        }
        // Düz array formatı
        if (Array.isArray(data)) {
            data.forEach(item => {
                if (typeof item === 'string') suggestions.push(item);
                else if (item?.text) suggestions.push(item.text);
            });
        }
        
        return [...new Set(suggestions)].slice(0, 20);
    } catch (error) {
        console.error('Trendyol suggest hatasi:', error.message);
        return [];
    }
}

/**
 * Trendyol'da ürün ara ve ilk N sonucu döndür
 * Gerçek Trendyol arama sonuçları — organik sıralama
 */
async function searchProducts(query, limit = 10) {
    if (!query || query.trim().length < 2) return [];
    
    try {
        // Trendyol search API'nin slug formatı: "askı tutucu" -> "aski-tutucu"
        const slug = query.trim()
            .toLowerCase()
            .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ü/g, 'u')
            .replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g')
            .replace(/İ/g, 'i').replace(/Ö/g, 'o').replace(/Ü/g, 'u')
            .replace(/Ş/g, 's').replace(/Ç/g, 'c').replace(/Ğ/g, 'g')
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-');
        
        const response = await axios.get(`${SEARCH_URL}/${slug}`, {
            params: {
                q: query.trim(),
                qt: query.trim(),
                st: query.trim(),
                os: 1,
                pi: 1,
                culture: 'tr-TR',
                userGenderId: 0,
                pId: 0,
                scoringAlgorithmId: 2,
                categoryRelevancyEnabled: false,
                isLegalRequirementConfirmed: false,
                searchStrategyType: 'DEFAULT',
                productStampType: 'TypeA'
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
                    price: p.price?.sellingPrice || p.price?.originalPrice || 0,
                    originalPrice: p.price?.originalPrice || 0,
                    categoryName: p.categoryName || '',
                    categoryHierarchy: p.categoryHierarchy || '',
                    merchantName: p.merchantName || '',
                    ratingScore: p.ratingScore?.averageRating || 0,
                    ratingCount: p.ratingScore?.totalCount || 0,
                    favoriteCount: p.favoriteCount || 0,
                    url: p.url ? `https://www.trendyol.com${p.url}` : '',
                    imageUrl: p.images?.[0] ? `https://cdn.dsmcdn.com/${p.images[0]}` : ''
                });
            });
        }
        
        // Toplam sonuç sayısı
        const totalCount = data?.result?.totalCount || products.length;
        
        return {
            products,
            totalCount,
            query: query.trim()
        };
    } catch (error) {
        console.error('Trendyol search hatasi:', error.message);
        // Cloudflare engeli veya DNS hatası durumunda boş döndür
        return { products: [], totalCount: 0, query: query.trim() };
    }
}

/**
 * Bir ürün başlığından arama yaparak Trendyol'daki rakipleri bul
 * Başlıktaki anahtar kelimeleri kullanarak arama yapar
 */
async function findCompetitorsFromSearch(productTitle, categoryName, limit = 5) {
    if (!productTitle) return { products: [], keywords: [], suggestions: [] };
    
    // Başlıktan anlamlı arama terimi oluştur
    const stopWords = new Set(['ve', 'ile', 'için', 'bir', 'bu', 'da', 'de', 'den', 'dan',
        'adet', 'set', 'seti', 'lü', 'li', 'lu', 'lı', 'x', 'cm', 'mm', 'ml', 'gr', 'kg',
        'mt', 'lt', 'the', 'of', 'and', 'size', 'one', 'olan', 'olarak']);
    
    const titleWords = productTitle.split(/[\s,\-\/\+\(\)]+/)
        .filter(w => w.length > 2 && !stopWords.has(w.toLowerCase()) && isNaN(w));
    
    // En anlamlı 3-4 kelimeyi seç (ilk kelimeler genellikle ürün türünü tanımlar)
    const searchTerms = titleWords.slice(0, 4).join(' ');
    
    // Paralel olarak arama ve önerileri çek
    const [searchResult, suggestions] = await Promise.all([
        searchProducts(searchTerms, limit),
        getSearchSuggestions(searchTerms)
    ]);
    
    // Ek öneriler: Kategori adıyla da arama yap
    let categorySuggestions = [];
    if (categoryName) {
        const catWords = categoryName.split(/[\s\/\-\&>]+/).filter(w => w.length > 2);
        const catSearch = catWords.slice(-2).join(' '); // Son 2 kelime genellikle spesifik kategori
        if (catSearch && catSearch !== searchTerms) {
            categorySuggestions = await getSearchSuggestions(catSearch);
        }
    }
    
    const allSuggestions = [...new Set([...suggestions, ...categorySuggestions])].slice(0, 15);
    
    return {
        products: searchResult.products || [],
        totalCount: searchResult.totalCount || 0,
        keywords: allSuggestions,
        searchQuery: searchTerms
    };
}

/**
 * Arama sonuçlarından anahtar kelime analizi yap
 * Trendyol'daki en çok aranan ve başarılı ürünlerin başlıklarını analiz et
 */
function analyzeSearchKeywords(searchProducts, suggestions) {
    const wordFreq = {};
    const stopWords = new Set(['ve', 'ile', 'için', 'bir', 'bu', 'da', 'de', 'den', 'dan',
        'adet', 'set', 'seti', 'lü', 'li', 'lu', 'lı', 'x', 'olan', 'olarak',
        'the', 'of', 'and', 'size', 'one', 'cm', 'mm', 'ml', 'gr', 'kg', 'mt', 'lt']);
    
    // Arama sonuçlarındaki ürün başlıklarından kelime frekansı
    searchProducts.forEach(p => {
        if (!p.name) return;
        const words = p.name.split(/[\s,\-\/\+\(\)]+/)
            .filter(w => w.length > 2 && !stopWords.has(w.toLowerCase()) && isNaN(w));
        words.forEach(w => {
            const wl = w.toLowerCase();
            wordFreq[wl] = (wordFreq[wl] || 0) + 1;
        });
    });
    
    // Önerilerden gelen kelimeleri de ekle (ağırlıklı)
    suggestions.forEach(s => {
        const words = s.split(/[\s,\-\/\+\(\)]+/)
            .filter(w => w.length > 2 && !stopWords.has(w.toLowerCase()) && isNaN(w));
        words.forEach(w => {
            const wl = w.toLowerCase();
            wordFreq[wl] = (wordFreq[wl] || 0) + 2; // Öneriler daha ağırlıklı
        });
    });
    
    return Object.entries(wordFreq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([word, count]) => ({ word, count, source: 'trendyol-search' }));
}

module.exports = {
    getSearchSuggestions,
    searchProducts,
    findCompetitorsFromSearch,
    analyzeSearchKeywords
};
