const axios = require('axios');

class TrendyolAPI {
    constructor() {
        this.baseURL = 'https://apigw.trendyol.com';
        this.sellerId = process.env.TRENDYOL_SELLER_ID;
        this.token = process.env.TRENDYOL_TOKEN;
    }

    getHeaders() {
        return {
            'Authorization': `Basic ${this.token}`,
            'Content-Type': 'application/json',
            'User-Agent': `${this.sellerId} - SelfIntegration`
        };
    }

    async apiCall(url, params = {}) {
        try {
            const response = await axios.get(url, {
                headers: this.getHeaders(),
                params,
                timeout: 30000
            });
            return response.data;
        } catch (error) {
            const msg = error.response?.data?.errors?.[0]?.message || error.response?.data?.message || error.message;
            const err = new Error(msg);
            err.statusCode = error.response?.status || 0;
            throw err;
        }
    }

    // Sayfalı ürün çekme
    async getProducts(page = 0, size = 50) {
        return this.apiCall(
            `${this.baseURL}/integration/product/sellers/${this.sellerId}/products`,
            { page, size, approved: true }
        );
    }

    // Sadece onSale=true aktif ürünler
    async getActiveProducts() {
        let allProducts = [];
        let page = 0;
        let hasMore = true;

        while (hasMore) {
            const data = await this.getProducts(page, 100);
            if (data.content && data.content.length > 0) {
                const active = data.content.filter(p => p.onSale === true);
                allProducts = allProducts.concat(active);
                page++;
                hasMore = data.content.length === 100;
            } else {
                hasMore = false;
            }
        }

        return allProducts;
    }

    // Siparişleri çek
    async getOrders(startDate, endDate) {
        let allOrders = [];
        let page = 0;
        let hasMore = true;

        const params = {
            startDate: startDate || Date.now() - (30 * 24 * 60 * 60 * 1000),
            endDate: endDate || Date.now(),
            size: 200
        };

        while (hasMore) {
            const data = await this.apiCall(
                `${this.baseURL}/integration/order/sellers/${this.sellerId}/orders`,
                { ...params, page }
            );

            if (data.content && data.content.length > 0) {
                allOrders = allOrders.concat(data.content);
                page++;
                hasMore = data.content.length === 200;
            } else {
                hasMore = false;
            }
        }

        return allOrders;
    }

    // Siparişlerden en güncel komisyon oranlarını çıkar
    async getCommissionRatesFromOrders() {
        const orders = await this.getOrders();
        const commissionMap = {};

        // Siparişleri tarihe göre sırala (en yeni en sona = override)
        orders.sort((a, b) => a.orderDate - b.orderDate);

        orders.forEach(order => {
            if (order.lines) {
                order.lines.forEach(line => {
                    if (line.barcode && line.commission) {
                        commissionMap[line.barcode] = line.commission;
                    }
                });
            }
        });

        return commissionMap;
    }

    // Tarih aralığına göre siparişler
    async getOrdersByDateRange(startDate, endDate) {
        return this.getOrders(startDate, endDate);
    }
}

module.exports = new TrendyolAPI();
