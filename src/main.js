import { Geolocator } from './core/geolocator.js';
import { POIDetector } from './core/poi-detector.js';
import { WikiClient } from './core/wiki-client.js';
import { CameraStream } from './ar/camera-stream.js';
import { OverlayRenderer } from './ar/overlay-renderer.js';
import { throttle } from './utils/sensors.js';

/**
 * Main application controller
 * Orchestrates all components and handles permission flows
 */
class AugmentedWikiApp {
    constructor() {
        // Core services
        this.geolocator = new Geolocator();
        this.poiDetector = new POIDetector();
        this.wikiClient = new WikiClient();
        this.cameraStream = new CameraStream();
        this.overlayRenderer = null;

        // State
        this.currentScreen = 'permission';
        this.isARActive = false;
        this.maxDistance = 5000; // Default 5km visible
        this.fetchRadius = 10000; // ALWAYS fetch 10km to avoid re-fetching on slider move
        this.isFetchingPOIs = false;
        this.lastFetchedPOIs = []; // Store fetched POIs for local filtering

        // UI elements
        this.elements = {
            permissionScreen: document.getElementById('permission-screen'),
            calibrationScreen: document.getElementById('calibration-screen'),
            mapView: document.getElementById('map-view'),
            startBtn: document.getElementById('start-btn'),
            calibrationDoneBtn: document.getElementById('calibration-done'),
            backToARBtn: document.getElementById('back-to-ar'),
            camera: document.getElementById('camera'),
            arOverlay: document.getElementById('ar-overlay'),
            gpsStatus: document.getElementById('gps-status'),
            poiCount: document.getElementById('poi-count'),
            poiList: document.getElementById('poi-list'),
            
            // Error modal
            errorModal: document.getElementById('error-modal'),
            errorMessage: document.getElementById('error-message'),
            errorHelp: document.getElementById('error-help'),
            errorDismissBtn: document.getElementById('error-dismiss-btn'),
            
            // New UI Elements
            debugToggleBtn: document.getElementById('debug-toggle-btn'),
            debugPanel: document.getElementById('debug-panel'),
            distanceSlider: document.getElementById('distance-slider'),
            distanceLabel: document.getElementById('distance-label'),
            
            // Debug elements
            debugAccuracy: document.getElementById('debug-accuracy'),
            debugHeading: document.getElementById('debug-heading'),
            debugPitch: document.getElementById('debug-pitch'),
            debugTotalPois: document.getElementById('debug-total-pois')
        };

        this.bindEvents();
        this.checkSupport();

        // Throttle POI updates - only fetch new POIs every 5 seconds
        // Only triggered by significant movement now, not slider
        this.updatePOIs = throttle(this._updatePOIs.bind(this), 5000);
        this.lastPOIFetchTime = 0;
    }

    /**
     * Check browser support
     */
    checkSupport() {
        const support = {
            camera: CameraStream.isSupported(),
            geolocation: Geolocator.checkSupport().geolocation,
            orientation: Geolocator.checkSupport().orientation
        };

        if (!support.camera || !support.geolocation || !support.orientation) {
            this.showError(
                'Your device does not support all required features. ' +
                'Please use a modern smartphone browser.'
            );
        }
    }

    /**
     * Bind UI event handlers
     */
    bindEvents() {
        this.elements.startBtn.addEventListener('click', () => this.start());
        this.elements.calibrationDoneBtn.addEventListener('click', () => this.finishCalibration());
        this.elements.backToARBtn.addEventListener('click', () => this.showARView());
        this.elements.errorDismissBtn.addEventListener('click', () => this.dismissError());
        
        // Debug toggle
        this.elements.debugToggleBtn.addEventListener('click', () => {
            this.elements.debugPanel.classList.toggle('hidden');
        });

        // Live slider update (client-side filtering only)
        this.elements.distanceSlider.addEventListener('input', (e) => this.handleDistanceChange(e.target.value));
    }

    /**
     * Start the application
     */
    start() {
        this.elements.startBtn.disabled = true;
        this.elements.startBtn.textContent = 'Requesting Location...';

        // Geolocation requires HTTPS (secure context)
        if (!window.isSecureContext) {
            this.showError('This app requires HTTPS. Please visit: https://' + location.host + location.pathname);
            this.elements.startBtn.disabled = false;
            this.elements.startBtn.textContent = 'Start';
            return;
        }

        const initialOptions = {
            enableHighAccuracy: false,
            timeout: 30000,
            maximumAge: 0
        };
        
        // On iOS Safari, the geolocation prompt must be triggered directly from the user gesture.
        // Call getCurrentPosition in the click handler to preserve gesture context.
        navigator.geolocation.getCurrentPosition(
            (position) => {
                this.geolocator.startWithPosition(position)
                    .then(() => {
                        // 2. Request Camera
                        this.elements.startBtn.textContent = 'Requesting Camera...';
                        return this.cameraStream.start(this.elements.camera);
                    })
                    .then(() => {
                        // Step 3: Show calibration screen
                        this.showScreen('calibration');
                    })
                    .catch((error) => {
                        console.error('Startup error:', error);
                        this.showError(error.message);
                        this.elements.startBtn.disabled = false;
                        this.elements.startBtn.textContent = 'Start';
                    });
            },
            (error) => {
                console.error('Geolocation error code:', error.code, 'message:', error.message);
                
                if (error.code === 1) { // PERMISSION_DENIED
                    this.showLocationDeniedError();
                } else {
                    const message = this.geolocator.getPositionErrorMessage(error);
                    this.showError(message);
                }
                this.elements.startBtn.disabled = false;
                this.elements.startBtn.textContent = 'Start';
            },
            initialOptions
        );
    }

    /**
     * Finish calibration and start AR
     */
    async finishCalibration() {
        try {
            // Request orientation permission (iOS 13+ requires user gesture)
            const orientationGranted = await this.geolocator.requestOrientationPermission();
            if (!orientationGranted) {
                throw new Error('Device orientation permission is required for AR features');
            }

            // Initialize overlay renderer
            const cameraDimensions = this.cameraStream.getDimensions();
            const fov = this.cameraStream.getFieldOfView();

            this.overlayRenderer = new OverlayRenderer(this.elements.arOverlay, {
                maxVisibleDistance: this.maxDistance,
                maxLabels: 30, // Increased from 15 to show more POIs
                minLabelSpacing: 100, // Reduced from 100 (or keep same, need space)
                horizontalFOV: fov,
                screenWidth: window.innerWidth, // Initialize with current dimensions
                screenHeight: window.innerHeight,
                onLabelClick: (poi, article) => {
                    if (article && article.url) {
                        window.open(article.url, '_blank');
                    }
                }
            });

            // Set up event listeners
            let positionUpdateCount = 0;
            this.geolocator.on('position', (position) => {
                positionUpdateCount++;
                
                // Keep status bar simple (icon removed as requested)
                this.elements.gpsStatus.textContent = ''; 
                this.overlayRenderer.updateUserPosition(position);
                
                // Only update POIs on first position, then rely on manual triggers
                if (positionUpdateCount === 1) {
                    console.log('Initial position received, fetching POIs...');
                    this.updatePOIs();
                }
                
                // Update debug info with accuracy (HTML already has 'm' unit)
                this.elements.debugAccuracy.textContent = position.accuracy.toFixed(1);
            });

            this.geolocator.on('orientation', (orientation) => {
                this.overlayRenderer.updateDeviceOrientation(orientation);
                // Update debug info
                this.elements.debugHeading.textContent = orientation.heading.toFixed(1) + '°';
                this.elements.debugPitch.textContent = orientation.pitch.toFixed(1) + '°';
            });

            this.geolocator.on('error', (error) => {
                console.error('Geolocator error:', error);
            });

            // Fetch initial POIs
            await this.updatePOIs();

            // Start rendering
            this.overlayRenderer.start();
            this.isARActive = true;

            // Show AR view
            this.showScreen('ar');

        } catch (error) {
            console.error('AR initialization error:', error);
            this.showError(error.message);
        }
    }

    /**
     * Update POIs from current location
     */
    async _updatePOIs() {
        const position = this.geolocator.getPosition();
        if (!position) {
            console.warn('No position available for POI update');
            this.elements.debugTotalPois.textContent = 'No GPS position';
            return;
        }

        // Check minimum time between fetches (5 seconds)
        const now = Date.now();
        if (now - this.lastPOIFetchTime < 5000) {
            console.log('Skipping POI fetch - too soon after last fetch');
            return;
        }

        // Prevent concurrent fetches
        if (this.isFetchingPOIs) {
            console.log('POI fetch already in progress, skipping...');
            return;
        }

        this.lastPOIFetchTime = now;

        // Show loading state in Info Bar
        this.elements.poiCount.innerHTML = '<span class="loading-spinner">↻</span> Loading...';
        this.isFetchingPOIs = true;

        try {
            const orientation = this.geolocator.getOrientation();
            
            console.log(`Fetching POIs near ${position.lat.toFixed(4)}, ${position.lng.toFixed(4)} within ${this.fetchRadius}m`);
            
            // Fetch POIs from Overpass API
            // ALWAYS fetch the maximum radius (10km or fetchRadius) so slider can work locally
            const allPOIs = await this.poiDetector.fetchNearbyPOIs(
                position.lat,
                position.lng,
                this.fetchRadius
            );

            console.log(`Fetched ${allPOIs.length} POIs from Overpass API`);
            console.log('Device orientation:', {
                heading: orientation.heading.toFixed(1),
                pitch: orientation.pitch.toFixed(1),
                headingType: typeof orientation.heading,
                pitchType: typeof orientation.pitch
            });

            // TEMPORARY: Show all POIs without filtering to test rendering
            // const visiblePOIs = allPOIs;
            
            // Filter visible POIs
            // WE DO NOT FILTER HERE anymore - passing all loaded POIs to the renderer
            // The renderer handles real-time FOV culling as the user turns
            // This ensures POIs appear immediately when turning without needing a new fetch
            /* 
            const visiblePOIs = this.poiDetector.getVisiblePOIs(
                allPOIs,
                position,
                orientation.heading,
                orientation.pitch,
                90, // 90° horizontal FOV
                90, // Vertical FOV
                this.maxDistance
            );
            */
            const visiblePOIs = allPOIs;

            console.log(`${visiblePOIs.length} POIs passed to renderer (full circle)`);
            
            // Debug: show first few POIs with their bearings
            if (allPOIs.length > 0) {
                console.log('Sample POIs:', allPOIs.slice(0, 3).map(poi => ({
                    name: poi.name,
                    distance: poi.distance,
                    bearing: poi.bearing,
                    lat: poi.lat,
                    lng: poi.lng
                })));
                console.log('User position:', {
                    lat: position.lat.toFixed(6),
                    lng: position.lng.toFixed(6)
                });
            }

            this.elements.debugHeading.textContent = orientation.heading.toFixed(1) + '°';
            this.elements.debugPitch.textContent = orientation.pitch.toFixed(1) + '°';
            
            // New debug element
            const dist = this.elements.debugDistVal || document.getElementById('debug-dist-val');
            if(dist) dist.textContent = this.maxDistance.toFixed(0);

            // Store for local filtering
            this.lastFetchedPOIs = allPOIs;

            // Update overlay
            if (this.overlayRenderer) {
                this.overlayRenderer.updatePOIs(allPOIs);
            }

            // Update UI with correct valid count based on CURRENT slider
            this._updateVisibleCount();

        } catch (error) {
            console.error('POI update error:', error);
            console.error('Error stack:', error.stack);
            
            // Show detailed error in debug panel
            let errorMsg = error.message;
            if (error.name === 'TypeError' && errorMsg.includes('fetch')) {
                errorMsg = 'Network error - check CORS/connection';
            } else if (error.message.includes('429')) {
                errorMsg = 'Rate limited - wait a moment';
            } else if (error.name === 'AbortError' || error.message.includes('aborted') || error.message.includes('timeout')) {
                errorMsg = 'Timeout - network slow';
            }
            
            this.elements.debugTotalPois.textContent = `Error: ${errorMsg}`;
            this.elements.poiCount.textContent = 'Error';
            
            // Don't show popup for every error, just log it
            // this.showError('Failed to fetch POIs: ' + error.message);
        } finally {
            this.isFetchingPOIs = false;
            
            // Safety check: ensure "Loading..." state is cleared
            // If we still have the loading spinner in the text, it means something prevented the update
            if (this.elements.poiCount.innerHTML.includes('loading-spinner')) {
                if (this.lastFetchedPOIs && this.lastFetchedPOIs.length > 0) {
                     this._updateVisibleCount();
                } else {
                     this.elements.poiCount.textContent = '0 POIs';
                }
            }
        }
    }

    /**
     * Show settings screen - REMOVED
     */
    showSettings() {
        // this.showScreen('settings');
    }

    /**
     * Close settings and return to AR - REMOVED
     */
    closeSettings() {
        // this.showARView();
    }

    /**
     * Update maximum distance setting
     */
    /**
     * Handle distance slider change
     * Only updates local visibility, DOES NOT fetch new POIs
     */
    handleDistanceChange(value) {
        const distanceKm = parseFloat(value);
        this.maxDistance = distanceKm * 1000; // Convert to meters
        this.elements.distanceLabel.textContent = distanceKm.toFixed(1);
        
        // Update overlay renderer immediately
        if (this.overlayRenderer) {
            this.overlayRenderer.updateMaxDistance(this.maxDistance);
            
             // If distance is maxed out (10km), allow more labels
             if (this.maxDistance >= 10000) {
                this.overlayRenderer.maxLabels = 50; 
            } else {
                this.overlayRenderer.maxLabels = 30;
            }
        }
        
        // Update UI counts locally
        this._updateVisibleCount();
    }

    /**
     * Helper to update visible POI count based on current distance setting
     * @private
     */
    _updateVisibleCount() {
        if (!this.lastFetchedPOIs) return;
        
        const count = this.lastFetchedPOIs.filter(p => p.distance <= this.maxDistance).length;
        this.elements.poiCount.textContent = `${count} POIs`;
        this.elements.debugTotalPois.textContent = `${this.lastFetchedPOIs.length} loaded (${count} in range)`;
        
        // Also update debug distance value
        const dist = this.elements.debugDistVal || document.getElementById('debug-dist-val');
        if(dist) dist.textContent = this.maxDistance.toFixed(0);
    }

    /**
     * Show AR view
     */
    showARView() {
        if (!this.isARActive) {
            this.showError('AR not initialized');
            return;
        }

        this.showScreen('ar');
        if (this.overlayRenderer) {
            this.overlayRenderer.start();
        }
    }

    /**
     * Show map fallback view
     */
    async showMapView() {
        this.showScreen('map');
        
        if (this.overlayRenderer) {
            this.overlayRenderer.stop();
        }

        const position = this.geolocator.getPosition();
        if (!position) return;

        try {
            const pois = await this.poiDetector.fetchNearbyPOIs(
                position.lat,
                position.lng,
                5000
            );

            // Sort by distance
            pois.sort((a, b) => a.distance - b.distance);

            // Render list
            this.elements.poiList.innerHTML = pois.slice(0, 20).map(poi => `
                <div class="poi-item">
                    <h3>${poi.name}</h3>
                    <div class="distance">${this.formatDistance(poi.distance)}</div>
                    <div class="description">Loading...</div>
                </div>
            `).join('');

            // Fetch Wikipedia data
            for (const poi of pois.slice(0, 20)) {
                if (poi.wikipediaTitle) {
                    try {
                        const article = await this.wikiClient.fetchByTitle(poi.wikipediaTitle);
                        // Update description
                        const items = this.elements.poiList.querySelectorAll('.poi-item');
                        const index = pois.findIndex(p => p.id === poi.id);
                        if (items[index]) {
                            const desc = items[index].querySelector('.description');
                            desc.textContent = article.description || article.extract || 'No description available';
                        }
                    } catch (error) {
                        console.error('Failed to fetch article for', poi.name);
                    }
                }
            }

        } catch (error) {
            console.error('Map view error:', error);
        }
    }

    /**
     * Show specific screen
     */
    showScreen(screen) {
        // Hide all screens
        document.querySelectorAll('.screen').forEach(el => {
            el.classList.remove('active');
        });
        
        // Hide AR controls by default
        const arControls = document.getElementById('ar-controls');
        if (arControls) arControls.style.display = 'none';

        // Show requested screen
        switch (screen) {
            case 'permission':
                this.elements.permissionScreen.classList.add('active');
                break;
            case 'calibration':
                this.elements.calibrationScreen.classList.add('active');
                break;
            case 'map':
                this.elements.mapView.classList.add('active');
                break;
            case 'settings':
                this.elements.settingsScreen.classList.add('active');
                break;
            case 'ar':
                if (arControls) arControls.style.display = 'block';
                // AR view has no overlay screen - just camera and overlays
                break;
        }

        this.currentScreen = screen;
    }

    /**
     * Show error message in on-page modal (not alert — alerts interfere with iOS permissions)
     */
    showError(message, helpHTML = '') {
        this.elements.errorMessage.textContent = message;
        this.elements.errorHelp.innerHTML = helpHTML;
        this.elements.errorModal.classList.add('active');
    }

    /**
     * Show location-denied error with platform-specific reset instructions
     */
    showLocationDeniedError() {
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        
        let helpHTML = '';
        if (isIOS) {
            helpHTML = `
                <strong>Safari has blocked location for this site.</strong>
                <br>To fix, reset Safari's per-site location setting:
                <ol>
                    <li>Open <b>Settings</b> → <b>Apps</b> → <b>Safari</b></li>
                    <li>Tap <b>Location</b> (under "Settings for Websites")</li>
                    <li>Find this site and change to <b>Ask</b> or <b>Allow</b></li>
                    <li>Come back here and tap <b>Try Again</b></li>
                </ol>
                <em>Or: Settings → Apps → Safari → Clear History and Website Data (resets all sites)</em>`;
        } else {
            helpHTML = `
                <strong>Location access was denied.</strong>
                <br>Click the lock/info icon in your browser's address bar, 
                find "Location" and set it to "Allow", then try again.`;
        }
        
        this.showError('Location permission denied', helpHTML);
    }

    /**
     * Dismiss error modal and return to start screen
     */
    dismissError() {
        this.elements.errorModal.classList.remove('active');
        this.showScreen('permission');
    }

    /**
     * Format distance for display
     */
    formatDistance(meters) {
        if (meters < 1000) {
            return Math.round(meters) + 'm';
        } else {
            return (meters / 1000).toFixed(1) + 'km';
        }
    }

    /**
     * Clean up resources
     */
    destroy() {
        this.geolocator.stop();
        this.cameraStream.stop();
        if (this.overlayRenderer) {
            this.overlayRenderer.destroy();
        }
    }
}

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.app = new AugmentedWikiApp();
    });
} else {
    window.app = new AugmentedWikiApp();
}

// Handle page visibility changes (save battery when hidden)
document.addEventListener('visibilitychange', () => {
    if (document.hidden && window.app && window.app.overlayRenderer) {
        window.app.overlayRenderer.stop();
    } else if (!document.hidden && window.app && window.app.isARActive) {
        window.app.overlayRenderer.start();
    }
});

// Handle orientation changes
window.addEventListener('orientationchange', () => {
    if (window.app && window.app.overlayRenderer) {
        // Update screen dimensions
        setTimeout(() => {
            window.app.overlayRenderer.updateScreenDimensions(
                window.innerWidth,
                window.innerHeight
            );
        }, 100);
    }
});
