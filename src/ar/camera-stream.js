/**
 * Camera stream handler for AR functionality
 * Manages getUserMedia camera access and video stream
 */
export class CameraStream {
    constructor() {
        this.stream = null;
        this.videoElement = null;
        this.isActive = false;
    }

    /**
     * Check if camera API is supported
     * @returns {boolean} Support status
     */
    static isSupported() {
        return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    }

    /**
     * Start camera stream
     * @param {HTMLVideoElement} videoElement - Video element to attach stream
     * @param {Object} options - Camera options
     * @returns {Promise<void>}
     */
    async start(videoElement, options = {}) {
        if (!CameraStream.isSupported()) {
            throw new Error('Camera API not supported in this browser');
        }

        if (this.isActive) {
            console.warn('Camera already active');
            return;
        }

        this.videoElement = videoElement;

        const constraints = {
            video: {
                facingMode: options.facingMode || 'environment', // Back camera
                width: { ideal: options.width || 1920 },
                height: { ideal: options.height || 1080 },
                frameRate: { ideal: options.frameRate || 30, max: 60 }
            },
            audio: false
        };

        try {
            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.videoElement.srcObject = this.stream;
            
            // Wait for video to be ready
            await new Promise((resolve, reject) => {
                this.videoElement.onloadedmetadata = () => {
                    this.videoElement.play()
                        .then(resolve)
                        .catch(reject);
                };
                this.videoElement.onerror = reject;
            });

            this.isActive = true;
        } catch (error) {
            throw new Error(this._getErrorMessage(error));
        }
    }

    /**
     * Stop camera stream
     */
    stop() {
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }

        if (this.videoElement) {
            this.videoElement.srcObject = null;
        }

        this.isActive = false;
    }

    /**
     * Get video dimensions
     * @returns {Object} Width and height
     */
    getDimensions() {
        if (!this.videoElement) {
            return { width: 0, height: 0 };
        }

        return {
            width: this.videoElement.videoWidth,
            height: this.videoElement.videoHeight
        };
    }

    /**
     * Get camera field of view estimate
     * Most mobile cameras have ~60-70° horizontal FOV
     * @returns {number} Horizontal FOV in degrees
     */
    getFieldOfView() {
        // Default estimate for mobile cameras
        // In production, this could be calibrated or calculated from camera specs
        return 65;
    }

    /**
     * Check if stream is active
     * @returns {boolean}
     */
    isStreamActive() {
        return this.isActive && this.stream !== null;
    }

    /**
     * Get user-friendly error message
     * @private
     */
    _getErrorMessage(error) {
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
            return 'Camera permission denied. Please allow camera access.';
        } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
            return 'No camera found on this device.';
        } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
            return 'Camera is in use by another application.';
        } else if (error.name === 'OverconstrainedError') {
            return 'Camera does not meet requested constraints.';
        } else if (error.name === 'TypeError') {
            return 'Invalid camera constraints.';
        } else {
            return 'Camera error: ' + error.message;
        }
    }

    /**
     * Switch camera (front/back)
     * @param {string} facingMode - 'user' or 'environment'
     */
    async switchCamera(facingMode = 'environment') {
        const wasActive = this.isActive;
        const videoElement = this.videoElement;

        if (wasActive) {
            this.stop();
        }

        if (videoElement) {
            await this.start(videoElement, { facingMode });
        }
    }

    /**
     * Take a snapshot of current video frame
     * @returns {string} Data URL of the image
     */
    takeSnapshot() {
        if (!this.videoElement) {
            throw new Error('No video element available');
        }

        const canvas = document.createElement('canvas');
        const dimensions = this.getDimensions();
        canvas.width = dimensions.width;
        canvas.height = dimensions.height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(this.videoElement, 0, 0);

        return canvas.toDataURL('image/jpeg', 0.9);
    }
}
