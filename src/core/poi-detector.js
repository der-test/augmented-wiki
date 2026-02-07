/**
 * POI Detector - Manages discovery and filtering of Points of Interest
 * Fetches POIs from OpenStreetMap via Overpass API and filters by camera view frustum
 * 
 * Core responsibilities:
 * - Query Overpass API for nearby POIs with Wikipedia/Wikidata tags
 * - Cache results in memory to minimize API calls
 * - Filter POIs by camera view frustum (GPS + heading + pitch)
 * - Handle rate limiting and errors gracefully
 */

import { calculateDistance, calculateBearing, isInViewFrustum } from '../utils/coordinates.js';

// Overpass API configuration
const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
const DEFAULT_SEARCH_RADIUS = 5000; // 5km in meters
const DEFAULT_MAX_RESULTS = 100;
const CACHE_DURATION = 300000; // 5 minutes in milliseconds
const REQUEST_TIMEOUT = 10000; // 10 seconds

// Rate limiting configuration
const MIN_REQUEST_INTERVAL = 1000; // Minimum 1 second between requests
const MAX_RETRIES = 3;
const RETRY_DELAY_BASE = 2000; // Base delay for exponential backoff

/**
 * POIDetector class for managing points of interest discovery and filtering
 */
export class POIDetector {
  constructor() {
    // In-memory cache: Map of cache keys to cached data
    this.cache = new Map();
    
    // Track last request time for rate limiting
    this.lastRequestTime = 0;
    
    // Track ongoing requests to prevent duplicates
    this.pendingRequests = new Map();
  }

  /**
   * Build Overpass QL query to find POIs with Wikipedia/Wikidata tags
   * @param {number} lat - Center latitude
   * @param {number} lng - Center longitude
   * @param {number} radius - Search radius in meters
   * @returns {string} Overpass QL query
   */
  _buildOverpassQuery(lat, lng, radius) {
    // Query for nodes and ways with wikipedia or wikidata tags
    // Use around filter for radius search
    // Return JSON format with all tags
    return `
      [out:json][timeout:25];
      (
        node(around:${radius},${lat},${lng})[~"^(wikipedia|wikidata)$"~"."](if:t["name"]);
        way(around:${radius},${lat},${lng})[~"^(wikipedia|wikidata)$"~"."](if:t["name"]);
      );
      out center tags ${DEFAULT_MAX_RESULTS};
    `.trim();
  }

  /**
   * Generate cache key from location and radius
   * @param {number} lat - Latitude
   * @param {number} lng - Longitude
   * @param {number} radius - Search radius
   * @returns {string} Cache key
   */
  _getCacheKey(lat, lng, radius) {
    // Round to 3 decimal places (~111m precision) for cache key
    const roundedLat = Math.round(lat * 1000) / 1000;
    const roundedLng = Math.round(lng * 1000) / 1000;
    return `${roundedLat},${roundedLng},${radius}`;
  }

  /**
   * Check if cached data is still valid
   * @param {Object} cachedData - Cached data object
   * @returns {boolean} True if cache is valid
   */
  _isCacheValid(cachedData) {
    if (!cachedData) return false;
    const age = Date.now() - cachedData.timestamp;
    return age < CACHE_DURATION;
  }

  /**
   * Enforce rate limiting - wait if needed
   * @returns {Promise<void>}
   */
  async _enforceRateLimit() {
    const timeSinceLastRequest = Date.now() - this.lastRequestTime;
    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
      const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    this.lastRequestTime = Date.now();
  }

  /**
   * Fetch POIs from Overpass API with retry logic
   * @param {string} query - Overpass QL query
   * @param {number} retryCount - Current retry attempt
   * @returns {Promise<Array>} Array of POI elements
   */
  async _fetchFromOverpass(query, retryCount = 0) {
    try {
      await this._enforceRateLimit();

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

      console.log('Sending Overpass API request...');

      const response = await fetch(OVERPASS_ENDPOINT, {
        method: 'POST',
        body: query,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        signal: controller.signal,
        mode: 'cors'
      });

      clearTimeout(timeoutId);

      console.log('Overpass API response status:', response.status);

      if (!response.ok) {
        // Handle rate limiting (429) and server errors (5xx)
        if (response.status === 429 || response.status >= 500) {
          throw new Error(`Overpass API error: ${response.status}`);
        }
        throw new Error(`HTTP error: ${response.status}`);
      }

      const data = await response.json();
      console.log('Overpass API returned', data.elements?.length || 0, 'elements');
      return data.elements || [];

    } catch (error) {
      console.error('Overpass API fetch error:', error.name, error.message);
      
      // Retry with exponential backoff for network errors and rate limits
      if (retryCount < MAX_RETRIES) {
        const isRetriableError = 
          error.name === 'AbortError' ||
          error.message.includes('429') ||
          error.message.includes('5') ||
          error.message.includes('network') ||
          error.message.includes('fetch');

        if (isRetriableError) {
          const delay = RETRY_DELAY_BASE * Math.pow(2, retryCount);
          console.warn(`Overpass API request failed, retrying in ${delay}ms... (attempt ${retryCount + 1}/${MAX_RETRIES})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return this._fetchFromOverpass(query, retryCount + 1);
        }
      }

      console.error('Overpass API request failed after retries:', error);
      throw error;
    }
  }

  /**
   * Parse Overpass element into POI object
   * @param {Object} element - Overpass API element (node or way)
   * @param {Object} userLocation - User's current location {lat, lng}
   * @returns {Object} POI object
   */
  _parseElement(element, userLocation) {
    const tags = element.tags || {};
    
    // Get coordinates (use center for ways)
    const lat = element.center?.lat || element.lat;
    const lng = element.center?.lon || element.lon;

    if (!lat || !lng) {
      return null; // Skip elements without coordinates
    }

    // Extract Wikipedia information
    let wikipediaTitle = null;
    let wikidataId = null;

    // Check for various wikipedia tag formats
    // Format 1: wikipedia=en:Article_Name or language:Article_Name
    if (tags.wikipedia) {
      const parts = tags.wikipedia.split(':');
      if (parts.length >= 2) {
        // Take everything after first colon as title
        wikipediaTitle = parts.slice(1).join(':');
      } else {
        wikipediaTitle = tags.wikipedia;
      }
    }

    // Check language-specific tags (e.g., wikipedia:en)
    if (!wikipediaTitle) {
      const wikiKeys = Object.keys(tags).filter(k => k.startsWith('wikipedia:'));
      if (wikiKeys.length > 0) {
        // Prefer English, otherwise take first available
        const enKey = wikiKeys.find(k => k === 'wikipedia:en');
        const keyToUse = enKey || wikiKeys[0];
        wikipediaTitle = tags[keyToUse];
      }
    }

    // Extract Wikidata ID
    if (tags.wikidata) {
      wikidataId = tags.wikidata;
    }

    // Skip if no Wikipedia/Wikidata information found
    if (!wikipediaTitle && !wikidataId) {
      return null;
    }

    // Calculate distance and bearing from user
    const distance = calculateDistance(
      userLocation.lat,
      userLocation.lng,
      lat,
      lng
    );

    const bearing = calculateBearing(
      userLocation.lat,
      userLocation.lng,
      lat,
      lng
    );

    return {
      id: `${element.type}/${element.id}`,
      name: tags.name || 'Unknown',
      lat,
      lng,
      distance: Math.round(distance),
      bearing: Math.round(bearing),
      wikipediaTitle,
      wikidataId,
      type: element.type,
      tags: tags // Include all tags for potential future use
    };
  }

  /**
   * Fetch POIs near a location from Overpass API
   * Uses caching to minimize API calls
   * @param {number} lat - User latitude
   * @param {number} lng - User longitude
   * @param {number} [radius=5000] - Search radius in meters
   * @returns {Promise<Array>} Array of POI objects
   */
  async fetchNearbyPOIs(lat, lng, radius = DEFAULT_SEARCH_RADIUS) {
    // Validate inputs
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      throw new Error('Latitude and longitude must be numbers');
    }
    if (lat < -90 || lat > 90) {
      throw new Error('Latitude must be between -90 and 90');
    }
    if (lng < -180 || lng > 180) {
      throw new Error('Longitude must be between -180 and 180');
    }
    if (radius <= 0 || radius > 100000) {
      throw new Error('Radius must be between 0 and 100000 meters');
    }

    const cacheKey = this._getCacheKey(lat, lng, radius);

    // Check cache first
    const cachedData = this.cache.get(cacheKey);
    if (cachedData && this._isCacheValid(cachedData)) {
      console.log('Using cached POI data');
      return cachedData.pois;
    }

    // Check if there's already a pending request for this location
    if (this.pendingRequests.has(cacheKey)) {
      console.log('Waiting for pending POI request...');
      return this.pendingRequests.get(cacheKey);
    }

    // Create new request
    const requestPromise = (async () => {
      try {
        const query = this._buildOverpassQuery(lat, lng, radius);
        console.log(`Fetching POIs from Overpass API (${radius}m radius)...`);
        
        const elements = await this._fetchFromOverpass(query);
        console.log(`Received ${elements.length} elements from Overpass API`);

        // Parse elements into POI objects
        const pois = elements
          .map(element => this._parseElement(element, { lat, lng }))
          .filter(poi => poi !== null) // Remove invalid POIs
          .sort((a, b) => a.distance - b.distance); // Sort by distance

        console.log(`Parsed ${pois.length} valid POIs`);

        // Cache results
        this.cache.set(cacheKey, {
          pois,
          timestamp: Date.now()
        });

        return pois;

      } finally {
        // Remove from pending requests
        this.pendingRequests.delete(cacheKey);
      }
    })();

    // Track pending request
    this.pendingRequests.set(cacheKey, requestPromise);

    return requestPromise;
  }

  /**
   * Get POIs visible in camera view frustum
   * Filters POIs based on device orientation and field of view
   * @param {Array} pois - Array of POI objects to filter
   * @param {Object} userLocation - User's current location {lat, lng}
   * @param {number} deviceHeading - Compass heading (0-360, 0=north)
   * @param {number} devicePitch - Device tilt angle (-90 to 90, 0=horizontal)
   * @param {number} [horizontalFOV=60] - Horizontal field of view in degrees
   * @param {number} [verticalFOV=45] - Vertical field of view in degrees
   * @param {number} [maxDistance=5000] - Maximum visibility distance in meters
   * @returns {Array} Filtered array of visible POIs
   */
  getVisiblePOIs(
    pois,
    userLocation,
    deviceHeading,
    devicePitch,
    horizontalFOV = 60,
    verticalFOV = 45,
    maxDistance = DEFAULT_SEARCH_RADIUS
  ) {
    if (!Array.isArray(pois)) {
      throw new Error('POIs must be an array');
    }

    console.log(`Filtering ${pois.length} POIs with:`, {
      heading: deviceHeading?.toFixed(1),
      pitch: devicePitch?.toFixed(1),
      horizontalFOV,
      verticalFOV,
      maxDistance
    });

    const visiblePOIs = pois.filter((poi, index) => {
      const isVisible = isInViewFrustum(
        userLocation,
        { lat: poi.lat, lng: poi.lng },
        deviceHeading,
        devicePitch,
        horizontalFOV,
        verticalFOV,
        maxDistance
      );
      
      // Debug first few POIs
      if (index < 3) {
        console.log(`POI "${poi.name}":`, {
          distance: poi.distance,
          bearing: poi.bearing,
          isVisible
        });
      }
      
      return isVisible;
    });
    
    console.log(`Result: ${visiblePOIs.length} visible POIs`);
    return visiblePOIs;
  }

  /**
   * Fetch and filter POIs in one call
   * Convenience method that combines fetching and frustum culling
   * @param {number} lat - User latitude
   * @param {number} lng - User longitude
   * @param {number} deviceHeading - Compass heading (0-360, 0=north)
   * @param {number} devicePitch - Device tilt angle (-90 to 90)
   * @param {Object} options - Optional parameters
   * @param {number} [options.radius=5000] - Search radius in meters
   * @param {number} [options.horizontalFOV=60] - Horizontal FOV in degrees
   * @param {number} [options.verticalFOV=45] - Vertical FOV in degrees
   * @param {number} [options.maxDistance=5000] - Max visibility distance
   * @returns {Promise<Array>} Array of visible POI objects
   */
  async getVisiblePOIsInView(lat, lng, deviceHeading, devicePitch, options = {}) {
    const {
      radius = DEFAULT_SEARCH_RADIUS,
      horizontalFOV = 60,
      verticalFOV = 45,
      maxDistance = DEFAULT_SEARCH_RADIUS
    } = options;

    // Fetch all nearby POIs
    const allPOIs = await this.fetchNearbyPOIs(lat, lng, radius);

    // Filter by view frustum
    const visiblePOIs = this.getVisiblePOIs(
      allPOIs,
      { lat, lng },
      deviceHeading,
      devicePitch,
      horizontalFOV,
      verticalFOV,
      maxDistance
    );

    return visiblePOIs;
  }

  /**
   * Clear the POI cache
   * Useful for forcing a refresh or managing memory
   */
  clearCache() {
    this.cache.clear();
    console.log('POI cache cleared');
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache stats {size, entries}
   */
  getCacheStats() {
    const entries = Array.from(this.cache.entries()).map(([key, value]) => ({
      key,
      poiCount: value.pois.length,
      age: Date.now() - value.timestamp,
      valid: this._isCacheValid(value)
    }));

    return {
      size: this.cache.size,
      entries
    };
  }
}

// Export singleton instance for convenience
export const poiDetector = new POIDetector();
