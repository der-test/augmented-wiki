/**
 * OverlayRenderer - Manages AR overlay labels for POIs on camera feed
 * Uses CSS3D transforms for maximum device compatibility
 * Handles label positioning, visibility, animations, and click interactions
 */

import { projectToScreen } from '../utils/coordinates.js';
import { WikiClient } from '../core/wiki-client.js';

export class OverlayRenderer {
  constructor(containerElement, options = {}) {
    if (!containerElement) {
      throw new Error('Container element is required');
    }

    this.container = containerElement;
    this.wikiClient = options.wikiClient || new WikiClient();
    
    // Configuration
    this.maxVisibleDistance = options.maxVisibleDistance || 5000; // meters
    this.maxLabels = options.maxLabels || 20;
    this.minLabelSpacing = options.minLabelSpacing || 80; // pixels
    this.horizontalFOV = options.horizontalFOV || 60; // degrees
    this.verticalFOV = options.verticalFOV || 45; // degrees
    this.updateInterval = options.updateInterval || 50; // ms - faster updates for responsive tracking
    
    // State management
    this.activePOIs = new Map(); // Map<poiId, POIState>
    this.labelElements = new Map(); // Map<poiId, HTMLElement>
    this.isRendering = false;
    this.animationFrameId = null;
    this.lastUpdateTime = 0;
    
    // User state (updated externally)
    this.userPosition = null;
    this.deviceOrientation = null;
    this.screenDimensions = {
      width: window.innerWidth,
      height: window.innerHeight
    };
    
    // Click handler for full article modal
    this.onLabelClick = options.onLabelClick || this._defaultClickHandler.bind(this);
    
    // Initialize
    this._setupContainer();
    this._bindEvents();
  }

  /**
   * Setup overlay container with proper styling
   * @private
   */
  _setupContainer() {
    this.container.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      overflow: hidden;
      z-index: 100;
    `;
    
    this.container.classList.add('ar-overlay');
  }

  /**
   * Bind event listeners for screen resize
   * @private
   */
  _bindEvents() {
    this.resizeHandler = () => {
      this.screenDimensions.width = window.innerWidth;
      this.screenDimensions.height = window.innerHeight;
    };
    
    window.addEventListener('resize', this.resizeHandler);
  }

  /**
   * Update user position (called by geolocator)
   * @param {Object} position - { lat, lng }
   */
  updateUserPosition(position) {
    this.userPosition = position;
  }

  /**
   * Update device orientation (called by sensors)
   * @param {Object} orientation - { heading, pitch }
   */
  updateDeviceOrientation(orientation) {
    this.deviceOrientation = orientation;
  }

  /**
   * Update maximum visible distance
   * @param {number} distance - Distance in meters
   */
  updateMaxDistance(distance) {
    this.maxVisibleDistance = distance;
  }

  /**
   * Update screen dimensions (e.g., on orientation change)
   * @param {number} width - Screen width in pixels
   * @param {number} height - Screen height in pixels
   */
  updateScreenDimensions(width, height) {
    this.screenDimensions = { width, height };
  }

  /**
   * Update POI data and render
   * @param {Array<Object>} pois - Array of POI objects with { id, name, lat, lng, distance, bearing, wikipediaTitle }
   */
  updatePOIs(pois) {
    if (!Array.isArray(pois)) {
      console.error('POIs must be an array');
      return;
    }

    // Update active POIs map
    const newPOIIds = new Set();
    
    pois.forEach(poi => {
      if (!poi.id) {
        console.warn('POI missing id, skipping', poi);
        return;
      }
      
      newPOIIds.add(poi.id);
      
      // Create or update POI state
      if (!this.activePOIs.has(poi.id)) {
        this.activePOIs.set(poi.id, {
          poi,
          screenPos: null,
          isVisible: false,
          opacity: 0,
          articleData: null,
          isLoading: false
        });
      } else {
        // Update POI data
        const state = this.activePOIs.get(poi.id);
        state.poi = poi;
      }
    });

    // Remove POIs that are no longer in the list
    for (const poiId of this.activePOIs.keys()) {
      if (!newPOIIds.has(poiId)) {
        this._removePOI(poiId);
      }
    }
  }

  /**
   * Start rendering loop
   */
  start() {
    if (this.isRendering) {
      return;
    }
    
    this.isRendering = true;
    this._renderLoop();
  }

  /**
   * Stop rendering loop
   */
  stop() {
    this.isRendering = false;
    
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Main rendering loop using requestAnimationFrame
   * @private
   */
  _renderLoop() {
    if (!this.isRendering) {
      return;
    }

    const now = Date.now();
    const deltaTime = now - this.lastUpdateTime;

    // Throttle updates to avoid excessive DOM operations
    if (deltaTime >= this.updateInterval) {
      this._updateFrame();
      this.lastUpdateTime = now;
    }

    this.animationFrameId = requestAnimationFrame(() => this._renderLoop());
  }

  /**
   * Update frame - calculate positions and update DOM
   * @private
   */
  _updateFrame() {
    if (!this.userPosition || !this.deviceOrientation) {
      return;
    }

    // Calculate screen positions for all POIs
    const visiblePOIs = [];
    let projectionAttempts = 0;
    let outsideHFOV = 0;
    
    for (const [poiId, state] of this.activePOIs) {
      const poi = state.poi;
      
      // Check distance threshold
      if (poi.distance > this.maxVisibleDistance) {
        state.isVisible = false;
        continue;
      }

      projectionAttempts++;

      // Project to screen coordinates
      const screenPos = projectToScreen(
        this.userPosition,
        { lat: poi.lat, lng: poi.lng },
        this.deviceOrientation.heading,
        this.deviceOrientation.pitch || 0,
        this.screenDimensions.width,
        this.screenDimensions.height,
        this.horizontalFOV,
        this.verticalFOV
      );

      if (screenPos) {
        state.screenPos = screenPos;
        state.isVisible = true;
        visiblePOIs.push({ poiId, state });
      } else {
        state.isVisible = false;
        outsideHFOV++;
      }
    }

    // Debug log occasionally
    if (Math.random() < 0.1) { // 10% of frames for more frequent feedback
      console.log(`[AR Render] ${visiblePOIs.length} visible / ${projectionAttempts} total (${outsideHFOV} outside FOV)`);
      console.log(`[AR State] Heading: ${this.deviceOrientation.heading.toFixed(1)}°, User: ${this.userPosition.lat.toFixed(4)}, ${this.userPosition.lng.toFixed(4)}`);
      
      // Log detailed position info for visible POIs
      if (visiblePOIs.length > 0) {
        const sample = visiblePOIs.slice(0, 2);
        sample.forEach(({state}) => {
          const xPercent = (state.screenPos.x / this.screenDimensions.width * 100).toFixed(0);
          const yPercent = (state.screenPos.y / this.screenDimensions.height * 100).toFixed(0);
          console.log(`  [POI] ${state.poi.name}: bearing=${state.poi.bearing.toFixed(0)}°, x=${state.screenPos.x}px (${xPercent}%), y=${state.screenPos.y}px (${yPercent}%)`);
        });
      }
    }

    // Sort by distance (closer POIs have priority)
    visiblePOIs.sort((a, b) => a.state.poi.distance - b.state.poi.distance);

    // Limit number of visible labels
    const displayPOIs = visiblePOIs.slice(0, this.maxLabels);

    // Apply collision detection
    const finalPOIs = this._resolveCollisions(displayPOIs);

    // Update DOM elements
    this._updateDOM(finalPOIs);
  }

  /**
   * Collision detection with vertical repositioning
   * Uses a slot-search approach to find the nearest vertical space
   * @private
   * @param {Array} visiblePOIs - Array of { poiId, state }
   * @returns {Array} Array with adjusted positions to prevent overlaps
   */
  _resolveCollisions(visiblePOIs) {
    const result = [];
    const occupiedRegions = [];

    // Exact label dimensions from CSS/Main
    const labelWidth = 220; 
    const labelHeight = 100;
    // Small buffer for aesthetics
    const padding = 10; 

    // Search offsets: 0, +1, -1, +2, -2, etc. (multiples of height+padding)
    // Checks ~8 slots up and down to find a fit
    const offsets = [0];
    for (let i = 1; i <= 8; i++) {
        offsets.push(i);
        offsets.push(-i);
    }

    const verticalStep = labelHeight + padding;

    for (const { poiId, state } of visiblePOIs) {
      const originalPos = { ...state.screenPos };
      let bestPos = null;
      let foundSlot = false;

      // Try each offset until we find a free spot
      for (const k of offsets) {
          const candidateY = originalPos.y + (k * verticalStep);
          
          // Check screen bounds (with margin)
          if (candidateY < 50 || candidateY > this.screenDimensions.height - labelHeight - 50) {
              continue;
          }

          // Check collision with already placed labels
          let collision = false;
          for (const region of occupiedRegions) {
              const dx = Math.abs(originalPos.x - region.x);
              const dy = Math.abs(candidateY - region.y);
              
              // Strict non-overlap check: distance between centers/tops < dimension + padding
              if (dx < (labelWidth + padding) && dy < (labelHeight + padding)) {
                  collision = true;
                  break;
              }
          }

          if (!collision) {
              bestPos = { x: originalPos.x, y: candidateY };
              foundSlot = true;
              break;
          }
      }

      // If no slot found, force it inside bounds (overlapping is unavoidable here)
      if (!foundSlot) {
          let clampedY = Math.max(50, Math.min(originalPos.y, this.screenDimensions.height - labelHeight - 50));
          bestPos = { x: originalPos.x, y: clampedY };
      }

      state.screenPos = bestPos;
      result.push({ poiId, state });
      occupiedRegions.push(bestPos);
    }

    return result;
  }

  /**
   * Update DOM elements for visible POIs
   * @private
   * @param {Array} displayPOIs - Array of { poiId, state } to display
   */
  _updateDOM(displayPOIs) {
    const displayPOIIds = new Set(displayPOIs.map(p => p.poiId));
    const allActivePOIIds = new Set(this.activePOIs.keys());

    // Remove labels for POIs that are no longer active OR visible
    for (const [poiId, element] of this.labelElements) {
      const shouldRemove = !displayPOIIds.has(poiId) || !allActivePOIIds.has(poiId);
      if (shouldRemove) {
        this._fadeOutLabel(poiId, element);
      }
    }

    // Create or update labels for visible POIs
    for (const { poiId, state } of displayPOIs) {
      let element = this.labelElements.get(poiId);

      if (!element) {
        element = this._createLabel(poiId, state);
        this.labelElements.set(poiId, element);
        this.container.appendChild(element);
        
        // Trigger fade in animation
        requestAnimationFrame(() => {
          element.style.opacity = '1';
        });

        // Fetch Wikipedia data if not already loading
        if (!state.articleData && !state.isLoading) {
          this._fetchArticleData(poiId, state);
        }
      }

      // Update position with smooth interpolation
      this._updateLabelPosition(element, state);
      
      // Update content if article data arrived
      if (state.articleData && !element.dataset.hasArticle) {
        this._updateLabelContent(element, state);
        element.dataset.hasArticle = 'true';
      }
    }
  }

  /**
   * Create a new label element
   * @private
   * @param {string} poiId - POI identifier
   * @param {Object} state - POI state
   * @returns {HTMLElement} Label element
   */
  _createLabel(poiId, state) {
    const label = document.createElement('div');
    label.className = 'ar-label';
    label.dataset.poiId = poiId;
    
    // Inline styles for maximum compatibility
    label.style.cssText = `
      position: absolute;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 8px 12px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 14px;
      pointer-events: auto;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.3s ease-out;
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.2);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
      max-width: 200px;
      z-index: 5;
    `;

    // Initial content (name and distance)
    const poi = state.poi;
    const wikiUrl = poi.wikipediaTitle 
      ? `https://en.wikipedia.org/wiki/${encodeURIComponent(poi.wikipediaTitle.replace(/ /g, '_'))}`
      : null;
    
    label.innerHTML = `
      <div class="ar-label-title" style="font-weight: 600; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
        ${this._escapeHtml(poi.name)}
      </div>
      <div class="ar-label-distance" style="font-size: 12px; opacity: 0.8;">
        ${this._formatDistance(poi.distance)}
      </div>
      ${wikiUrl ? `
        <a href="${wikiUrl}" target="_blank" style="font-size: 11px; color: #4da6ff; text-decoration: none; display: inline-block; margin-top: 4px;">
          📖 Read more →
        </a>
      ` : ''}
    `;

    // Click handler
    label.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onLabelClick(poi, state.articleData);
    });

    return label;
  }

  /**
   * Update label position using CSS3D transforms
   * @private
   * @param {HTMLElement} element - Label element
   * @param {Object} state - POI state
   */
  _updateLabelPosition(element, state) {
    const pos = state.screenPos;
    
    // Direct positioning - set left/top with translate to center
    // This ensures position updates are immediately visible
    element.style.left = `${pos.x}px`;
    element.style.top = `${pos.y}px`;
    element.style.transform = `translate(-50%, 0)`; // Center horizontally only
  }

  /**
   * Update label content with Wikipedia data
   * @private
   * @param {HTMLElement} element - Label element
   * @param {Object} state - POI state
   */
  _updateLabelContent(element, state) {
    const article = state.articleData;
    const poi = state.poi;
    
    if (!article) {
      return;
    }

    const wikiUrl = article.url || (poi.wikipediaTitle 
      ? `https://en.wikipedia.org/wiki/${encodeURIComponent(poi.wikipediaTitle.replace(/ /g, '_'))}`
      : null);

    // Update with article snippet
    element.innerHTML = `
      <div class="ar-label-title" style="font-weight: 600; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
        ${this._escapeHtml(article.title || poi.name)}
      </div>
      <div class="ar-label-distance" style="font-size: 12px; opacity: 0.8; margin-bottom: 4px;">
        ${this._formatDistance(poi.distance)}
      </div>
      ${article.extract ? `
        <div class="ar-label-description" style="font-size: 11px; opacity: 0.9; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-bottom: 4px;">
          ${this._escapeHtml(article.extract.substring(0, 100))}${article.extract.length > 100 ? '...' : ''}
        </div>
      ` : ''}
      ${wikiUrl ? `
        <a href="${wikiUrl}" target="_blank" style="font-size: 11px; color: #4da6ff; text-decoration: none; display: inline-block;">
          📖 Read more →
        </a>
      ` : ''}
    `;
  }

  /**
   * Fade out and remove a label
   * @private
   * @param {string} poiId - POI identifier
   * @param {HTMLElement} element - Label element
   */
  _fadeOutLabel(poiId, element) {
    element.style.opacity = '0';
    
    // Remove after transition
    setTimeout(() => {
      if (element.parentNode === this.container) {
        this.container.removeChild(element);
      }
      this.labelElements.delete(poiId);
    }, 300);
  }

  /**
   * Fetch Wikipedia article data for a POI
   * @private
   * @param {string} poiId - POI identifier
   * @param {Object} state - POI state
   */
  async _fetchArticleData(poiId, state) {
    const poi = state.poi;
    
    if (!poi.wikipediaTitle) {
      return;
    }

    state.isLoading = true;

    try {
      const articleData = await this.wikiClient.fetchByTitle(poi.wikipediaTitle);
      
      // Check if POI still exists
      if (this.activePOIs.has(poiId)) {
        state.articleData = articleData;
        state.isLoading = false;
      }
    } catch (error) {
      console.error(`Failed to fetch article for ${poi.name}:`, error);
      state.isLoading = false;
    }
  }

  /**
   * Remove POI and its label
   * @private
   * @param {string} poiId - POI identifier
   */
  _removePOI(poiId) {
    const element = this.labelElements.get(poiId);
    
    if (element) {
      this._fadeOutLabel(poiId, element);
    }
    
    this.activePOIs.delete(poiId);
  }

  /**
   * Default click handler - can be overridden via options
   * @private
   * @param {Object} poi - POI data
   * @param {Object} articleData - Wikipedia article data
   */
  _defaultClickHandler(poi, articleData) {
    if (articleData && articleData.content_urls) {
      // Open Wikipedia page in new tab
      window.open(articleData.content_urls.desktop.page, '_blank');
    }
  }

  /**
   * Format distance for display
   * @private
   * @param {number} meters - Distance in meters
   * @returns {string} Formatted distance string
   */
  _formatDistance(meters) {
    if (meters < 1000) {
      return `${Math.round(meters)}m`;
    } else {
      return `${(meters / 1000).toFixed(1)}km`;
    }
  }

  /**
   * Escape HTML to prevent XSS
   * @private
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   */
  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Clean up resources
   */
  destroy() {
    this.stop();
    
    // Remove all labels
    for (const [poiId, element] of this.labelElements) {
      if (element.parentNode === this.container) {
        this.container.removeChild(element);
      }
    }
    
    // Clear maps
    this.activePOIs.clear();
    this.labelElements.clear();
    
    // Remove event listeners
    window.removeEventListener('resize', this.resizeHandler);
    
    // Clear container
    this.container.innerHTML = '';
  }
}
