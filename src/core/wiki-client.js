/**
 * WikiClient - Fetches Wikipedia article data with caching and rate limiting
 * Uses Wikipedia REST API for optimal performance
 */
export class WikiClient {
  constructor(options = {}) {
    this.cache = new Map(); // In-memory session cache
    this.language = options.language || 'en';
    this.maxRetries = options.maxRetries || 3;
    this.initialBackoffMs = options.initialBackoffMs || 1000;
    this.requestQueue = [];
    this.isProcessingQueue = false;
  }

  /**
   * Fetch Wikipedia article summary by title
   * @param {string} title - Article title (e.g., "Eiffel Tower")
   * @returns {Promise<Object>} Structured article data
   */
  async fetchByTitle(title) {
    if (!title || typeof title !== 'string') {
      throw new Error('Invalid title parameter');
    }

    const cacheKey = `title:${title}`;
    
    // Check cache first
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    // Encode title for URL (handle spaces and special characters)
    const encodedTitle = encodeURIComponent(title.trim().replace(/ /g, '_'));
    const url = `https://${this.language}.wikipedia.org/api/rest_v1/page/summary/${encodedTitle}`;

    try {
      const data = await this._fetchWithBackoff(url);
      const structured = this._structureData(data);
      
      // Cache the result
      this.cache.set(cacheKey, structured);
      
      return structured;
    } catch (error) {
      if (error.status === 404) {
        throw new Error(`Article not found: ${title}`);
      }
      throw error;
    }
  }

  /**
   * Search for Wikipedia articles near coordinates
   * @param {number} latitude - Latitude in degrees
   * @param {number} longitude - Longitude in degrees
   * @param {Object} options - Search options
   * @returns {Promise<Array>} Array of article summaries
   */
  async fetchByCoordinates(latitude, longitude, options = {}) {
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      throw new Error('Invalid coordinates');
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      throw new Error('Coordinates out of range');
    }

    const radius = options.radius || 1000; // meters
    const limit = Math.min(options.limit || 10, 50); // max 50 results
    
    const cacheKey = `geo:${latitude.toFixed(4)},${longitude.toFixed(4)},${radius},${limit}`;
    
    // Check cache first
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    // Use MediaWiki API for geosearch (REST API doesn't support this yet)
    const params = new URLSearchParams({
      action: 'query',
      list: 'geosearch',
      gscoord: `${latitude}|${longitude}`,
      gsradius: radius,
      gslimit: limit,
      format: 'json',
      origin: '*' // Enable CORS
    });

    const url = `https://${this.language}.wikipedia.org/w/api.php?${params}`;

    try {
      const response = await this._fetchWithBackoff(url);
      
      if (!response.query || !response.query.geosearch) {
        return [];
      }

      // Fetch full summaries for each result
      const articles = await Promise.allSettled(
        response.query.geosearch.map(item => 
          this.fetchByTitle(item.title).catch(err => null)
        )
      );

      // Filter out failed requests and null results
      const results = articles
        .filter(result => result.status === 'fulfilled' && result.value !== null)
        .map(result => result.value);

      // Cache the results
      this.cache.set(cacheKey, results);
      
      return results;
    } catch (error) {
      throw new Error(`GeoSearch failed: ${error.message}`);
    }
  }

  /**
   * Fetch with exponential backoff retry logic
   * @private
   */
  async _fetchWithBackoff(url, retryCount = 0) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Api-User-Agent': 'AugmentedWiki/1.0 (Educational Project)'
        }
      });

      if (!response.ok) {
        // Check for rate limiting
        if (response.status === 429 && retryCount < this.maxRetries) {
          const backoffTime = this.initialBackoffMs * Math.pow(2, retryCount);
          console.warn(`Rate limited. Retrying in ${backoffTime}ms...`);
          await this._sleep(backoffTime);
          return this._fetchWithBackoff(url, retryCount + 1);
        }

        // Create error with status code
        const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
        error.status = response.status;
        throw error;
      }

      return await response.json();
    } catch (error) {
      // Network errors - retry with backoff
      if (retryCount < this.maxRetries && !error.status) {
        const backoffTime = this.initialBackoffMs * Math.pow(2, retryCount);
        console.warn(`Network error. Retrying in ${backoffTime}ms...`);
        await this._sleep(backoffTime);
        return this._fetchWithBackoff(url, retryCount + 1);
      }

      throw error;
    }
  }

  /**
   * Structure API response into consistent format
   * @private
   */
  _structureData(apiData) {
    return {
      title: apiData.title || null,
      description: apiData.description || null,
      extract: apiData.extract || null, // Short text summary
      imageUrl: apiData.thumbnail?.source || apiData.originalimage?.source || null,
      url: apiData.content_urls?.desktop?.page || null,
      coordinates: apiData.coordinates ? {
        latitude: apiData.coordinates.lat,
        longitude: apiData.coordinates.lon
      } : null,
      pageId: apiData.pageid || null,
      lang: apiData.lang || this.language
    };
  }

  /**
   * Sleep utility for backoff
   * @private
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clear the in-memory cache
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }

  /**
   * Batch fetch multiple articles by title
   * @param {Array<string>} titles - Array of article titles
   * @returns {Promise<Array>} Array of article data (null for failures)
   */
  async fetchBatch(titles) {
    if (!Array.isArray(titles)) {
      throw new Error('titles must be an array');
    }

    const results = await Promise.allSettled(
      titles.map(title => this.fetchByTitle(title))
    );

    return results.map(result => 
      result.status === 'fulfilled' ? result.value : null
    );
  }

  /**
   * Prefetch articles for faster subsequent access
   * @param {Array<string>} titles - Titles to prefetch
   */
  async prefetch(titles) {
    if (!Array.isArray(titles)) {
      throw new Error('titles must be an array');
    }

    // Fire and forget - don't wait for results
    titles.forEach(title => {
      this.fetchByTitle(title).catch(() => {
        // Silently ignore prefetch errors
      });
    });
  }
}

// Export singleton instance for convenience
export const wikiClient = new WikiClient();
