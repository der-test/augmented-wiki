# Augmented Wiki - AI Coding Instructions

## Project Overview
AR-enabled web application where users point their smartphone camera at real-world points of interest (POIs) to view Wikipedia articles overlaid on the camera feed.

## Architecture

### Core Components
- **Camera/AR Module**: WebRTC/getUserMedia for camera access, device orientation API for tracking
- **Geolocation Service**: GPS positioning + compass heading to determine what user is looking at
- **POI Detection**: Calculate POIs in user's view frustum based on GPS, heading, and device tilt
- **Wikipedia Integration**: Fetch articles via Wikipedia API for detected POIs
- **AR Overlay Renderer**: Position Wikipedia content on camera feed using CSS transforms/WebGL

### Data Flow
1. Get user location (GPS) + device orientation (compass, gyroscope)
2. Query POI database (OpenStreetMap/Wikidata) for nearby landmarks
3. Calculate which POIs are in camera viewfinder (frustum culling)
4. Fetch Wikipedia summaries for visible POIs
5. Render AR overlays positioned at POI screen coordinates

## Technology Stack Decisions

### Frontend
- **Framework**: Vanilla JS with ES6 modules - maximum compatibility across iOS/Android
- **AR Implementation**: Custom CSS3D transforms (avoid WebXR/WebGL for broader device support)
- **APIs**: 
  - Geolocation API for position
  - DeviceOrientation API for heading/tilt
  - Wikipedia REST API (action=query)
  - Overpass API (OpenStreetMap) for POI coordinates

### Mobile Considerations
- Progressive Web App with manifest.json for "Add to Home Screen"
- HTTPS required (camera/location permissions)
- Optimize for low bandwidth - lazy load images, compress responses
- Battery efficiency - throttle API calls, debounce sensor readings
- **No offline support** - always fetch fresh data from APIs
- Test on both iOS Safari AND Android Chrome equally (no priority)

## Development Workflows

### Local Development
```bash
# Camera/location APIs require HTTPS - two approaches:

# Option 1: Local HTTPS with mkcert (test on same WiFi network)
brew install mkcert  # macOS - or use apt/choco for Linux/Windows
mkcert -install
mkcert localhost 192.168.1.x  # your local IP
npx serve --ssl-cert ./localhost+1.pem --ssl-key ./localhost+1-key.pem

# Option 2: ngrok tunnel (easiest for phone testing)
brew install ngrok  # or download from ngrok.com
npx serve  # start local server on port 3000
ngrok http 3000  # get public HTTPS URL for phone

# Access from phone: Open ngrok URL or https://192.168.1.x:port
# Desktop browser CAN'T test sensors - MUST use actual device
```

### Testing Strategy
- Mock geolocation data for reproducible testing
- Test matrix: iOS Safari + Android Chrome (equal priority, ALL devices)
- POI calculation accuracy tests (known landmarks at known coordinates)
- Cross-browser sensor API compatibility (orientation events differ between browsers)

## Code Conventions

### POI Coordinate System
- Store POI locations as WGS84 lat/lng (standard GPS format)
- Use haversine formula for distance calculations
- Convert to screen coordinates using perspective projection matrix

### API Rate Limiting
- Cache Wikipedia responses in memory only (session-based, no persistence)
- Batch POI queries when possible
- Implement exponential backoff for failed requests
- Build POI database from scratch using Overpass API queries at runtime

### AR Positioning
- Account for device orientation offset (magnetic declination)
- Filter sensor noise with smoothing algorithms (Kalman filter or simple moving average)
- Render POI labels only when confidence threshold met

## Key Files Structure (To Be Created)

```
/src
  /core
    geolocator.js      # GPS + compass handling
    poi-detector.js    # Calculate visible POIs
    wiki-client.js     # Wikipedia API integration
  /ar
    camera-stream.js   # Camera feed management
    overlay-renderer.js # Position labels on video
  /utils
    coordinates.js     # Haversine, projection math
    sensors.js         # DeviceOrientation smoothing
/public
  manifest.json        # PWA configuration
/tests
  poi-detection.test.js
```

## Critical Implementation Notes

- **Compass Calibration**: Prompt user to calibrate compass on first load (figure-8 motion)
- **Permission Flow**: Request camera → location → device sensors in sequence with clear UX
- **Fallback Mode**: If AR fails, show map view with nearby POIs as list
- **Privacy**: Don't store user location - process client-side only

## External Dependencies

- **POI Data Sources**: 
  - Wikidata SPARQL endpoint: https://query.wikidata.org/
  - Wikipedia API: https://www.mediawiki.org/wiki/API:Main_page
  - OpenStreetMap Nominatim for geocoding

- **Browser APIs**: Verify availability before use (feature detection)
  - navigator.geolocation (required)
  - DeviceOrientationEvent (required for AR)
  - MediaDevices.getUserMedia (required for camera)

## Performance Targets
- Initial load: < 3s on 4G
- POI detection: < 100ms after orientation change
- Wikipedia fetch: < 500ms (with caching)
- 60fps camera feed (throttle to 30fps if needed)
