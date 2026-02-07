import { OrientationSmoother, throttle } from '../utils/sensors.js';

/**
 * Geolocation service with GPS and compass tracking
 * Manages user position and device orientation with smoothing
 */
export class Geolocator {
    constructor() {
        this.position = null;
        this.orientation = { heading: 0, pitch: 0, roll: 0 };
        this.orientationSmoother = new OrientationSmoother();
        this.positionWatchId = null;
        this.isTracking = false;
        this.listeners = {
            position: [],
            orientation: [],
            error: []
        };

        // Throttle orientation updates to save battery
        this.handleOrientation = throttle(this._handleOrientation.bind(this), 50);
    }

    /**
     * Check if geolocation and orientation APIs are available
     * @returns {Object} Availability status
     */
    static checkSupport() {
        return {
            geolocation: 'geolocation' in navigator,
            orientation: 'DeviceOrientationEvent' in window,
            compass: 'ondeviceorientationabsolute' in window || 'webkitCompassHeading' in window
        };
    }

    /**
     * Start tracking position and orientation
     * @returns {Promise<void>}
     */
    async start() {
        if (this.isTracking) return;

        const support = Geolocator.checkSupport();
        
        if (!support.geolocation) {
            throw new Error('Geolocation not supported');
        }
        if (!support.orientation) {
            throw new Error('Device orientation not supported');
        }

        // Request permissions and start tracking
        await this._startPositionTracking();
        await this._startOrientationTracking();

        this.isTracking = true;
    }

    /**
     * Stop tracking
     */
    stop() {
        if (this.positionWatchId !== null) {
            navigator.geolocation.clearWatch(this.positionWatchId);
            this.positionWatchId = null;
        }

        window.removeEventListener('deviceorientationabsolute', this.handleOrientation);
        window.removeEventListener('deviceorientation', this.handleOrientation);

        this.isTracking = false;
    }

    /**
     * Get current position
     * @returns {Object|null} Current GPS position
     */
    getPosition() {
        return this.position;
    }

    /**
     * Get current orientation (smoothed)
     * @returns {Object} Current device orientation
     */
    getOrientation() {
        return this.orientation;
    }

    /**
     * Add event listener
     * @param {string} event - Event type: 'position', 'orientation', 'error'
     * @param {Function} callback - Callback function
     */
    on(event, callback) {
        if (this.listeners[event]) {
            this.listeners[event].push(callback);
        }
    }

    /**
     * Remove event listener
     * @param {string} event - Event type
     * @param {Function} callback - Callback to remove
     */
    off(event, callback) {
        if (this.listeners[event]) {
            this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
        }
    }

    /**
     * Start GPS position tracking
     * Uses getCurrentPosition first to ensure permissions and initial fix,
     * then switches to watchPosition for updates. This is more robust on iOS.
     * @private
     */
    _startPositionTracking() {
        return new Promise((resolve, reject) => {
            const options = {
                enableHighAccuracy: true,
                timeout: 20000, // Increased timeout for GPS lock
                maximumAge: 0
            };

            // Use getCurrentPosition first to trigger permission prompt reliably
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    this._handlePositionSuccess(position);
                    
                    // Start watching for continuous updates
                    this.positionWatchId = navigator.geolocation.watchPosition(
                        (pos) => this._handlePositionSuccess(pos),
                        (err) => console.warn('Position watch error:', err),
                        options
                    );
                    
                    resolve();
                },
                (error) => {
                    const errorMessage = this._getPositionErrorMessage(error);
                    this._emit('error', { type: 'position', message: errorMessage });
                    reject(new Error(errorMessage));
                },
                options
            );
        });
    }

    /**
     * Process separate position update
     * @private
     */
    _handlePositionSuccess(position) {
        this.position = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
            altitude: position.coords.altitude,
            timestamp: position.timestamp
        };

        this._emit('position', this.position);
    }

    /**
     * Request device orientation permission (iOS 13+)
     * Must be called in response to user gesture
     * @returns {Promise<boolean>}
     */
    async requestOrientationPermission() {
        if (typeof DeviceOrientationEvent !== 'undefined' && 
            typeof DeviceOrientationEvent.requestPermission === 'function') {
            try {
                const permission = await DeviceOrientationEvent.requestPermission();
                return permission === 'granted';
            } catch (error) {
                console.error('Device orientation permission error:', error);
                return false;
            }
        }
        // Permission not needed (Android or older iOS)
        return true;
    }

    /**
     * Start device orientation tracking
     * @private
     */
    async _startOrientationTracking() {
        // Prefer absolute orientation (with compass) over relative
        if ('ondeviceorientationabsolute' in window) {
            window.addEventListener('deviceorientationabsolute', this.handleOrientation, true);
        } else {
            window.addEventListener('deviceorientation', this.handleOrientation, true);
        }
    }

    /**
     * Handle device orientation event
     * @private
     */
    _handleOrientation(event) {
        let heading = null;

        // Priority 1: iOS webkitCompassHeading (Clockwise, 0=North)
        if (typeof event.webkitCompassHeading === 'number') {
            heading = event.webkitCompassHeading;
        } 
        // Priority 2: Standard alpha (Counter-Clockwise, 0=North)
        // Must convert to Clockwise to match map bearing system
        else if (event.alpha !== null) {
            heading = 360 - event.alpha;
        }

        if (heading === null) return;

        const rawOrientation = {
            alpha: heading,      // Normalized to Clockwise 0-360
            beta: event.beta,    // Front-back tilt (-180 to 180)
            gamma: event.gamma   // Left-right tilt (-90 to 90)
        };

        // Smooth orientation data
        this.orientation = this.orientationSmoother.update(rawOrientation);

        this._emit('orientation', this.orientation);
    }

    /**
     * Get user-friendly error message
     * @private
     */
    _getPositionErrorMessage(error) {
        switch (error.code) {
            case error.PERMISSION_DENIED:
                return 'Location permission denied. Please reset permissions in Settings (Privacy > Location Services) or reload.';
            case error.POSITION_UNAVAILABLE:
                return 'Location unavailable. Please check your GPS settings.';
            case error.TIMEOUT:
                return 'Location request timeout. Please try again.';
            default:
                return 'Location error: ' + error.message;
        }
    }

    /**
     * Emit event to listeners
     * @private
     */
    _emit(event, data) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(callback => callback(data));
        }
    }

    /**
     * Set calibration offset for compass
     * @param {number} offset - Offset in degrees
     */
    calibrate(offset) {
        this.orientationSmoother.setCalibrationOffset(offset);
    }

    /**
     * Reset orientation filters
     */
    resetFilters() {
        this.orientationSmoother.reset();
    }
}
