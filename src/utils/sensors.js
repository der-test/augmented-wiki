/**
 * Sensor smoothing utilities for device orientation data
 * Filters noise and provides stable heading/tilt readings
 */

/**
 * Simple moving average filter for smoothing sensor readings
 */
class MovingAverageFilter {
    constructor(windowSize = 5) {
        this.windowSize = windowSize;
        this.values = [];
    }

    /**
     * Add new value and get smoothed result
     * @param {number} value - New sensor reading
     * @returns {number} Smoothed value
     */
    update(value) {
        this.values.push(value);
        if (this.values.length > this.windowSize) {
            this.values.shift();
        }
        return this.values.reduce((sum, v) => sum + v, 0) / this.values.length;
    }

    reset() {
        this.values = [];
    }
}

/**
 * Exponential moving average filter (faster response than simple moving average)
 */
class ExponentialFilter {
    constructor(alpha = 0.2) {
        this.alpha = alpha; // Smoothing factor (0-1, lower = smoother)
        this.value = null;
    }

    /**
     * Add new value and get smoothed result
     * @param {number} newValue - New sensor reading
     * @returns {number} Smoothed value
     */
    update(newValue) {
        if (this.value === null) {
            this.value = newValue;
        } else {
            this.value = this.alpha * newValue + (1 - this.alpha) * this.value;
        }
        return this.value;
    }

    reset() {
        this.value = null;
    }
}

/**
 * Low-pass filter for removing high-frequency noise
 * Suitable for accelerometer and gyroscope data
 */
class LowPassFilter {
    constructor(cutoffFrequency = 0.1) {
        this.rc = 1.0 / (2 * Math.PI * cutoffFrequency);
        this.lastValue = null;
        this.lastTime = null;
    }

    /**
     * Add new value and get filtered result
     * @param {number} value - New sensor reading
     * @param {number} timestamp - Timestamp in milliseconds
     * @returns {number} Filtered value
     */
    update(value, timestamp) {
        if (this.lastValue === null) {
            this.lastValue = value;
            this.lastTime = timestamp;
            return value;
        }

        const dt = (timestamp - this.lastTime) / 1000; // Convert to seconds
        const alpha = dt / (this.rc + dt);
        this.lastValue = alpha * value + (1 - alpha) * this.lastValue;
        this.lastTime = timestamp;
        
        return this.lastValue;
    }

    reset() {
        this.lastValue = null;
        this.lastTime = null;
    }
}

/**
 * Compass heading filter that handles wraparound (0° = 360°)
 */
class CompassFilter {
    constructor(windowSize = 5) {
        this.windowSize = windowSize;
        this.sinValues = [];
        this.cosValues = [];
    }

    /**
     * Add new heading and get smoothed result
     * Properly handles angle wraparound (359° -> 1° transition)
     * @param {number} heading - Heading in degrees (0-360)
     * @returns {number} Smoothed heading in degrees (0-360)
     */
    update(heading) {
        const radians = heading * Math.PI / 180;
        this.sinValues.push(Math.sin(radians));
        this.cosValues.push(Math.cos(radians));

        if (this.sinValues.length > this.windowSize) {
            this.sinValues.shift();
            this.cosValues.shift();
        }

        const avgSin = this.sinValues.reduce((sum, v) => sum + v, 0) / this.sinValues.length;
        const avgCos = this.cosValues.reduce((sum, v) => sum + v, 0) / this.cosValues.length;
        
        let smoothedHeading = Math.atan2(avgSin, avgCos) * 180 / Math.PI;
        
        // Normalize to 0-360
        if (smoothedHeading < 0) {
            smoothedHeading += 360;
        }
        
        return smoothedHeading;
    }

    reset() {
        this.sinValues = [];
        this.cosValues = [];
    }
}

/**
 * Orientation sensor manager with filtering
 * Combines device orientation events and provides smoothed output
 */
export class OrientationSmoother {
    constructor() {
        this.headingFilter = new CompassFilter(8);
        this.pitchFilter = new ExponentialFilter(0.15);
        this.rollFilter = new ExponentialFilter(0.15);
        this.calibrationOffset = 0;
    }

    /**
     * Process raw device orientation data
     * @param {Object} orientation - Device orientation event data
     * @param {number} orientation.alpha - Compass heading (0-360)
     * @param {number} orientation.beta - Front-to-back tilt (-180 to 180)
     * @param {number} orientation.gamma - Left-to-right tilt (-90 to 90)
     * @returns {Object} Smoothed orientation data
     */
    update(orientation) {
        // Compass heading with calibration offset
        let heading = orientation.alpha + this.calibrationOffset;
        if (heading < 0) heading += 360;
        if (heading >= 360) heading -= 360;
        
        return {
            heading: this.headingFilter.update(heading),
            pitch: this.pitchFilter.update(orientation.beta),
            roll: this.rollFilter.update(orientation.gamma)
        };
    }

    /**
     * Set calibration offset for magnetic declination
     * @param {number} offset - Offset in degrees
     */
    setCalibrationOffset(offset) {
        this.calibrationOffset = offset;
    }

    /**
     * Reset all filters
     */
    reset() {
        this.headingFilter.reset();
        this.pitchFilter.reset();
        this.rollFilter.reset();
    }
}

/**
 * Debounce function to limit update frequency
 * @param {Function} func - Function to debounce
 * @param {number} wait - Milliseconds to wait
 * @returns {Function} Debounced function
 */
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Throttle function to limit execution rate
 * @param {Function} func - Function to throttle
 * @param {number} limit - Minimum milliseconds between executions
 * @returns {Function} Throttled function
 */
export function throttle(func, limit) {
    let inThrottle;
    return function executedFunction(...args) {
        if (!inThrottle) {
            func(...args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// Export filter classes for advanced use cases
export { MovingAverageFilter, ExponentialFilter, LowPassFilter, CompassFilter };
