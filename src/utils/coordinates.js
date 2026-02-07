/**
 * Geospatial Coordinate Utilities for AR POI Positioning
 * Uses WGS84 coordinate system (standard GPS format)
 * All latitude/longitude values in decimal degrees
 * Distances in meters, bearings in degrees (0-360, 0=north)
 */

// Earth's mean radius in meters (WGS84)
const EARTH_RADIUS = 6371000;

/**
 * Convert degrees to radians
 * @param {number} degrees - Angle in degrees
 * @returns {number} Angle in radians
 */
function toRadians(degrees) {
  return degrees * (Math.PI / 180);
}

/**
 * Convert radians to degrees
 * @param {number} radians - Angle in radians
 * @returns {number} Angle in degrees
 */
function toDegrees(radians) {
  return radians * (180 / Math.PI);
}

/**
 * Normalize angle to 0-360 degree range
 * @param {number} angle - Angle in degrees
 * @returns {number} Normalized angle (0-360)
 */
function normalizeAngle(angle) {
  let normalized = angle % 360;
  if (normalized < 0) {
    normalized += 360;
  }
  return normalized;
}

/**
 * Calculate great-circle distance between two GPS coordinates using Haversine formula
 * Accurate for most distances, handles edge cases including poles and dateline crossing
 * 
 * @param {number} lat1 - Latitude of first point (decimal degrees, -90 to 90)
 * @param {number} lng1 - Longitude of first point (decimal degrees, -180 to 180)
 * @param {number} lat2 - Latitude of second point (decimal degrees, -90 to 90)
 * @param {number} lng2 - Longitude of second point (decimal degrees, -180 to 180)
 * @returns {number} Distance in meters
 * 
 * @example
 * // Distance between Eiffel Tower and Statue of Liberty
 * const distance = calculateDistance(48.8584, 2.2945, 40.6892, -74.0445);
 * console.log(distance); // ~5837489 meters
 */
export function calculateDistance(lat1, lng1, lat2, lng2) {
  // Validate inputs
  if (lat1 < -90 || lat1 > 90 || lat2 < -90 || lat2 > 90) {
    throw new Error('Latitude must be between -90 and 90 degrees');
  }
  
  // Handle identical points
  if (lat1 === lat2 && lng1 === lng2) {
    return 0;
  }
  
  // Convert to radians
  const φ1 = toRadians(lat1);
  const φ2 = toRadians(lat2);
  const Δφ = toRadians(lat2 - lat1);
  const Δλ = toRadians(lng2 - lng1);
  
  // Haversine formula
  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  
  const distance = EARTH_RADIUS * c;
  
  return distance;
}

/**
 * Calculate initial bearing (forward azimuth) from one GPS point to another
 * Returns compass direction where 0°=North, 90°=East, 180°=South, 270°=West
 * Handles dateline crossing and polar regions
 * 
 * @param {number} lat1 - Starting latitude (decimal degrees, -90 to 90)
 * @param {number} lng1 - Starting longitude (decimal degrees, -180 to 180)
 * @param {number} lat2 - Target latitude (decimal degrees, -90 to 90)
 * @param {number} lng2 - Target longitude (decimal degrees, -180 to 180)
 * @returns {number} Bearing in degrees (0-360, 0=north, clockwise)
 * 
 * @example
 * // Bearing from New York to London
 * const bearing = calculateBearing(40.7128, -74.0060, 51.5074, -0.1278);
 * console.log(bearing); // ~51 degrees (northeast)
 */
export function calculateBearing(lat1, lng1, lat2, lng2) {
  // Validate inputs
  if (lat1 < -90 || lat1 > 90 || lat2 < -90 || lat2 > 90) {
    throw new Error('Latitude must be between -90 and 90 degrees');
  }
  
  // Handle identical points - return 0 (north)
  if (lat1 === lat2 && lng1 === lng2) {
    return 0;
  }
  
  // Convert to radians
  const φ1 = toRadians(lat1);
  const φ2 = toRadians(lat2);
  const Δλ = toRadians(lng2 - lng1);
  
  // Calculate bearing
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) -
            Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  
  const θ = Math.atan2(y, x);
  const bearing = normalizeAngle(toDegrees(θ));
  
  return bearing;
}

/**
 * Project GPS coordinates to screen pixel coordinates for AR overlay
 * Calculates where a POI should appear on screen based on user's position,
 * device orientation (heading/pitch), and camera field of view
 * 
 * @param {Object} userLocation - User's current GPS position
 * @param {number} userLocation.lat - User latitude (decimal degrees)
 * @param {number} userLocation.lng - User longitude (decimal degrees)
 * @param {Object} poiLocation - POI GPS position
 * @param {number} poiLocation.lat - POI latitude (decimal degrees)
 * @param {number} poiLocation.lng - POI longitude (decimal degrees)
 * @param {number} deviceHeading - Compass heading in degrees (0=north, 0-360)
 * @param {number} devicePitch - Device tilt angle in degrees (-90 to 90, 0=horizontal, positive=looking up)
 * @param {number} screenWidth - Screen width in pixels
 * @param {number} screenHeight - Screen height in pixels
 * @param {number} [horizontalFOV=60] - Camera horizontal field of view in degrees (typically 50-70)
 * @param {number} [verticalFOV=45] - Camera vertical field of view in degrees (typically 40-50)
 * @returns {Object|null} Screen coordinates {x, y} in pixels, or null if POI is behind camera
 * 
 * @example
 * const screenPos = projectToScreen(
 *   { lat: 40.7128, lng: -74.0060 }, // User in NYC
 *   { lat: 40.7489, lng: -73.9680 }, // Empire State Building
 *   45,    // Looking northeast
 *   0,     // Looking straight ahead
 *   1920,  // Screen width
 *   1080,  // Screen height
 *   60,    // 60° horizontal FOV
 *   45     // 45° vertical FOV
 * );
 */
export function projectToScreen(
  userLocation,
  poiLocation,
  deviceHeading,
  devicePitch,
  screenWidth,
  screenHeight,
  horizontalFOV = 60,
  verticalFOV = 45
) {
  // Calculate bearing and distance to POI
  const bearingToPOI = calculateBearing(
    userLocation.lat,
    userLocation.lng,
    poiLocation.lat,
    poiLocation.lng
  );
  
  const distance = calculateDistance(
    userLocation.lat,
    userLocation.lng,
    poiLocation.lat,
    poiLocation.lng
  );
  
  // Calculate horizontal angle difference (azimuth)
  // Normalize device heading
  const normalizedHeading = normalizeAngle(deviceHeading);
  
  // Calculate angle from device heading to POI
  let azimuthDiff = bearingToPOI - normalizedHeading;
  
  // Normalize to -180 to 180 range
  if (azimuthDiff > 180) {
    azimuthDiff -= 360;
  } else if (azimuthDiff < -180) {
    azimuthDiff += 360;
  }
  
  // Check if POI is within horizontal FOV
  const halfHFOV = horizontalFOV / 2;
  if (Math.abs(azimuthDiff) > halfHFOV) {
    return null; // POI is outside horizontal view
  }
  
  // Calculate vertical angle (elevation)
  // Since we don't have altitude data for POIs, we can't accurately calculate
  // their elevation angle. Instead, position POIs vertically based on distance
  // to create depth perception: closer POIs appear lower, farther ones higher
  
  // Project to screen coordinates
  // Map angle differences to pixel positions
  // Center of screen is (screenWidth/2, screenHeight/2)
  
  // Horizontal position: map azimuthDiff from [-halfHFOV, +halfHFOV] to [0, screenWidth]
  // azimuthDiff is in degrees, normalize to percentage of FOV, then map to screen
  const normalizedHorizontal = azimuthDiff / horizontalFOV; // -0.5 to 0.5 for full FOV
  const x = (screenWidth / 2) + (normalizedHorizontal * screenWidth);
  
  // Debug occasionally
  if (Math.random() < 0.02) {
    console.log(`Horizontal: heading=${deviceHeading.toFixed(1)}°, bearingToPOI=${bearingToPOI.toFixed(1)}°, azimuthDiff=${azimuthDiff.toFixed(1)}°, x=${x.toFixed(0)}px (screen center=${screenWidth/2})`);
  }
  
  // Vertical position: Distribute across screen height based on distance
  // Use actual distance range for better distribution
  // Closer POIs appear in middle to lower screen, farther ones in upper to middle screen
  // This creates natural depth perception without requiring altitude data
  
  // Use a more realistic max distance based on typical visibility (5km)
  const effectiveMaxDistance = 5000; // 5km typical max for AR visibility
  const normalizedDistance = Math.min(distance / effectiveMaxDistance, 1.0);
  
  // Map to screen: 0m->85%, 5km->10% (Using more vertical screen space)
  // This spreads POIs from 10% to 85% of screen height (75% of total height)
  const yPercent = 0.85 - (normalizedDistance * 0.75);
  
  const y = screenHeight * yPercent;
  
  // Debug: log distance distribution occasionally
  if (Math.random() < 0.05) {
    console.log(`POI at ${distance.toFixed(0)}m -> y=${y.toFixed(0)}px (${(yPercent*100).toFixed(0)}% from top)`);
  }
  
  return {
    x: Math.round(x),
    y: Math.round(y),
    distance: distance,
    bearing: bearingToPOI
  };
}

/**
 * Determine if a POI is within the camera's view frustum
 * Checks if a point of interest would be visible on screen given device orientation
 * More efficient than full projection when you only need visibility check
 * 
 * @param {Object} userLocation - User's current GPS position
 * @param {number} userLocation.lat - User latitude (decimal degrees)
 * @param {number} userLocation.lng - User longitude (decimal degrees)
 * @param {Object} poiLocation - POI GPS position
 * @param {number} poiLocation.lat - POI latitude (decimal degrees)
 * @param {number} poiLocation.lng - POI longitude (decimal degrees)
 * @param {number} deviceHeading - Compass heading in degrees (0=north, 0-360)
 * @param {number} devicePitch - Device tilt angle in degrees (-90 to 90)
 * @param {number} [horizontalFOV=60] - Camera horizontal field of view in degrees
 * @param {number} [verticalFOV=45] - Camera vertical field of view in degrees
 * @param {number} [maxDistance=5000] - Maximum visibility distance in meters (default 5km)
 * @returns {boolean} True if POI is visible in camera view
 * 
 * @example
 * const isVisible = isInViewFrustum(
 *   { lat: 40.7128, lng: -74.0060 },
 *   { lat: 40.7489, lng: -73.9680 },
 *   45,   // Looking northeast
 *   0,    // Looking straight ahead
 *   60,   // 60° FOV horizontal
 *   45,   // 45° FOV vertical
 *   10000 // 10km max distance
 * );
 */
export function isInViewFrustum(
  userLocation,
  poiLocation,
  deviceHeading,
  devicePitch,
  horizontalFOV = 60,
  verticalFOV = 45,
  maxDistance = 5000
) {
  // Calculate distance first (cheap check)
  const distance = calculateDistance(
    userLocation.lat,
    userLocation.lng,
    poiLocation.lat,
    poiLocation.lng
  );
  
  if (distance > maxDistance) {
    return false; // Too far away
  }
  
  // Calculate bearing to POI
  const bearingToPOI = calculateBearing(
    userLocation.lat,
    userLocation.lng,
    poiLocation.lat,
    poiLocation.lng
  );
  
  // Check horizontal FOV
  const normalizedHeading = normalizeAngle(deviceHeading);
  let azimuthDiff = bearingToPOI - normalizedHeading;
  
  // Normalize to -180 to 180 range
  if (azimuthDiff > 180) {
    azimuthDiff -= 360;
  } else if (azimuthDiff < -180) {
    azimuthDiff += 360;
  }
  
  const halfHFOV = horizontalFOV / 2;
  const inHorizontalView = Math.abs(azimuthDiff) <= halfHFOV;
  
  if (!inHorizontalView) {
    return false; // Outside horizontal view
  }
  
  // Skip vertical FOV check entirely - we don't have altitude data to properly
  // calculate elevation angles, and device pitch varies wildly between devices/browsers.
  // Just show POIs that are within horizontal FOV and distance, regardless of phone tilt.
  
  return true;
}

/**
 * Calculate destination point given distance and bearing from start point
 * Useful for testing and reverse calculations
 * 
 * @param {number} lat - Starting latitude (decimal degrees)
 * @param {number} lng - Starting longitude (decimal degrees)
 * @param {number} distance - Distance to travel in meters
 * @param {number} bearing - Bearing in degrees (0-360, 0=north)
 * @returns {Object} Destination coordinates {lat, lng}
 * 
 * @example
 * // Point 1000m north of origin
 * const dest = calculateDestination(40.7128, -74.0060, 1000, 0);
 */
export function calculateDestination(lat, lng, distance, bearing) {
  if (lat < -90 || lat > 90) {
    throw new Error('Latitude must be between -90 and 90 degrees');
  }
  
  const δ = distance / EARTH_RADIUS; // Angular distance
  const θ = toRadians(bearing);
  const φ1 = toRadians(lat);
  const λ1 = toRadians(lng);
  
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) +
    Math.cos(φ1) * Math.sin(δ) * Math.cos(θ)
  );
  
  const λ2 = λ1 + Math.atan2(
    Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
    Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
  );
  
  // Normalize longitude to -180 to 180
  let normalizedLng = toDegrees(λ2);
  if (normalizedLng > 180) {
    normalizedLng -= 360;
  } else if (normalizedLng < -180) {
    normalizedLng += 360;
  }
  
  return {
    lat: toDegrees(φ2),
    lng: normalizedLng
  };
}
