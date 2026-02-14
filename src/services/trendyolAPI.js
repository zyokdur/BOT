const axios = require('axios');

class TrendyolAPI {
    constructor() {
        this.baseURL = 'https://apigw.trendyol.com/sapigw';
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
                timeout: 15000,
                validateStatus: (status) => status < 600 // 5xx dahil al
            });

            // Trendyol bazen 556 veya başka özel kodlar dönüyor
            if (response.status >= 400) {
                const msg = response.data?.message || response.data?.error || `HTTP ${response.status}`;
                const err = new Error(msg);
                err.statusCode = response.status;
                err.responseData = response.data;
                throw err;
            }

            return response.data;
        } catch (error) {
            if (error.statusCode) throw error;
            const msg = error.response?.data?.message || error.message;
            const err = new Error(msg);
            err.statusCode = error.response?.status || 0;
            throw err;
        }
    }

    async getProducts(page = 0, size = 50) {
        return this.apiCall(
            `${this.baseURL}/suppliers/${this.sellerId}/products`,
            { page, size, approved: true }
        );
    }

    async getAllProducts() {
        let allProducts = [];
        let page = 0;
        let hasMore = true;

        while (hasMore) {
            const data = await this.getProducts(page, 100);
            if (data.content && data.content.length > 0) {
                allProducts = allProducts.concat(data.content);
                page++;
                hasMore = data.content.length === 100;
            } else {
                hasMore = false;
            }
        }

        return allProducts;
    }

    async getOrders(startDate, endDate, status = '') {
        const params = {
            startDate: startDate || Date.now() - (30 * 24 * 60 * 60 * 1000),
            endDate: endDate || Date.now(),
            page: 0,
            size: 200
        };
        if (status) params.status = status;

        return this.apiCall(
            `${this.baseURL}/suppliers/${this.sellerId}/orders`,
            params
        );
    }

    async getCommissions() {
        return this.apiCall(`${this.baseURL}/product-categories`);
    }

    async getSettlements(startDate, endDate) {
        return this.apiCall(
            `${this.baseURL}/suppliers/${this.sellerId}/settlements`,
            {
                startDate: startDate || Date.now() - (30 * 24 * 60 * 60 * 1000),
                endDate: endDate || Date.now()
            }
        );
    }
}

module.exports = new TrendyolAPI();
